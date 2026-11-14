import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileNameOf } from '../src/client/editor/close-guard.ts'

test('fileNameOf 取路径最后一段', () => {
  assert.equal(fileNameOf('/home/user/project/src/index.ts'), 'index.ts')
  assert.equal(fileNameOf('C:\\Users\\Admin\\dsh-plugins\\tsconfig.json'), 'tsconfig.json')
  // 混合分隔符：以最后出现的那个为准。
  assert.equal(fileNameOf('C:\\Users/Admin/dsh-plugins\\arena.yml'), 'arena.yml')
})

test('fileNameOf 对没有分隔符的路径原样返回', () => {
  assert.equal(fileNameOf('arena.yml'), 'arena.yml')
  assert.equal(fileNameOf(''), '')
})

test('fileNameOf 对以分隔符结尾的路径回退到整段路径', () => {
  // 以分隔符结尾时最后一段为空，此时展示完整路径比显示空标题更有用。
  assert.equal(fileNameOf('/home/user/project/'), '/home/user/project/')
  assert.equal(fileNameOf('C:\\Users\\Admin\\'), 'C:\\Users\\Admin\\')
})
