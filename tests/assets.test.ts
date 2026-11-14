import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveVsAssetPath } from '../src/shared/assets.ts'

test('resolveVsAssetPath 接受白名单内的静态资源', () => {
  assert.deepEqual(resolveVsAssetPath('loader.js'), {
    relativePath: 'loader.js',
    contentType: 'text/javascript; charset=utf-8',
  })
  assert.equal(resolveVsAssetPath('editor/editor.main.css')?.contentType, 'text/css; charset=utf-8')
  assert.equal(resolveVsAssetPath('nls/lang/zh-cn.js')?.relativePath, 'nls/lang/zh-cn.js')
})

test('resolveVsAssetPath 忽略查询串与片段', () => {
  assert.equal(resolveVsAssetPath('editor/editor.main.js?v=1')?.relativePath, 'editor/editor.main.js')
  assert.equal(resolveVsAssetPath('nls/lang/zh-cn.js#x')?.relativePath, 'nls/lang/zh-cn.js')
  assert.equal(resolveVsAssetPath('nls/lang/zh%2Dcn.js')?.relativePath, 'nls/lang/zh-cn.js')
})

test('resolveVsAssetPath 拒绝越界路径', () => {
  assert.equal(resolveVsAssetPath(''), undefined)
  assert.equal(resolveVsAssetPath('/'), undefined)
  assert.equal(resolveVsAssetPath('../editor/editor.main.js'), undefined)
  assert.equal(resolveVsAssetPath('editor/../../package.json'), undefined)
  assert.equal(resolveVsAssetPath('editor\\editor.main.js'), undefined)
  assert.equal(resolveVsAssetPath('nls/%2e%2e/editor.js'), undefined)
  assert.equal(resolveVsAssetPath('nls/%zz.js'), undefined)
})

test('resolveVsAssetPath 拒绝藏在单段里的分隔符', () => {
  assert.equal(resolveVsAssetPath('..%2f..%2fpackage.json'), undefined)
  assert.equal(resolveVsAssetPath('..%5c..%5cpackage.json'), undefined)
  assert.equal(resolveVsAssetPath('editor%2F..%2Feditor.main.js'), undefined)
  assert.equal(resolveVsAssetPath('nls/%2e%2e%2feditor.js'), undefined)
})

test('resolveVsAssetPath 只放行白名单扩展名', () => {
  assert.equal(resolveVsAssetPath('editor/editor.main'), undefined)
  assert.equal(resolveVsAssetPath('editor/editor.main.ts'), undefined)
  assert.equal(resolveVsAssetPath('.js'), undefined)
})
