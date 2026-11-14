import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MONACO_SAVE_PROTOCOL, parseSaveFileRequest } from '../src/shared/protocol.ts'

const base = {
  protocol: MONACO_SAVE_PROTOCOL,
  sessionId: 'session-1',
  path: 'C:/repo/main.ts',
  text: 'export {}\n',
}

test('parseSaveFileRequest 接受完整请求', () => {
  const result = parseSaveFileRequest({ ...base, expectedVersion: 'v1' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.ok && result.value, { ...base, expectedVersion: 'v1' })
})

test('parseSaveFileRequest 省略 expectedVersion 表示无条件覆盖', () => {
  const result = parseSaveFileRequest(base)
  assert.equal(result.ok, true)
  assert.equal(result.ok && 'expectedVersion' in result.value, false)
})

test('parseSaveFileRequest 拒绝非对象与错误协议版本', () => {
  assert.equal(parseSaveFileRequest(null).ok, false)
  assert.equal(parseSaveFileRequest([]).ok, false)
  assert.equal(parseSaveFileRequest({ ...base, protocol: 2 }).ok, false)
  assert.equal(parseSaveFileRequest({ ...base, protocol: undefined }).ok, false)
})

test('parseSaveFileRequest 校验必填字符串', () => {
  assert.equal(parseSaveFileRequest({ ...base, sessionId: '' }).ok, false)
  assert.equal(parseSaveFileRequest({ ...base, path: 42 }).ok, false)
  assert.equal(parseSaveFileRequest({ ...base, text: undefined }).ok, false)
  assert.equal(parseSaveFileRequest({ ...base, expectedVersion: '' }).ok, false)
})

test('parseSaveFileRequest 拒绝含 NUL 的标识与路径', () => {
  assert.equal(parseSaveFileRequest({ ...base, path: 'C:/a\u0000b.ts' }).ok, false)
  assert.equal(parseSaveFileRequest({ ...base, sessionId: 'a\u0000b' }).ok, false)
})

test('parseSaveFileRequest 保留空文本（清空文件是合法保存）', () => {
  const result = parseSaveFileRequest({ ...base, text: '' })
  assert.equal(result.ok, true)
  assert.equal(result.ok && result.value.text, '')
})
