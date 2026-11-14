/**
 * 由界面主题变量派生的 Monaco 主题，以及编辑器字体。
 *
 * 平台把主题暴露成 `--dsw-alias-*` / `--ds-font-family-*` 变量，而这些变量的**声明值**
 * 往往还是一串 `var()`（甚至 `color-mix()`），Monaco 只接受最终颜色与真实字体族串。
 * 因此这里不手工沿变量链猜，而是创建一个临时元素，把 `var(--x)` 赋给它的标准属性，
 * 再从 `getComputedStyle` 读回浏览器解析后的值。
 *
 * 读回的值还必须再规范成 **十六进制**：Monaco 0.57 的主题色只认 `#rrggbb` / `#rrggbbaa`，
 * 传入 `rgb()` / `rgba()` / `color(srgb …)` 会在 `editor.create` 时抛
 * `Illegal value for token color`，整个编辑器停在半初始化状态（默认白底、无语法色）。
 * 颜色值为 `undefined` 同样会抛错，所以解析不出的键必须直接不写。
 * @module dsh-monaco/client/monaco/theme
 */
import type * as Monaco from 'monaco-editor'

/** 跟随界面主题时使用的主题标识前缀。 */
const SCHEME_THEME_PREFIX = 'dsh-monaco-'

/**
 * 本插件用到的界面变量。
 *
 * 语义必须对上：`brand-primary` 是文字主色级（暗色近白、亮色近黑），
 * 不是品牌强调色，所以选中、光标、焦点框一律不用它。
 */
const TOKENS = {
  base: '--dsw-alias-bg-base',
  layer1: '--dsw-alias-bg-layer-1',
  layer2: '--dsw-alias-bg-layer-2',
  /** 第三层嵌套表面：Monaco 的浮层与建议框用它，比 overlay 的蒙层色更合适。 */
  layer3: '--dsw-alias-bg-layer-3',
  border1: '--dsw-alias-border-l1',
  border2: '--dsw-alias-border-l2',
  border4: '--dsw-alias-border-l4',
  /** 文档选中的专用变量：主题自己的蓝色蒙层。 */
  documentSelection: '--dsw-alias-bg-document-selection',
  /** 品牌强调色（真正的蓝），用于光标与焦点框。 */
  accent: '--dsw-alias-brand-primary-new-colorprimary-new-color',
  labelPrimary: '--dsw-alias-label-primary',
  labelSecondary: '--dsw-alias-label-secondary',
  labelDimmed: '--dsw-alias-label-primary-dimmed',
  error: '--dsw-alias-state-error-primary',
  warn: '--dsw-alias-state-warn-primary',
} as const

/** 编辑器字体相关的界面变量。 */
const FONT_TOKENS = {
  /** body 上合成好的代码字体栈（用户设置 + 内置栈）。 */
  codeFamily: '--ds-font-family-code',
  /** 代码字号（px）。 */
  codeSize: '--dsh-code-font-size',
  /** 代码字体栈的兜底，与平台注释一致地不追加裸 `monospace`。 */
  codeFamilyFallback: '--dsh-font-family-code-default',
} as const

/** 字体栈兜底：平台的代码字体默认栈，末尾不加裸 monospace（Windows 中文会落到宋体）。 */
const CODE_FALLBACK = "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'"

/** 十六进制颜色的匹配：`#rgb`、`#rgba`、`#rrggbb`、`#rrggbbaa`。 */
const HEX_COLOR = /^#([0-9a-f]{3,8})$/iu

/**
 * 跟随界面主题时，某个配色方案对应的 Monaco 主题标识。
 * @param scheme - 亮色或暗色。
 * @returns Monaco 主题标识。
 */
export function schemeThemeId(scheme: 'light' | 'dark'): string {
  return `${SCHEME_THEME_PREFIX}${scheme}`
}

/** 把 0–255 的分量写成两位十六进制。 */
function byteHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
}

/** 把 0–1 的透明度写成两位十六进制。 */
function alphaHex(value: number): string {
  return byteHex(value * 255)
}

