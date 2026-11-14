/**
 * 每个侧边栏标签页的编辑器状态。
 *
 * 标签页切走时视图会卸载，但 Monaco 模型、未保存文本、撤销历史与滚动位置必须留下：
 * 状态按标签页 id 分桶保存在插件闭包里，标签页记录消失（`tab.signal` 中止）时才丢弃。
 * @module dsh-monaco/client/editor/sessions
 */
import type * as Monaco from 'monaco-editor'

/** 文档当前所处的阶段。 */
export type DocumentPhase = 'idle' | 'loading' | 'ready' | 'failed'

/** 一个标签页暴露给 UI 的状态，整体替换以保证引用稳定。 */
export interface DocumentState {
  readonly phase: DocumentPhase
  /** 宿主执行环境中的绝对路径。 */
  readonly path: string
  /** 语言标识。 */
  readonly languageId: string
  /** 模型创建代数：模型建好后递增，编辑器据此挂载。 */
  readonly modelRevision: number
  /** 编辑器文本是否与磁盘版本不一致。 */
  readonly dirty: boolean
  /** 正在写入磁盘。 */
  readonly saving: boolean
  /** 已加载的磁盘版本。 */
  readonly version: string | undefined
  /** 失败提示或一次性提示。 */
  readonly message: string | undefined
  /** 磁盘版本与本地编辑冲突，等待用户选择重新加载或覆盖保存。 */
  readonly conflict: boolean
  /** 磁盘内容代数：每读到一份新的磁盘文本就递增，视图据此把文本装回模型。 */
  readonly diskRevision: number
  /** 光标行（1 起始）。 */
  readonly line: number
  /** 光标列（1 起始）。 */
  readonly column: number
  /** 文件总行数。 */
  readonly lines: number
}

/** 建立一个标签页状态所需的信息。 */
export interface DocumentSeed {
  readonly sessionId: string
  readonly path: string
}

/** 一次读取结果。 */
export interface DocumentLoad {
  readonly text: string
  readonly version: string
  /** 平台文档视图的内容代数；同一代数只读一次。 */
  readonly revision: number
}

/** 文档事件名。 */
type DocumentEventName = 'open' | 'save' | 'change' | 'close'

/** 一个标签页的侧边栏导航入口。 */
export type DocumentOpener = (address: string, options: { readonly params?: { readonly line?: number } }) => void

/** 一个标签页的可变记录。 */
interface Entry {
  readonly tabId: string
  readonly sessionId: string
  state: DocumentState
  model: Monaco.editor.ITextModel | undefined
  /** 与磁盘一致的模型版本号，用来判断脏状态。 */
  savedVersionId: number
  /** 已应用到模型上的平台内容代数。 */
  revision: number
  /** 最近一次读到的文本。 */
  text: string
  /** 发起保存时模型的版本号：保存成功后磁盘上就是这一份内容。 */
  saveBaseline: number
}

/** 建桶时的初始状态。 */
function initialState(seed: DocumentSeed): DocumentState {
  return {
    phase: 'idle',
    path: seed.path,
    languageId: 'plaintext',
    modelRevision: 0,
    dirty: false,
    saving: false,
    version: undefined,
    message: undefined,
    conflict: false,
    diskRevision: 0,
    line: 1,
    column: 1,
    lines: 1,
  }
}

/** 编辑器文档状态容器。 */
export class EditorSessions {
  private readonly entries = new Map<string, Entry>()
  private readonly openers = new Map<string, DocumentOpener>()
  private readonly listeners = new Set<() => void>()
  private readonly eventListeners: Record<DocumentEventName, Set<(tabId: string) => void>> = {
    open: new Set(), save: new Set(), change: new Set(), close: new Set(),
  }
  private activeId: string | undefined

