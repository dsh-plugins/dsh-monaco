/**
 * 编辑器实例登记处。
 *
 * 公开服务需要「当前聚焦的编辑器」来执行外部插件注册的命令与动作，
 * 而实例由视图组件创建，所以视图挂载时把实例登记进来，卸载时撤销。
 * 外部插件要往编辑器上挂装饰或监听，只能从这里的挂载通知拿到实例。
 * @module dsh-monaco/client/editor/instances
 */
import type * as Monaco from 'monaco-editor'
import type { EditorCommandContext } from '../types.ts'

/** 一个已挂载编辑器的登记项。 */
export interface EditorInstanceEntry {
  /** 承载实例的标签页。 */
  readonly tabId: string
  readonly editor: Monaco.editor.IStandaloneCodeEditor
  /** 按当前文档状态构造命令上下文。 */
  readonly describe: () => EditorCommandContext
}

/** 标签页 id 到编辑器实例的映射。 */
export class EditorInstances {
  private readonly entries = new Map<string, EditorInstanceEntry>()
  private readonly mountListeners = new Set<(entry: EditorInstanceEntry) => void>()
  private readonly unmountListeners = new Set<(entry: EditorInstanceEntry) => void>()

  /**
   * 登记或撤销一个实例。
   * @param tabId - 标签页 id。
   * @param entry - 实例；`undefined` 表示撤销。
   */
  set(tabId: string, entry: EditorInstanceEntry | undefined): void {
    const previous = this.entries.get(tabId)
    if (entry === undefined) {
      if (previous === undefined) return
      this.entries.delete(tabId)
      for (const listener of this.unmountListeners) listener(previous)
      return
    }
    this.entries.set(tabId, entry)
    for (const listener of this.mountListeners) listener(entry)
  }

  /**
   * 订阅实例挂载。
   * @param listener - 收到登记项的观察者。
   * @returns 取消订阅。
   */
  onMount(listener: (entry: EditorInstanceEntry) => void): () => void {
    this.mountListeners.add(listener)
    return () => { this.mountListeners.delete(listener) }
  }

  /**
   * 订阅实例即将销毁。
   * @param listener - 收到登记项的观察者；此刻实例仍然可用。
   * @returns 取消订阅。
   */
  onUnmount(listener: (entry: EditorInstanceEntry) => void): () => void {
    this.unmountListeners.add(listener)
    return () => { this.unmountListeners.delete(listener) }
  }

  /**
   * 挑选一个实例。
   * @param preferred - 优先使用的标签页 id。
   * @returns 优先项，或最近登记的实例。
   */
  pick(preferred: string | undefined): EditorInstanceEntry | undefined {
    const exact = preferred === undefined ? undefined : this.entries.get(preferred)
    if (exact !== undefined) return exact
    let last: EditorInstanceEntry | undefined
    for (const entry of this.entries.values()) last = entry
    return last
  }

  /**
   * 列出全部已挂载的编辑器。
   * @returns 登记项，按登记顺序。
   */
  all(): readonly EditorInstanceEntry[] {
    return [...this.entries.values()]
  }
}