/**
 * 把一个 CSS 颜色规范成 Monaco 接受的十六进制写法。
 *
 * 覆盖 `getComputedStyle` 实际会给出的几种形态：`rgb()/rgba()`、`#hex`，
 * 以及 `color-mix()` 计算后得到的 `color(srgb r g b / a)`。
 * @param value - 任意 CSS 颜色文本。
 * @returns `#rrggbb` 或 `#rrggbbaa`；无法解析时为 `undefined`。
 */
export function toHexColor(value: string): string | undefined {
  const text = value.trim()
  if (text.length === 0) return undefined

  const hex = HEX_COLOR.exec(text)
  if (hex !== null) {
    const digits = hex[1] ?? ''
    const expand = (part: string): number => parseInt(part.length === 1 ? part + part : part, 16)
    if (digits.length === 3) return `#${byteHex(expand(digits[0] ?? '0'))}${byteHex(expand(digits[1] ?? '0'))}${byteHex(expand(digits[2] ?? '0'))}`
    if (digits.length === 4) {
      return `#${byteHex(expand(digits[0] ?? '0'))}${byteHex(expand(digits[1] ?? '0'))}${byteHex(expand(digits[2] ?? '0'))}${byteHex(expand(digits[3] ?? '0'))}`
    }
    if (digits.length === 6) return `#${digits.toLowerCase()}`
    if (digits.length === 8) return `#${digits.toLowerCase()}`
    return undefined
  }

  const functional = /^rgba?\(([^)]+)\)$/iu.exec(text)
  if (functional !== null) {
    const parts = (functional[1] ?? '').split(/[,/\s]+/u).filter(part => part.length > 0)
    if (parts.length < 3) return undefined
    const channels = parts.slice(0, 3).map(part => Number.parseFloat(part))
    if (channels.some(channel => !Number.isFinite(channel))) return undefined
    const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3])
    const body = channels.map(channel => byteHex(channel)).join('')
    return Number.isFinite(alpha) && alpha < 1 ? `#${body}${alphaHex(alpha)}` : `#${body}`
  }

  // `color(srgb r g b / a)`：分量是 0–1 的浮点数，是 color-mix() 在 Chromium 里的计算结果形态。
  const srgb = /^color\(srgb\s+([^)]+)\)$/iu.exec(text)
  if (srgb !== null) {
    const parts = (srgb[1] ?? '').split(/[/\s]+/u).filter(part => part.length > 0)
    if (parts.length < 3) return undefined
    const channels = parts.slice(0, 3).map(part => Number.parseFloat(part) * 255)
    if (channels.some(channel => !Number.isFinite(channel))) return undefined
    const alpha = parts[3] === undefined ? 1 : Number.parseFloat(parts[3])
    const body = channels.map(channel => byteHex(channel)).join('')
    return Number.isFinite(alpha) && alpha < 1 ? `#${body}${alphaHex(alpha)}` : `#${body}`
  }

  return undefined
}

/**
 * 在颜色现有透明度之上再叠加一层透明度。
 *
 * 界面里大量边框本身就是半透明的（暗色 `border-l1` 是 `rgba(255,255,255,0.06)`），
 * 若用新值直接覆盖透明度，6% 的白会被放大成 50% 的白，滚动条会白得刺眼。
 * @param color - 任意十六进制颜色，可已带透明度。
 * @param alpha - 0 到 1 的额外不透明度系数。
 * @returns 叠加后的 `#rrggbbaa`；入参不是十六进制时原样返回，交由调用方的规范环节处理。
 */
export function colorWithAlpha(color: string, alpha: number): string {
  const hex = HEX_COLOR.exec(color.trim())
  if (hex === null) return color
  const digits = hex[1] ?? ''
  const expand = (part: string): number => parseInt(part.length === 1 ? part + part : part, 16)
  const channels = digits.length === 3 || digits.length === 4
    ? [expand(digits[0] ?? '0'), expand(digits[1] ?? '0'), expand(digits[2] ?? '0')]
    : [expand(digits.slice(0, 2)), expand(digits.slice(2, 4)), expand(digits.slice(4, 6))]
  const existing = digits.length === 4
    ? expand(digits[3] ?? 'f') / 255
    : digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1
  return `#${channels.map(channel => byteHex(channel)).join('')}${alphaHex(existing * alpha)}`
}

