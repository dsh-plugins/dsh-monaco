import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claimedExtensions, normalizeExtension } from '../src/shared/claim.ts'

test('normalizeExtension 去点、小写并裁剪空白', () => {
  assert.equal(normalizeExtension('  .TS '), 'ts')
  assert.equal(normalizeExtension('..md'), 'md')
  assert.equal(normalizeExtension('tar.gz'), 'tar.gz')
})

test('normalizeExtension 拒绝空值与带路径分隔符的声明', () => {
  assert.throws(() => normalizeExtension('   '), /empty file extension/u)
  assert.throws(() => normalizeExtension('a/b'), /invalid file extension/u)
  assert.throws(() => normalizeExtension('a\\b'), /invalid file extension/u)
  assert.throws(() => normalizeExtension('a\u0000b'), /invalid file extension/u)
})

test('claimedExtensions 合并去重并排序', () => {
  assert.deepEqual(claimedExtensions(['TS', '.ts', 'md'], ['.tsx', 'MD', 'json']), ['json', 'md', 'ts', 'tsx'])
  assert.deepEqual(claimedExtensions([], []), [])
})

test('claimedExtensions 不修改传入的列表', () => {
  const base = ['ts']
  const extra = ['md']
  claimedExtensions(base, extra)
  assert.deepEqual(base, ['ts'])
  assert.deepEqual(extra, ['md'])
})
