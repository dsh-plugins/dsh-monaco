import { test } from 'node:test'
import assert from 'node:assert/strict'
import { containsNul, isAbsoluteFilePath } from '../src/shared/paths.ts'

test('isAbsoluteFilePath 识别 POSIX、UNC 与盘符路径', () => {
  assert.equal(isAbsoluteFilePath('/home/me/a.ts'), true)
  assert.equal(isAbsoluteFilePath('\\\\server\\share\\a.ts'), true)
  assert.equal(isAbsoluteFilePath('C:\\repo\\a.ts'), true)
  assert.equal(isAbsoluteFilePath('c:/repo/a.ts'), true)
})

test('isAbsoluteFilePath 把相对路径与单段名判为相对', () => {
  assert.equal(isAbsoluteFilePath('src/a.ts'), false)
  assert.equal(isAbsoluteFilePath('./src/a.ts'), false)
  assert.equal(isAbsoluteFilePath('a.ts'), false)
  assert.equal(isAbsoluteFilePath(''), false)
  // 盘符后面必须紧跟分隔符，`C:x` 是「盘符下的相对路径」，不是绝对路径。
  assert.equal(isAbsoluteFilePath('C:a.ts'), false)
})

test('containsNul 只认 NUL 字节', () => {
  assert.equal(containsNul('a\u0000b'), true)
  assert.equal(containsNul('a b'), false)
  assert.equal(containsNul(''), false)
})