  /**
   * 取得或建立标签页记录。
   * @param tabId - 标签页 id。
   * @param seed - 会话与路径。
   * @returns 当前状态。
   */
  ensure(tabId: string, seed: DocumentSeed): DocumentState {
    const existing = this.entries.get(tabId)
    if (existing !== undefined) {
      if (existing.state.path === seed.path && existing.sessionId === seed.sessionId) return existing.state
      // 同一个标签页换了内容（地址变了）：旧文件的模型、基线与已读文本都不再适用，
      // 整条记录重建，避免把旧文件的内容显示成新文件、或把旧文本写进新路径。
      this.emit('close', tabId)
      existing.model?.dispose()
      existing.model = undefined
      const rebuilt: Entry = {
        tabId,
        sessionId: seed.sessionId,
        state: initialState(seed),
        model: undefined,
        savedVersionId: 0,
        revision: -1,
        text: '',
        saveBaseline: 0,
      }
      this.entries.set(tabId, rebuilt)
      this.notify()
      return rebuilt.state
    }
    const entry: Entry = {
      tabId,
      sessionId: seed.sessionId,
      state: initialState(seed),
      model: undefined,
      savedVersionId: 0,
      revision: -1,
      text: '',
      saveBaseline: 0,
    }
    this.entries.set(tabId, entry)
    this.notify()
    return entry.state
  }

  /**
   * 读取一个标签页的状态。
   * @param tabId - 标签页 id。
   * @returns 状态；记录不存在时为 `undefined`。
   */
  stateOf(tabId: string): DocumentState | undefined {
    return this.entries.get(tabId)?.state
  }

  /**
   * 读取一个标签页的记录视图。
   * @param tabId - 标签页 id。
   * @returns 会话、路径、模型与已读文本。
   */
  viewOf(tabId: string): {
    readonly sessionId: string
    readonly path: string
    readonly model: Monaco.editor.ITextModel | undefined
    readonly text: string
    readonly revision: number
    readonly opener: DocumentOpener | undefined
  } | undefined {
    const entry = this.entries.get(tabId)
    if (entry === undefined) return undefined
    return {
      sessionId: entry.sessionId,
      path: entry.state.path,
      model: entry.model,
      text: entry.text,
      revision: entry.revision,
      opener: this.openers.get(tabId),
    }
  }

  /**
   * 订阅状态变化。
   * @param listener - 观察者。
   * @returns 取消订阅。
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * 订阅文档事件。
   * @param name - 事件名。
   * @param listener - 收到标签页 id 的观察者。
   * @returns 取消订阅。
   */
  on(name: DocumentEventName, listener: (tabId: string) => void): () => void {
    this.eventListeners[name].add(listener)
    return () => { this.eventListeners[name].delete(listener) }
  }

  /** 记录侧边栏导航入口，供公开服务的 `openFile` 使用。 */
  registerOpener(tabId: string, opener: DocumentOpener | undefined): void {
    if (opener === undefined) this.openers.delete(tabId)
    else this.openers.set(tabId, opener)
  }

  /**
   * 记录当前聚焦的标签页。
   * @param tabId - 标签页 id。
   */
  setActive(tabId: string): void {
    this.activeId = tabId
  }

  /** 当前聚焦的标签页 id。 */
  activeTabId(): string | undefined {
    return this.activeId
  }

  /** 最近注册过导航入口的标签页，用于没有聚焦记录时的打开请求。 */
  lastOpener(): DocumentOpener | undefined {
    const active = this.activeId === undefined ? undefined : this.openers.get(this.activeId)
    if (active !== undefined) return active
    let found: DocumentOpener | undefined
    for (const opener of this.openers.values()) found = opener
    return found
  }

  /**
   * 标记开始读取。
   *
   * 已有模型时保持就绪：外部变更的重读不该把编辑器遮成加载态，
   * 新文本到达后原位替换即可。
   * @param tabId - 标签页 id。
   * @param revision - 平台内容代数。
   */
  beginLoad(tabId: string, revision: number): void {
    const entry = this.entries.get(tabId)
    if (entry === undefined) return
    entry.revision = revision
    if (entry.model === undefined) this.patch(tabId, { phase: 'loading', message: undefined })
    else this.patch(tabId, { message: undefined })
  }

