import { test } from 'node:test'
import assert from 'node:assert/strict'
import type * as Monaco from 'monaco-editor'
import { countLines, EditorSessions } from '../src/client/editor/sessions.ts'

/**
 * 模型替身：只实现状态机真正调用的那部分 `ITextModel` 接口。
 * `setValue` 与 `edit` 都会推进版本号，等价于编辑器里的内容变化。
 */
function fakeModel(initial: string): Monaco.editor.ITextModel & {
  edit(text: string): void
} {
  let text = initial
  let version = 1
  const model = {
    getAlternativeVersionId: () => version,
    getLineCount: () => countLines(text),
    getValue: () => text,
    setValue: (next: string) => { text = next; version += 1 },
    edit: (next: string) => { text = next; version += 1 },
    onDidChangeContent: () => ({ dispose: () => {} }),
    dispose: () => {},
  }
  return model as unknown as Monaco.editor.ITextModel & { edit(text: string): void }
}

/** 建立好模型、正处于就绪状态的标签页。 */
function readyTab(text: string): { sessions: EditorSessions; model: ReturnType<typeof fakeModel> } {
  const sessions = new EditorSessions()
  sessions.ensure('tab-1', { sessionId: 'session-1', path: 'C:/repo/a.ts' })
  sessions.beginLoad('tab-1', 1)
  sessions.loaded('tab-1', { text, version: 'v1', revision: 1 })
  const model = fakeModel(text)
  sessions.attachModel('tab-1', model, 'typescript')
  return { sessions, model }
}

test('读取后进入就绪，模型挂上即记录打开事件', () => {
  const sessions = new EditorSessions()
  const opened: string[] = []
  sessions.on('open', tabId => { opened.push(tabId) })
  sessions.ensure('tab', { sessionId: 's', path: 'C:/a.ts' })
  assert.equal(sessions.stateOf('tab')?.phase, 'idle')
  sessions.beginLoad('tab', 1)
  assert.equal(sessions.stateOf('tab')?.phase, 'loading')
  sessions.loaded('tab', { text: 'a\nb', version: 'v1', revision: 1 })
  assert.equal(sessions.stateOf('tab')?.phase, 'ready')
  assert.equal(sessions.stateOf('tab')?.lines, 2)
  const model = fakeModel('a\nb')
  sessions.attachModel('tab', model, 'typescript')
  assert.deepEqual(opened, ['tab'])
  assert.equal(sessions.stateOf('tab')?.dirty, false)
})

test('编辑后保持脏状态，磁盘文本回装后基线前移', () => {
  const { sessions, model } = readyTab('one\n')
  model.edit('two\n')
  sessions.refreshDirty('tab-1')
  assert.equal(sessions.stateOf('tab-1')?.dirty, true)
  sessions.loaded('tab-1', { text: 'disk\n', version: 'v2', revision: 2 })
  assert.equal(sessions.stateOf('tab-1')?.diskRevision, 1)
  model.setValue('disk\n')
  sessions.appliedDiskText('tab-1', model)
  assert.equal(sessions.stateOf('tab-1')?.dirty, false)
  assert.equal(sessions.stateOf('tab-1')?.version, 'v2')
})

test('保存期间继续编辑：成功后仍标记为未保存', () => {
  const { sessions, model } = readyTab('one\n')
  model.edit('two\n')
  sessions.refreshDirty('tab-1')
  sessions.beginSave('tab-1')
  // 保存请求在飞行中，用户又敲了一个字。
  model.edit('two more\n')
  sessions.saved('tab-1', 'v2')
  assert.equal(sessions.stateOf('tab-1')?.dirty, true, '磁盘上是 two，编辑器里是 two more')
  assert.equal(sessions.stateOf('tab-1')?.version, 'v2')
})

test('保存期间没有继续编辑：成功后回到干净状态', () => {
  const { sessions, model } = readyTab('one\n')
  model.edit('two\n')
  sessions.refreshDirty('tab-1')
  sessions.beginSave('tab-1')
  sessions.saved('tab-1', 'v2')
  assert.equal(sessions.stateOf('tab-1')?.dirty, false)
})

test('放弃本地编辑后可以重新读取，不会再次进入冲突', () => {
  const { sessions, model } = readyTab('one\n')
  model.edit('two\n')
  sessions.refreshDirty('tab-1')
  sessions.conflict('tab-1', '磁盘已变化')
  assert.equal(sessions.stateOf('tab-1')?.conflict, true)
  sessions.discardLocal('tab-1')
  assert.equal(sessions.stateOf('tab-1')?.conflict, false)
  assert.equal(sessions.stateOf('tab-1')?.dirty, false)
  assert.equal(sessions.viewOf('tab-1')?.revision, -1, '下一次读取必须重新发起')
})

test('同一标签页换文件时整条状态重建', () => {
  const { sessions, model } = readyTab('one\n')
  model.edit('two\n')
  sessions.refreshDirty('tab-1')
  const closed: string[] = []
  sessions.on('close', tabId => { closed.push(tabId) })
  sessions.ensure('tab-1', { sessionId: 'session-1', path: 'C:/repo/b.ts' })
  assert.deepEqual(closed, ['tab-1'])
  assert.equal(sessions.stateOf('tab-1')?.path, 'C:/repo/b.ts')
  assert.equal(sessions.stateOf('tab-1')?.phase, 'idle')
  assert.equal(sessions.stateOf('tab-1')?.dirty, false)
  assert.equal(sessions.stateOf('tab-1')?.modelRevision, 0)
  assert.equal(sessions.viewOf('tab-1')?.model, undefined)
  assert.equal(sessions.viewOf('tab-1')?.revision, -1)
})

test('取消尚未出内容的读取会退回空闲，已有内容时不受影响', () => {
  const sessions = new EditorSessions()
  sessions.ensure('tab', { sessionId: 's', path: 'C:/a.ts' })
  sessions.beginLoad('tab', 3)
  sessions.cancelLoad('tab')
  assert.equal(sessions.stateOf('tab')?.phase, 'idle')
  assert.equal(sessions.viewOf('tab')?.revision, -1)

  const ready = readyTab('x\n')
  ready.sessions.beginLoad('tab-1', 4)
  ready.sessions.cancelLoad('tab-1')
  assert.equal(ready.sessions.stateOf('tab-1')?.phase, 'ready')
  assert.equal(ready.sessions.viewOf('tab-1')?.revision, 4, '已经有内容时不退回代数，避免重复读取')
})

test('计数与脏状态写入都会通知订阅者', () => {
  const { sessions, model } = readyTab('a\nb\nc')
  let notifications = 0
  sessions.subscribe(() => { notifications += 1 })
  sessions.setPosition('tab-1', 2, 3, 3)
  sessions.setPosition('tab-1', 2, 3, 3)
  assert.equal(notifications, 1, '值没变时不该通知')
  model.edit('a\n')
  sessions.refreshDirty('tab-1')
  assert.equal(notifications, 2)
})

test('countLines 把空文本算作一行', () => {
  assert.equal(countLines(''), 1)
  assert.equal(countLines('a'), 1)
  assert.equal(countLines('a\n'), 2)
  assert.equal(countLines('a\nb\nc'), 3)
})
