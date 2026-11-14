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
import type { Disposable } from '../types.ts'

/** 镜像到根元素上的变量前缀。 */
const PREFIX = '--vscode-'

/** Monaco 注入配色变量的样式表类名。 */
const COLOR_SHEET_CLASS = 'monaco-colors'

/** 由本模块写入的变量，卸载时按此清理。 */
const OWNED_ATTRIBUTE = 'data-dsh-monaco-shadow-vars'

/**
 * 由宿主提供、Monaco 只引用不定义的变量。
 *
 * Monaco 的浮层样式写成 `border-radius: var(--vscode-cornerRadius-large)`、
 * `border: var(--vscode-strokeThickness) solid …`、`box-shadow: var(--vscode-shadow-lg)`，
 * 这些变量在 VS Code 里由工作台样式给出，Monaco 自己的配色表里没有。宿主不提供时
 * 整条声明失效，菜单就变成直角、无边框——和 DSH 其他面板的观感对不上。
 * 取值对齐 DSH 的圆角与阴影层次。
 */
const HOST_DEFAULTS: Record<string, string> = {
  '--vscode-cornerRadius-small': '4px',
  '--vscode-cornerRadius-medium': '6px',
  '--vscode-cornerRadius-large': '8px',
  '--vscode-strokeThickness': '1px',
  '--vscode-shadow-lg': '0 12px 32px rgba(0, 0, 0, 0.28)',
}

/** 需要记录的日志接口。 */
interface Logger {
  warn(format: unknown, ...params: unknown[]): void
}

/**
 * 收集一份样式表里声明的变量名与最终值。
 *
 * 同一个变量可能在多条规则里出现（亮/暗各一组），按声明顺序取最后一条，
 * 与浏览器层叠的结果一致。
 * @param sheet - 样式表。
 * @returns 变量名到值的映射。
 */
function collectFromSheet(sheet: CSSStyleSheet): Map<string, string> {
  const values = new Map<string, string>()
  let rules: CSSRuleList
  try {
    rules = sheet.cssRules
  } catch {
    // 跨源样式表读不到规则；Monaco 的配色表是同源注入的，读不到就说明不是它。
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
 * 把 Monaco 的配色变量镜像到根元素。
 *
 * 只写入本模块声明过的变量；换主题后旧变量会被新值覆盖，已消失的变量会被移除，
 * 不会在根元素上留下一份过期的混合配色。
 * @param logger - 读不到配色表时的记录点。
 * @returns 一次镜像的结果：写入数量，以及是否找到了配色表。
 */
export function mirrorShadowVariables(logger: Logger): { applied: number, sources: number } {
  const collected = new Map<string, string>()
  let sources = 0
  for (const node of document.querySelectorAll(`style.${COLOR_SHEET_CLASS}, link.${COLOR_SHEET_CLASS}`)) {
    const sheet = (node as HTMLStyleElement).sheet
    if (sheet === undefined || sheet === null) continue
    sources += 1
    for (const [name, value] of collectFromSheet(sheet)) collected.set(name, value)
  }
  if (sources === 0) {
    logger.warn('dsh-monaco: 没有找到 Monaco 的配色样式表（style.%s），浮层将沿用页面配色', COLOR_SHEET_CLASS)
    return { applied: 0, sources: 0 }
  }

  // 宿主默认值先落地，Monaco 自己声明过的同名变量随后覆盖它——未来版本自带这些变量时以后者为准。
  const effective = new Map<string, string>(Object.entries(HOST_DEFAULTS))
  for (const [name, value] of collected) effective.set(name, value)

  const root = document.documentElement
  const previous = root.getAttribute(OWNED_ATTRIBUTE)
  const owned = previous === null ? [] : previous.split('\n').filter(name => name.length > 0)

  let applied = 0
  for (const [name, value] of effective) {
    root.style.setProperty(name, value)
    applied += 1
  }
  // 新配色里已经不存在的变量必须撤掉，否则会盖住后续主题的正确取值。
  for (const name of owned) {
    if (!effective.has(name)) root.style.removeProperty(name)
  }
  root.setAttribute(OWNED_ATTRIBUTE, [...effective.keys()].join('\n'))
  return { applied, sources }
}

/**
 * 开始跟随 Monaco 的配色表。
 *
 * Monaco 在切换主题时会替换（或重写）`style.monaco-colors`，这里用 `MutationObserver`
 * 盯着 `head` 的子树变化重新镜像；观察回调合并到一个微任务，避免一次主题切换触发多轮写入。
 * @param logger - 记录点。
 * @returns 停止跟随并撤掉写入的变量。
 */
export function followShadowVariables(logger: Logger): Disposable {
  let queued = false
  let disposed = false
  const sync = (): void => {
    if (disposed) return
    mirrorShadowVariables(logger)
  }
  const schedule = (): void => {
    if (queued || disposed) return
    queued = true
    queueMicrotask(() => {
      queued = false
      sync()
    })
  }

  sync()
  const observer = new MutationObserver(schedule)
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })

  return () => {
    disposed = true
    observer.disconnect()
    const root = document.documentElement
    const owned = root.getAttribute(OWNED_ATTRIBUTE)
    if (owned !== null) {
      for (const name of owned.split('\n')) {
        if (name.length > 0) root.style.removeProperty(name)
      }
      root.removeAttribute(OWNED_ATTRIBUTE)
    }
  }
}
