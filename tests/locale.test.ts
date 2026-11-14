import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monacoLocaleFor } from '../src/shared/locale.ts'

test('monacoLocaleFor 把 DSH 语言映射到 Monaco 消息包', () => {
  assert.equal(monacoLocaleFor('zh'), 'zh-cn')
  assert.equal(monacoLocaleFor('zh-CN'), 'zh-cn')
  assert.equal(monacoLocaleFor('zh_Hans'), 'zh-cn')
  assert.equal(monacoLocaleFor('zh-TW'), 'zh-tw')
  assert.equal(monacoLocaleFor('ja'), 'ja')
  assert.equal(monacoLocaleFor('pt-BR'), 'pt-br')
  assert.equal(monacoLocaleFor('de'), 'de')
})

test('monacoLocaleFor 对英语与未知语言返回 undefined', () => {
  assert.equal(monacoLocaleFor('en'), undefined)
  assert.equal(monacoLocaleFor('en-US'), undefined)
  assert.equal(monacoLocaleFor(''), undefined)
  assert.equal(monacoLocaleFor('ko-KR-extra'), 'ko')
  assert.equal(monacoLocaleFor('nl'), undefined)
})