/**
 * 让浏览器把一个 CSS 变量解析成最终值。
 *
 * 临时元素挂在 `body` 下，因此能读到 body 上由主题脚本写入的字体与颜色变量。
 * 变量未定义时浏览器会回退成继承值而不是报错，所以用哨兵值把「未定义」识别出来。
 * @param variable - 含 `--` 前缀的变量名。
 * @param property - 把变量套用的标准属性名（`color` 或 `font-family`）。
 * @returns 浏览器解析后的最终值；变量不存在时返回 `undefined`。
 */
export function resolveCssValue(variable: string, property: 'color' | 'font-family'): string | undefined {
  const host = document.body ?? document.documentElement
  if (host === null) return undefined
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  const sentinel = property === 'color' ? 'rgb(1, 2, 3)' : "'dsh-monaco-missing-font'"
  probe.style.setProperty(property, `var(${variable}, ${sentinel})`)
  host.appendChild(probe)
  try {
    const computed = getComputedStyle(probe)
    const value = (property === 'color' ? computed.color : computed.fontFamily)?.trim() ?? ''
    if (value.length === 0) return undefined
    const normalized = value.replace(/\s+/gu, '').toLowerCase()
    if (property === 'color') {
      if (normalized === 'rgb(1,2,3)') return undefined
    } else if (normalized.includes('dsh-monaco-missing-font')) {
      return undefined
    }
    return value
  } finally {
    probe.remove()
  }
}

/** 记录被丢弃的颜色时的最小日志接口。 */
export interface TokenLogger {
  warn(format: unknown, ...params: unknown[]): void
}

/**
 * 读取本插件需要的全部界面颜色，并规范成十六进制。
 * @param logger - 无法规范的变量在此留痕，不静默丢弃。
 * @returns 变量名到 `#rrggbb` / `#rrggbbaa` 的映射；解析不出的变量不在其中。
 */
export function readDocumentTokens(logger: TokenLogger): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const [key, variable] of Object.entries(TOKENS)) {
    const raw = resolveCssValue(variable, 'color')
    if (raw === undefined) continue
    const hex = toHexColor(raw)
    if (hex === undefined) {
      logger.warn('dsh-monaco: 主题变量 %s 的值 "%s" 无法规范成十六进制，已跳过该配色键', variable, raw)
      continue
    }
    tokens[key] = hex
  }
  return tokens
}

/** 编辑器使用的字体与字号。 */
export interface EditorFont {
  /** 传给 Monaco `fontFamily` 的真实字体族串。 */
  readonly family: string
  /** 字号（px）；字号变量缺失时为 `undefined`。 */
  readonly size: number | undefined
}

/**
 * 读取 DSH 设置的代码字体与字号。
 *
 * `--ds-font-family-code` 是平台在 body 上合成的字体栈（用户设置 + 内置栈），
 * 用临时元素交给浏览器解析后就是 Monaco 需要的真实字体族串。
 * @returns 字体族串必有值（缺失时用平台默认栈），字号可能为 `undefined`。
 */
export function readEditorFont(): EditorFont {
  const family = resolveCssValue(FONT_TOKENS.codeFamily, 'font-family')
    ?? resolveCssValue(FONT_TOKENS.codeFamilyFallback, 'font-family')
    ?? CODE_FALLBACK
  const host = document.body ?? document.documentElement
  const rawSize = host === null ? '' : getComputedStyle(host).getPropertyValue(FONT_TOKENS.codeSize).trim()
  const parsed = rawSize.length === 0 ? Number.NaN : Number.parseFloat(rawSize)
  return { family, size: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined }
}

/**
 * 生成 Monaco 的编辑器配色表。
 * @param tokens - 已规范成十六进制的界面颜色。
 * @returns 只包含已知变量的颜色表；未提供的键不写入，交由基础主题补齐。
 */
