/**
 * 编辑器实例登记处。
 *
 * 公开服务需要「当前聚焦的编辑器」来执行外部插件注册的命令与动作，
 * 而实例由视图组件创建，所以视图挂载时把实例登记进来，卸载时撤销。
 * @module dsh-monaco/client/editor/instances
 */
import type * as Monaco from 'monaco-editor'
import type { EditorCommandContext } from '../types.ts'

/** 一个已挂载编辑器的登记项。 */
export interface EditorInstanceEntry {
  readonly editor: Monaco.editor.IStandaloneCodeEditor
  /** 按当前文档状态构造命令上下文。 */
  readonly describe: () => EditorCommandContext
}

/** 标签页 id 到编辑器实例的映射。 */
export class EditorInstances {
  private readonly entries = new Map<string, EditorInstanceEntry>()

  /**
   * 登记或撤销一个实例。
   * @param tabId - 标签页 id。
   * @param entry - 实例；`undefined` 表示撤销。
   */
  set(tabId: string, entry: EditorInstanceEntry | undefined): void {
    if (entry === undefined) this.entries.delete(tabId)
    else this.entries.set(tabId, entry)
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
