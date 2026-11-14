/**
 * Monaco 的独立浮层（右键菜单、命令面板）在页面里拿不到主题变量。
 *
 * 这些浮层并不渲染在编辑器内部：Monaco 把它们塞进一个 `div.shadow-root-host` 的
 * Shadow DOM 里，宿主的 `:host { all: initial }` 会切断所有继承，而 `--vscode-*` 变量只声明在
 * `.monaco-editor` / `.monaco-component` 上。结果是浮层里
 * `background-color: var(--vscode-menu-background)` 整条失效（背景透明）、
 * `color: var(--vscode-menu-foreground)` 回落到初始值（黑字）——深色背景上的黑字既看不见，
 * 也让菜单失去了边框、圆角与阴影。
 *
 * 修法是把这些变量补到 `document.documentElement` 上：Shadow DOM 的宿主继承自 document，
 * 变量可按自定义属性正常继承进 shadow 树。变量取自 Monaco 自己注入的 `style.monaco-colors`，
 * 因此亮暗主题切换后重新镜像即可跟上，不需要在这里重复维护一份配色。
 * @module dsh-monaco/client/monaco/shadow-vars
 */
import { colorWithAlpha, resolveCssValue } from './theme.ts'
import type { Disposable } from '../types.ts'

/** 镜像到根元素上的变量前缀。 */
const PREFIX = '--vscode-'

/** Monaco 注入配色变量的样式表类名。 */
const COLOR_SHEET_CLASS = 'monaco-colors'

/**
 * Monaco 只引用、不定义的变量。
 *
 * 浮层样式写成 `border-radius: var(--vscode-cornerRadius-large)`、
 * `border: var(--vscode-strokeThickness) solid …`、`box-shadow: var(--vscode-shadow-lg)`，
 * 这些在 VS Code 里由工作台样式提供。宿主不提供时整条声明失效，菜单就变成直角、无边框。
 * 圆角与描边与主题无关，用固定值；阴影像本插件其他浮层一样走主题 token。
 */
const STATIC_DEFAULTS: Readonly<Record<string, string>> = {
  '--vscode-cornerRadius-small': '4px',
  '--vscode-cornerRadius-medium': '6px',
  '--vscode-cornerRadius-large': '8px',
  '--vscode-strokeThickness': '1px',
}

/** 阴影的兜底：主题没有提供蒙层色时使用。 */
const SHADOW_FALLBACK = '0 12px 32px rgba(0, 0, 0, 0.28)'

/** 需要记录的日志接口。 */
interface Logger {
  warn(format: unknown, ...params: unknown[]): void
}

/**
 * 收集一份样式表里声明的变量最终值。
 *
 * Monaco 只输出当前激活主题的一份变量，所以换主题后必须重新读取。
 * 只遍历顶层规则：配色变量由 Monaco 直接写在顶层，条件规则里的同名变量不参与这里。
 * @param sheet - 样式表。
 * @param logger - 读不到规则时留痕；跨源样式表在浏览器里本来就读不到，不视为异常。
 * @returns 变量名到值的映射。
 */
function collectFromSheet(sheet: CSSStyleSheet, logger: Logger): Map<string, string> {
  const values = new Map<string, string>()
  let rules: CSSRuleList
  try {
    rules = sheet.cssRules
  } catch (error) {
    logger.warn('dsh-monaco: 无法读取 Monaco 配色样式表的规则（%s），浮层配色可能不完整',
      error instanceof Error ? error.message : String(error))
    return values
  }
  for (const rule of rules) {
    const style = (rule as CSSStyleRule).style
    if (style === undefined || style === null) continue
    for (let index = 0; index < style.length; index += 1) {
      const name = style.item(index)
      if (!name.startsWith(PREFIX)) continue
      const value = style.getPropertyValue(name).trim()
      if (value.length > 0) values.set(name, value)
    }
  }
  return values
}

