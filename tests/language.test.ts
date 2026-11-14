import { test } from 'node:test'
import assert from 'node:assert/strict'
import { languageForPath } from '../src/shared/language.ts'
import type { LanguageDescriptor } from '../src/shared/language.ts'

const descriptors: readonly LanguageDescriptor[] = [
  { id: 'dockerfile', extensions: ['.dockerfile'], filenames: ['Dockerfile'] },
  { id: 'typescript', extensions: ['.ts', '.mts', '.cts'] },
  { id: 'yaml', extensions: ['.yaml', '.yml'] },
  { id: 'plaintext', filenamePatterns: ['^\\.env(\\..+)?$'] },
]

test('languageForPath 按文件名优先匹配', () => {
  assert.equal(languageForPath(descriptors, '/repo/Dockerfile'), 'dockerfile')
  assert.equal(languageForPath(descriptors, 'C:\\repo\\dockerfile'), 'dockerfile')
})

test('languageForPath 取最长扩展名', () => {
  assert.equal(languageForPath(descriptors, '/repo/main.mts'), 'typescript')
  assert.equal(languageForPath(descriptors, '/repo/config.yaml'), 'yaml')
  assert.equal(languageForPath(descriptors, '/repo/Main.TS'), 'typescript')
})

test('languageForPath 在扩展名之外回退到文件名正则', () => {
  assert.equal(languageForPath(descriptors, '/repo/.env'), 'plaintext')
  assert.equal(languageForPath(descriptors, '/repo/.env.local'), 'plaintext')
  assert.equal(languageForPath(descriptors, '/repo/notes.txt'), undefined)
  assert.equal(languageForPath(descriptors, ''), undefined)
})

test('languageForPath 按描述表顺序处理同一扩展名', () => {
  const overlapping: readonly LanguageDescriptor[] = [
    { id: 'x', extensions: ['.inc'] },
    { id: 'y', extensions: ['.inc'] },
  ]
  assert.equal(languageForPath(overlapping, 'a.inc'), 'x')
})