  /**
   * 读取成功：刷新文本、版本与阶段。
   *
   * 已经建好模型时只推进磁盘代数，由视图在保留光标的前提下把文本装回模型；
   * 未建模型时直接进入就绪，模型用这份文本创建。
   * @param tabId - 标签页 id。
   * @param load - 文本、版本与内容代数。
   */
  loaded(tabId: string, load: DocumentLoad): void {
    const entry = this.entries.get(tabId)
    if (entry === undefined) return
    entry.text = load.text
    entry.revision = load.revision
    if (entry.model === undefined) {
      this.patch(tabId, {
        phase: 'ready',
        version: load.version,
        message: undefined,
        conflict: false,
        lines: countLines(load.text),
      })
      return
    }
    this.patch(tabId, {
      phase: 'ready',
      version: load.version,
      message: undefined,
      conflict: false,
      diskRevision: entry.state.diskRevision + 1,
    })
  }

  /**
   * 视图把磁盘文本装回模型之后调用：重置保存基线并清除脏状态。
   * @param tabId - 标签页 id。
   * @param model - 已承载磁盘内容的模型。
   */
  appliedDiskText(tabId: string, model: Monaco.editor.ITextModel): void {
    const entry = this.entries.get(tabId)
    if (entry === undefined) return
    entry.savedVersionId = model.getAlternativeVersionId()
    this.patch(tabId, { dirty: false, lines: model.getLineCount() })
    this.emit('change', tabId)
  }

  /**
   * 放弃一次尚未产出内容的读取。
   *
   * 只在还没有可显示内容时把内容代数退回，让下一次挂载重新发起读取；
   * 已有内容时保留代数，避免把一次成功读取误标成未读。
   * @param tabId - 标签页 id。
   */
  cancelLoad(tabId: string): void {
    const entry = this.entries.get(tabId)
    if (entry === undefined || entry.state.phase !== 'loading') return
    entry.revision = -1
    this.patch(tabId, { phase: 'idle' })
  }

  /**
   * 读取失败。
   * @param tabId - 标签页 id。
   * @param message - 可直接展示的原因。
   */
  loadFailed(tabId: string, message: string): void {
    this.patch(tabId, { phase: 'failed', message })
  }

  /**
   * 挂上 Monaco 模型并记录基线。
   * @param tabId - 标签页 id。
   * @param model - 新建或复用的模型。
   * @param languageId - 语言标识。
   */
  attachModel(tabId: string, model: Monaco.editor.ITextModel, languageId: string): void {
    const entry = this.entries.get(tabId)
    if (entry === undefined) {
      model.dispose()
      return
    }
    entry.model = model
    entry.savedVersionId = model.getAlternativeVersionId()
    this.patch(tabId, {
      languageId,
      modelRevision: entry.state.modelRevision + 1,
      dirty: false,
      lines: model.getLineCount(),
    })
    this.emit('open', tabId)
  }

  /**
   * 按模型版本号刷新脏状态。
   * @param tabId - 标签页 id。
   */
  refreshDirty(tabId: string): void {
    const entry = this.entries.get(tabId)
    if (entry?.model === undefined) return
    const dirty = entry.model.getAlternativeVersionId() !== entry.savedVersionId
    if (dirty === entry.state.dirty) return
    this.patch(tabId, { dirty, lines: entry.model.getLineCount() })
    this.emit('change', tabId)
  }

  /**
   * 记录光标位置。
   * @param tabId - 标签页 id。
   * @param line - 1 起始行号。
   * @param column - 1 起始列号。
   * @param lines - 文件总行数。
   */
  setPosition(tabId: string, line: number, column: number, lines: number): void {
    const state = this.entries.get(tabId)?.state
    if (state === undefined) return
    if (state.line === line && state.column === column && state.lines === lines) return
    this.patch(tabId, { line, column, lines })
  }