/**
 * 算出要写到根元素上的变量集合。
 * @param logger - 记录点。
 * @returns 变量表，以及找到的配色表数量。
 */
function desiredVariables(logger: Logger): { values: Map<string, string>, sources: number } {
  const values = new Map<string, string>(Object.entries(STATIC_DEFAULTS))
  const shadowSource = resolveCssValue('--dsw-alias-bg-mask-3', 'color')
  const shadowColor = shadowSource === undefined ? undefined : colorWithAlpha(shadowSource, 1)
  values.set('--vscode-shadow-lg', shadowColor === undefined ? SHADOW_FALLBACK : `0 12px 32px ${shadowColor}`)

  let sources = 0
  for (const node of document.querySelectorAll(`style.${COLOR_SHEET_CLASS}`)) {
    const sheet = (node as HTMLStyleElement).sheet
    if (sheet === undefined || sheet === null) continue
    sources += 1
    // 宿主默认值先落地，Monaco 自己声明过的同名变量随后覆盖它。
    for (const [name, value] of collectFromSheet(sheet, logger)) values.set(name, value)
  }
  return { values, sources }
}

/**
 * 开始跟随 Monaco 的配色表。
 *
 * 首次同步发生在插件挂载时，那时 Monaco 可能还没创建任何编辑器、配色表尚不存在——
 * 这种情况不记为异常，等 `MutationObserver` 看到样式表注入后再镜像。
 * 观察目标在找到配色表后收敛到它自身，避免页面里任何 `head` 变化都触发一次全量重读。
 * @param logger - 记录点。
 * @returns 停止跟随并撤掉写入的变量。
 */
export function followShadowVariables(logger: Logger): Disposable {
  const root = document.documentElement
  /** 由本模块写入的变量名，卸载时只清这些。 */
  const owned = new Set<string>()
  let sheetObserver: MutationObserver | undefined
  let headObserver: MutationObserver | undefined
  let queued = false
  let disposed = false
  let seen = false

  const sync = (): void => {
    if (disposed) return
    const { values, sources } = desiredVariables(logger)
    if (sources === 0) {
      // 挂载早期就还没有配色表，或者主题切换过程中被短暂移除；两种情况都等下一次通知。
      if (seen) logger.warn('dsh-monaco: Monaco 的配色样式表已消失，浮层配色可能不同步')
      return
    }
    seen = true
    for (const [name, value] of values) {
      if (root.style.getPropertyValue(name) === value) continue
      root.style.setProperty(name, value)
      owned.add(name)
    }
    // 新配色里已经不存在的变量必须撤掉，否则会盖住后续主题的正确取值。
    for (const name of owned) {
      if (values.has(name)) continue
      root.style.removeProperty(name)
      owned.delete(name)
    }
    watchSheets()
  }

  const schedule = (): void => {
    if (queued || disposed) return
    queued = true
    queueMicrotask(() => {
      queued = false
      sync()
    })
  }

  /** 配色表出现后把观察范围收敛到它自身。 */
  const watchSheets = (): void => {
    const sheet = document.querySelector(`style.${COLOR_SHEET_CLASS}`)
    if (sheet === null || sheetObserver !== undefined) return
    headObserver?.disconnect()
    headObserver = undefined
    sheetObserver = new MutationObserver(schedule)
    // Monaco 换主题时改写既有 `<style>` 的文本，而不是替换节点。
    sheetObserver.observe(sheet, { characterData: true, childList: true, subtree: true })
  }

  sync()
  if (sheetObserver === undefined) {
    // 配色表还没出现：只盯着 `head` 的直接子节点变化，等待 `<style class="monaco-colors">` 注入。
    headObserver = new MutationObserver(schedule)
    headObserver.observe(document.head, { childList: true })
  }

  return () => {
    disposed = true
    headObserver?.disconnect()
    sheetObserver?.disconnect()
    headObserver = undefined
    sheetObserver = undefined
    for (const name of owned) root.style.removeProperty(name)
    owned.clear()
  }
}
