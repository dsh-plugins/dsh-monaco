/**
 * 把有未保存改动的标签页标记出来。
 *
 * 标签芯片由平台的停靠组件绘制：标题单元格可以替换，关闭按钮不行——它由组件自己
 * 渲染成固定的 `×`。所以这里不接管标题，只在关闭按钮上打一个标记属性，
 * 由样式把它画成圆点（悬停时恢复成 `×`），标题与文件类型图标完全保持平台原样。
 *
 * 打标记的时机有两个：文档脏状态变化，以及标签条被重新渲染（React 重挂节点会丢掉外来属性）。
 * @module dsh-monaco/client/editor/tab-badges
 */
import type { Disposable } from '../types.ts'
import type { EditorSessions } from './sessions.ts'

/** 关闭按钮上的标记属性。 */
export const DIRTY_ATTRIBUTE = 'data-dsh-monaco-tab-dirty'

/** 关闭按钮的定位选择器。 */
export const CLOSE_BUTTON_SELECTOR = '[data-dockkit-tab-close]'

/** 标签页节点的定位选择器。 */
export const TAB_SELECTOR = '[data-dockkit-tab]'

/** 标签条容器的定位选择器。 */
const STRIP_SELECTOR = '[data-dockkit-strip-tabs]'

/** 关闭按钮上记录标签页 id 的字段。 */
const TAB_ID_FIELD = 'dockkitTabClose'

/** 标签页节点上记录标签页 id 的字段。 */
export const TAB_ID_ATTRIBUTE = 'dockkitTab'

/** 标签页未保存标记。 */
export class TabBadges {
  private readonly sessions: EditorSessions
  private readonly observers = new Map<Element, MutationObserver>()
  private frame: number | undefined
  /** 上一次真正应用到 DOM 的脏标签页列表；未变化时跳过重复查询。 */
  private applied: string | undefined

  /**
   * @param sessions - 文档状态容器。
   */
  constructor(sessions: EditorSessions) {
    this.sessions = sessions
  }

  /**
   * 开始跟随文档脏状态。
   * @returns 停止跟随并清除所有标记。
   */
  start(): Disposable {
    const unsubscribe = this.sessions.subscribe(() => { this.schedule() })
    this.schedule()
    return () => {
      unsubscribe()
      if (this.frame !== undefined) cancelAnimationFrame(this.frame)
      this.frame = undefined
      for (const observer of this.observers.values()) observer.disconnect()
      this.observers.clear()
      this.clear()
    }
  }

  /** 合并同一轮内的多次变化，等 React 提交后再处理。 */
  private schedule(): void {
    if (this.frame !== undefined) return
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined
      this.apply()
    })
  }

  /** 把标记同步到当前所有标签页的关闭按钮。 */
  private apply(): void {
    this.observeStrips()
    const dirty = this.dirtyTabIds()
    const signature = dirty.join('|')
    if (signature === this.applied) return
    this.applied = signature
    const wanted = new Set(dirty)
    for (const element of document.querySelectorAll<HTMLElement>(CLOSE_BUTTON_SELECTOR)) {
      const tabId = element.dataset[TAB_ID_FIELD]
      if (tabId === undefined) continue
      if (wanted.has(tabId)) element.setAttribute(DIRTY_ATTRIBUTE, 'true')
      else element.removeAttribute(DIRTY_ATTRIBUTE)
    }
  }

  /** 观察标签条：标签增删、重排或重挂时重新打标记。 */
  private observeStrips(): void {
    for (const [element, observer] of this.observers) {
      if (element.isConnected) continue
      observer.disconnect()
      this.observers.delete(element)
    }
    for (const element of document.querySelectorAll(STRIP_SELECTOR)) {
      if (this.observers.has(element)) continue
      const observer = new MutationObserver(() => {
        this.applied = undefined
        this.schedule()
      })
      observer.observe(element, { childList: true, subtree: true })
      this.observers.set(element, observer)
    }
  }

  /** 当前有未保存改动的标签页。 */
  private dirtyTabIds(): string[] {
    const ids: string[] = []
    for (const tabId of this.sessions.tabIds()) {
      if (this.sessions.stateOf(tabId)?.dirty === true) ids.push(tabId)
    }
    return ids.sort()
  }

  /** 移除页面上所有标记（插件卸载时标签页可能还会留着）。 */
  private clear(): void {
    for (const element of document.querySelectorAll(CLOSE_BUTTON_SELECTOR)) {
      element.removeAttribute(DIRTY_ATTRIBUTE)
    }
    this.applied = undefined
  }
}