  /**
   * 记录语言。
   * @param tabId - 标签页 id。
   * @param languageId - 语言标识。
   */
  setLanguage(tabId: string, languageId: string): void {
    if (this.entries.get(tabId)?.state.languageId === languageId) return
    this.patch(tabId, { languageId })
  }

  /**
   * 标记开始保存，并记下这次写出的内容版本。
   * @param tabId - 标签页 id。
   */
  beginSave(tabId: string): void {
    const entry = this.entries.get(tabId)
    if (entry === undefined) return
    entry.saveBaseline = entry.model?.getAlternativeVersionId() ?? entry.savedVersionId
    this.patch(tabId, { saving: true, message: undefined })
  }

  /**
   * 保存成功：磁盘基线前移到这次写出的内容版本。
   *
   * 保存过程中用户继续键入的部分不在磁盘上，所以只有模型仍停在写出时的版本才算干净；
   * 否则保持未保存状态，状态栏不会谎报「已与磁盘一致」。
   * @param tabId - 标签页 id。
   * @param version - 写入后的文件版本。
   */
  saved(tabId: string, version: string): void {
    const entry = this.entries.get(tabId)
    if (entry === undefined) return
    entry.savedVersionId = entry.saveBaseline
    const dirty = entry.model !== undefined && entry.model.getAlternativeVersionId() !== entry.saveBaseline
    this.patch(tabId, {
      saving: false,
      dirty,
      version,
      conflict: false,
      message: undefined,
    })
    this.emit('save', tabId)
    this.emit('change', tabId)
  }

  /**
   * 保存失败。
   * @param tabId - 标签页 id。
   * @param message - 可直接展示的原因。
   */
  saveFailed(tabId: string, message: string): void {
    this.patch(tabId, { saving: false, message })
  }

  /**
   * 记录磁盘版本与本地编辑的冲突。
   * @param tabId - 标签页 id。
   * @param message - 提示文案。
   */
  conflict(tabId: string, message: string): void {
    this.patch(tabId, { conflict: true, message, saving: false })
  }

  /**
   * 放弃本地编辑：把保存基线移到模型当前内容上，并让下一次读取覆盖模型。
   *
   * 基线必须一起前移，否则脏状态会在下一次读取时再次触发「磁盘已变化」的冲突提示，
   * 用户点了「重新加载」却永远读不到磁盘内容。这里不动模型文本——重读成功时由视图替换；
   * 重读失败时用户仍能看见自己改过的内容，而不是先被清空再报错。
   * @param tabId - 标签页 id。
   */
  discardLocal(tabId: string): void {
    const entry = this.entries.get(tabId)
    if (entry === undefined) return
    entry.revision = -1
    entry.savedVersionId = entry.model?.getAlternativeVersionId() ?? entry.savedVersionId
    this.patch(tabId, { conflict: false, dirty: false, message: undefined })
  }

  /**
   * 丢弃一个标签页的全部状态与模型。
   * @param tabId - 标签页 id。
   */
  dispose(tabId: string): void {
    const entry = this.entries.get(tabId)
    if (entry === undefined) return
    this.emit('close', tabId)
    entry.model?.dispose()
    entry.model = undefined
    this.entries.delete(tabId)
    this.openers.delete(tabId)
    if (this.activeId === tabId) this.activeId = undefined
    this.notify()
  }

  private patch(tabId: string, patch: Partial<DocumentState>): void {
    const entry = this.entries.get(tabId)
    if (entry === undefined) return
    entry.state = { ...entry.state, ...patch }
    this.notify()
  }

  private emit(name: DocumentEventName, tabId: string): void {
    for (const listener of this.eventListeners[name]) listener(tabId)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/**
 * 数一行的文本有多少行。
 * @param text - 完整文本。
 * @returns 行数；空文本按 1 行计。
 */
export function countLines(text: string): number {
  if (text.length === 0) return 1
  let lines = 1
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) lines += 1
  return lines
}