export function buildThemeColors(tokens: Readonly<Record<string, string>>): Record<string, string> {
  const colors: Record<string, string> = {}
  const set = (key: string, color: string | undefined): void => {
    if (color !== undefined) colors[key] = color
  }
  const {
    base, layer1, layer2, layer3, border1, border2, border4,
    documentSelection, accent, labelPrimary, labelSecondary, labelDimmed, error, warn,
  } = tokens
  // 浮层表面：第三层最接近「浮起的面板」，缺失时退到第二层。
  const widgetSurface = layer3 ?? layer2

  set('editor.background', base)
  set('editor.foreground', labelPrimary)
  set('editorGutter.background', base)
  set('editorLineNumber.foreground', labelSecondary ?? labelDimmed)
  set('editorLineNumber.activeForeground', labelPrimary)
  set('editor.lineHighlightBackground', layer2)
  // 选中用主题自己的文档选中蒙层；没有就退回强调色的半透明，且不使用文字主色。
  set('editor.selectionBackground', documentSelection ?? (accent === undefined ? undefined : colorWithAlpha(accent, 0.28)))
  set('editor.inactiveSelectionBackground',
    documentSelection === undefined ? undefined : colorWithAlpha(documentSelection, 0.55))
  set('editor.selectionHighlightBackground', documentSelection)
  set('editorCursor.foreground', accent ?? labelPrimary)
  set('editorBracketMatch.border', accent === undefined ? undefined : colorWithAlpha(accent, 0.6))
  set('editorIndentGuide.background1', border1)
  set('editorIndentGuide.activeBackground1', border2)
  set('editorWidget.background', widgetSurface)
  set('editorWidget.border', border2)
  set('editorHoverWidget.background', widgetSurface)
  set('editorHoverWidget.border', border2)
  set('editorSuggestWidget.background', widgetSurface)
  set('editorSuggestWidget.border', border2)
  set('editorSuggestWidget.selectedBackground', layer2)
  set('editorError.foreground', error)
  set('editorWarning.foreground', warn)
  // 编辑器不设 editorInfo：主题的 idle 级在这个底色上过暗，交给基础主题。
  // 滚动条滑块直接用边框色的既有透明度：暗色下是 12% 的白，足够看见又不抢注意力。
  set('scrollbarSlider.background', border2)
  set('scrollbarSlider.hoverBackground', border2 === undefined ? undefined : colorWithAlpha(border2, 1.6))
  set('scrollbarSlider.activeBackground', border4)
  set('focusBorder', accent === undefined ? undefined : colorWithAlpha(accent, 0.5))
  set('input.background', widgetSurface)
  set('input.border', border2)
  return colors
}

/**
 * 生成一个跟随界面主题的 Monaco 主题定义。
 * @param scheme - 界面配色方案。
 * @param tokens - 已规范成十六进制的界面颜色。
 * @returns 可直接交给 `monaco.editor.defineTheme` 的定义。
 */
export function buildSchemeTheme(
  scheme: 'light' | 'dark',
  tokens: Readonly<Record<string, string>>,
): Monaco.editor.IStandaloneThemeData {
  return {
    base: scheme === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [],
    colors: buildThemeColors(tokens),
  }
}

/** 一个已注册主题的定义。 */
export interface RegisteredTheme {
  readonly id: string
  readonly label: string
  readonly base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'
  readonly inherit: boolean
  readonly rules: readonly Monaco.editor.ITokenThemeRule[]
  readonly colors: Readonly<Record<string, string>>
}

/**
 * 把一个已注册主题转成 Monaco 主题定义。
 * @param theme - 已注册主题。
 * @returns Monaco 主题定义。
 */
export function themeDefinitionOf(theme: RegisteredTheme): Monaco.editor.IStandaloneThemeData {
  return {
    base: theme.base,
    inherit: theme.inherit,
    rules: [...theme.rules],
    colors: { ...theme.colors },
  }
}
