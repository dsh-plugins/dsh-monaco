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

/** 记录监听异常的出口。 */
export interface InstancesLogger {
  warn(format: unknown, ...params: unknown[]): void
}

/** 标签页 id 到编辑器实例的映射。 */
export class EditorInstances {
  private readonly entries = new Map<string, EditorInstanceEntry>()
  private readonly mountListeners = new Set<(entry: EditorInstanceEntry) => void>()
  private readonly unmountListeners = new Set<(entry: EditorInstanceEntry) => void>()

  /** @param logger - 外部监听抛错时的记录出口。 */
  constructor(private readonly logger: InstancesLogger) {}

  /**
   * 登记或撤销一个实例。
   *
   * 监听来自外部插件，这里逐个隔离：一次抛错不能打断实例销毁流程里剩余步骤，
   * 也不能让同一批里的其它监听收不到通知。
   * @param tabId - 标签页 id。
   * @param entry - 实例；`undefined` 表示撤销。
   */
  set(tabId: string, entry: EditorInstanceEntry | undefined): void {
    const previous = this.entries.get(tabId)
    if (entry === undefined) {
      if (previous === undefined) return
      this.entries.delete(tabId)
      this.notify(this.unmountListeners, previous, '卸载')
      return
    }
    if (previous !== undefined) {
      // 同一个标签页换了实例（重挂载）：旧实例即将被销毁，先按卸载通知一次，
      // 否则外部插件会把装饰继续挂在已经不可见的那个实例上。
      this.notify(this.unmountListeners, previous, '卸载')
    }
    this.entries.set(tabId, entry)
    this.notify(this.mountListeners, entry, '挂载')
  }

  /**
   * 撤销全部登记项，插件卸载时调用。
   *
   * 与 `EditorSessions.disposeAll` 对称：插件卸载后外部插件再也收不到卸载通知，
   * 留在登记表里的实例与挂在它们身上的资源就再也没有回收路径。
   */
  disposeAll(): void {
    for (const entry of [...this.entries.values()]) this.set(entry.tabId, undefined)
  }

  private notify(
    listeners: ReadonlySet<(entry: EditorInstanceEntry) => void>,
    entry: EditorInstanceEntry,
    phase: '挂载' | '卸载',
  ): void {
    for (const listener of listeners) {
      try {
        listener(entry)
      } catch (error) {
        this.logger.warn('dsh-monaco: 编辑器%s监听执行失败（标签页 %s）：%s', phase, entry.tabId,
          error instanceof Error ? error.message : String(error))
      }
    }
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
