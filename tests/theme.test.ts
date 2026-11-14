import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildThemeColors, colorWithAlpha, toHexColor } from '../src/client/monaco/theme.ts'

test('toHexColor 把 rgb()/rgba() 规范成十六进制', () => {
  assert.equal(toHexColor('rgb(21, 21, 23)'), '#151517')
  assert.equal(toHexColor('rgb(249, 250, 251)'), '#f9fafb')
  assert.equal(toHexColor('rgba(255, 255, 255, 0.12)'), '#ffffff1f')
  assert.equal(toHexColor('rgba(255 255 255 / 0.2)'), '#ffffff33')
  assert.equal(toHexColor('rgba(0, 0, 0, 0)'), '#00000000')
})

test('toHexColor 规范 color(srgb …)——color-mix() 的计算结果形态', () => {
  // --dsw-alias-bg-document-selection：静态蓝 rgb(59,130,246) 的 40% 蒙层
  assert.equal(toHexColor('color(srgb 0.231373 0.509804 0.964706 / 0.4)'), '#3b82f666')
  assert.equal(toHexColor('color(srgb 1 1 1)'), '#ffffff')
})

test('toHexColor 统一十六进制写法', () => {
  assert.equal(toHexColor('#ABC'), '#aabbcc')
  assert.equal(toHexColor('#11223344'), '#11223344')
  assert.equal(toHexColor('  #0F0F0F  '), '#0f0f0f')
})

test('toHexColor 对无法识别的写法返回 undefined', () => {
  assert.equal(toHexColor(''), undefined)
  assert.equal(toHexColor('currentColor'), undefined)
  assert.equal(toHexColor('#12'), undefined)
  assert.equal(toHexColor('rgb(1, 2)'), undefined)
  assert.equal(toHexColor('color(display-p3 1 0 0)'), undefined)
})

test('colorWithAlpha 在十六进制输入上叠加透明度', () => {
  assert.equal(colorWithAlpha('#3b82f6', 0.4), '#3b82f666')
  assert.equal(colorWithAlpha('#ffffff', 0.5), '#ffffff80')
  assert.equal(colorWithAlpha('#abc', 1), '#aabbccff')
})

test('colorWithAlpha 对已带透明度的颜色做乘法而不是覆盖', () => {
  // 暗色 border-l2 是 12% 的白（0x1f）；再乘 0.5 得到约 6%（四舍五入到 0x10），
  // 而不是被抬到 50% 的白。
  assert.equal(colorWithAlpha('#ffffff1f', 0.5), '#ffffff10')
  assert.equal(colorWithAlpha('#ffffff1f', 1), '#ffffff1f')
  // 四位十六进制的同类语义。
  assert.equal(colorWithAlpha('#ffff', 1), '#ffffffff')
  assert.equal(colorWithAlpha('#ffff', 0.5), '#ffffff80')
})

test('buildThemeColors 把文档选中色与强调色放到各自的语义键上', () => {
  const colors = buildThemeColors({
    base: '#151517',
    labelPrimary: '#f9fafb',
    documentSelection: '#3b82f666',
    accent: '#5686fe',
  })
  assert.equal(colors['editor.background'], '#151517')
  assert.equal(colors['editor.foreground'], '#f9fafb')
  assert.equal(colors['editor.selectionBackground'], '#3b82f666')
  assert.equal(colors['editorCursor.foreground'], '#5686fe')
  assert.equal(colors['focusBorder'], '#5686fe80')
})

test('buildThemeColors 在没有选中蒙层时退回强调色，且不使用文字主色', () => {
  const colors = buildThemeColors({ labelPrimary: '#f9fafb', accent: '#5686fe' })
  assert.equal(colors['editor.selectionBackground'], '#5686fe47')
  assert.equal(colors['editor.foreground'], '#f9fafb')
})

test('buildThemeColors 不写出任何非十六进制值（Monaco 会拒绝）', () => {
  const colors = buildThemeColors({
    base: '#151517',
    layer2: '#2c2c2e',
    border2: '#ffffff1f',
    border4: '#ffffff33',
    accent: '#5686fe',
    documentSelection: '#3b82f666',
    error: '#e5564b',
    warn: '#d9a441',
    idle: '#8b93a1',
  })
  for (const [key, value] of Object.entries(colors)) {
    assert.match(value, /^#[0-9a-f]{6}([0-9a-f]{2})?$/u, `${key} 必须是十六进制`)
  }
})

test('buildThemeColors 跳过无法解析的变量，交给基础主题补齐', () => {
  const colors = buildThemeColors({ base: '#151517' })
  assert.equal(colors['editor.background'], '#151517')
  assert.equal(colors['editorIndentGuide.background1'], undefined)
  assert.equal(colors['scrollbarSlider.background'], undefined)
  assert.equal(colors['editor.selectionBackground'], undefined)
  assert.equal(colors['editor.foreground'], undefined)
})

test('buildThemeColors 用边框色派生滚动条，且不放大既有透明度', () => {
  const colors = buildThemeColors({ border2: '#ffffff1f', border4: '#ffffff33' })
  assert.equal(colors['scrollbarSlider.background'], '#ffffff1f')
  assert.equal(colors['scrollbarSlider.hoverBackground'], '#ffffff32')
  assert.equal(colors['scrollbarSlider.activeBackground'], '#ffffff33')
})
