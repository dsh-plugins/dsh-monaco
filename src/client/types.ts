/**
 * 浏览器端读取的平台服务外观，以及本插件对外提供的编辑器扩展服务类型。
 *
 * 只声明本插件实际用到的成员，避免在构建期依赖平台内部包。
 * @module dsh-monaco/client/types
 */
import type * as Monaco from 'monaco-editor'

/** 一次性的清理函数。 */
export type Disposable = () => void

/** 平台语言快照：活动语言在 `active`，不是 `id`。 */
export interface LocaleSnapshotLike {
  readonly active: string
  readonly locales: readonly { readonly id: string; readonly label: string }[]
  readonly revision: number
}

/** 平台文案服务：注册词条、按命名空间取翻译函数。 */
export interface LocaleService {
  /** 当前语言快照。 */
  getLocale(): LocaleSnapshotLike
  /** 注册一个命名空间的词条。 */
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): Disposable
  /** 绑定一个命名空间的翻译函数。 */
  bind(namespace: string): Translate
}

/** 翻译函数：插值参数同样由平台词条机制处理。 */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/** 主题快照中本插件关心的部分。 */
export interface ThemeSnapshotLike {
  readonly preference: string
  readonly active: {
    readonly id: string
    readonly colorScheme: 'light' | 'dark'
    readonly tokens: Readonly<Record<string, string>>
  }
}

/** 平台主题服务。 */
export interface ThemeService {
  getTheme(): ThemeSnapshotLike
}

/** 插槽注册定义：`key` 用于 keyed 槽位，`id` 用于 list 槽位。 */
export interface SlotRegistration {
  readonly name: string
  readonly key?: string
  /** list 槽位的身份。 */
  readonly id?: string
  /** list 槽位内的排序。 */
  readonly order?: number
  readonly locale?: string
}

/** 平台插槽服务。 */
export interface SlotService {
  register(definition: SlotRegistration, component: unknown): Disposable
  inject(slot: string, callback: () => Disposable): Disposable
}

/** 文档预览实现定义，字段语义与平台注册表一致。 */
export interface DocumentPreviewDefinition {
  readonly id: string
  readonly extensions: readonly string[]
  readonly priority: 'builtin' | 'extension'
  readonly title: () => string
  readonly loading: 'text-pages' | 'bytes-complete' | 'renderer'
  readonly wrap?: boolean
}

/** 平台文档预览注册表。 */
export interface DocumentPreviews {
  register(definition: DocumentPreviewDefinition): Disposable
}

/** 远程调用的统一返回值。 */
export type RemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } }

/** `workspaceFiles.readBytes` 的返回结构。 */
export interface WorkspaceFileBytes {
  readonly absolutePath: string
  readonly version: string
  readonly bytes?: number
  readonly offset: number
  readonly data: Uint8Array
  readonly eof: boolean
}

/** 平台客户端 Remote 里本插件用到的命名空间。 */
export interface RemoteFace {
  readonly workspaceFiles: {
    readBytes(
      sessionId: string,
      path: string,
      options: { readonly baseFile?: string },
      signal?: AbortSignal,
    ): Promise<RemoteResult<WorkspaceFileBytes>>
  }
}

/** 侧边栏标签页记录。 */
export interface SidebarTabLike {
  readonly id: string
}

/**
 * 侧边栏服务中本插件用到的部分。
 *
 * `registerCloseHandler` 是唯一的关闭钩子：按标签页类型注册，同步执行，
 * 抛错表示保留标签页（平台文档写明「Failure preserves the tab」）。
 */
export interface SidebarRightService {
  /** 关闭屏幕上的会话里的一个标签页。 */
  close(tabId: string): void
  /** 当前挂在屏幕上的会话；没有会话时为 `undefined`。 */
  readonly mounted: { getSnapshot(): string | undefined }
  /** 为一个标签页类型登记关闭前的处理函数。 */
  registerCloseHandler(kind: string, handler: (sessionId: string, tab: SidebarTabLike) => void): Disposable
}

/** 本插件读取的平台上下文外观。 */
export interface PlatformContext {
  readonly slots: SlotService
  readonly locale: LocaleService
  readonly theme: ThemeService
  readonly documentPreviews: DocumentPreviews
  readonly sidebarRight: SidebarRightService
  readonly remote: RemoteFace
  readonly logger: {
    info(format: unknown, ...params: unknown[]): void
    warn(format: unknown, ...params: unknown[]): void
    error(format: unknown, ...params: unknown[]): void
  }
  on(event: string, listener: (...args: never[]) => void): Disposable
  effect(callback: () => Disposable | void, label: string): Disposable
  provide(name: string, value: unknown): Disposable
}

/** Monaco 命名空间对象。 */
export type MonacoApi = typeof Monaco

/** 一条语言贡献：注册适用文件，并可附带 Monarch 语法与语言配置。 */
export interface LanguageContribution {
  /** 语言标识，如 `glsl`；覆盖 Monaco 自带语言时沿用其标识即可。 */
  readonly id: string
  /** 语言显示名，展示在状态栏与语言选择菜单里。 */
  readonly label?: string
  /** 适用扩展名，带前导点，如 `.glsl`。 */
  readonly extensions?: readonly string[]
  /** 其他称呼，交给 Monaco 语言选择器。 */
  readonly aliases?: readonly string[]
  /** 适用完整文件名，如 `Dockerfile`。 */
  readonly filenames?: readonly string[]
  /** 适用文件名正则。 */
  readonly filenamePatterns?: readonly string[]
  /** 先加载的贡献包（例如另一个包的语言支持），在应用下面的规则之前执行。 */
  readonly loader?: () => void | Promise<unknown>
  /** Monarch 高亮规则。 */
  readonly tokens?: Monaco.languages.IMonarchLanguage
  /** 括号、注释、缩进等语言配置。 */
  readonly configuration?: Monaco.languages.LanguageConfiguration
}

/** 一条主题贡献：基于 Monaco 内置基础主题叠加规则与颜色。 */
export interface ThemeContribution {
  /** 主题标识，可直接写进插件配置 `editor.theme`。 */
  readonly id: string
  /** 主题显示名。 */
  readonly label?: string
  /** 基础主题。 */
  readonly base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'
  /** 是否继承基础主题的默认配色。 */
  readonly inherit?: boolean
  /** 词法着色规则。 */
  readonly rules?: readonly Monaco.editor.ITokenThemeRule[]
  /** 编辑器界面颜色，键名为 Monaco 的颜色标识。 */
  readonly colors?: Readonly<Record<string, string>>
}

/** 命令/动作执行时拿到的编辑器上下文。 */
export interface EditorCommandContext {
  /** 触发的编辑器实例。 */
  readonly editor: Monaco.editor.IStandaloneCodeEditor
  /** Monaco 命名空间，供扩展调用 `editor`、`languages` 等 API。 */
  readonly monaco: MonacoApi
  /** 当前文档身份。 */
  readonly document: {
    readonly sessionId: string
    /** 宿主执行环境中的绝对路径。 */
    readonly path: string
    /** 当前语言标识。 */
    readonly languageId: string
  }
}

/** 全局命令：注册进编辑器命令面板，可绑定快捷键。 */
export interface CommandContribution {
  readonly id: string
  readonly label: string
  readonly keybindings?: readonly number[]
  readonly run: (context: EditorCommandContext) => void | Promise<void>
}

/** 编辑器动作：可带 Monaco 上下文键前置条件。 */
export interface ActionContribution {
  readonly id: string
  readonly label: string
  readonly keybindings?: readonly number[]
  /** Monaco 上下文键表达式，例如 `editorTextFocus`。 */
  readonly precondition?: string
  readonly run: (context: EditorCommandContext) => void | Promise<void>
}

/** 文档被编辑器打开时的通知。 */
export interface DocumentOpenEvent {
  readonly tabId: string
  readonly sessionId: string
  readonly path: string
  readonly languageId: string
}

/** 文档被保存后的通知。 */
export interface DocumentSaveEvent extends DocumentOpenEvent {
  /** 写入后的文件版本。 */
  readonly version: string
}

/** 文档内容发生变化的通知。 */
export interface DocumentChangeEvent extends DocumentOpenEvent {
  /** 当前文本是否与磁盘版本存在差异。 */
  readonly dirty: boolean
}

/**
 * 本插件提供给其他插件的编辑器扩展服务，挂载为客户端 Cordis 服务 `ctx.monacoEditor`。
 *
 * 依赖方在 `export const inject` 里声明 `'monacoEditor'` 后使用。
 */
export interface MonacoEditorService {
  /** 扩展接口版本；不兼容的调整会递增。 */
  readonly version: 1
  /** Monaco 资源就绪；在回调里可以安全调用编辑器的任何 API。 */
  readonly ready: Promise<void>
  /** 已加载的 Monaco 命名空间；尚未就绪时为 `undefined`。 */
  readonly monaco: MonacoApi | undefined
  /** 注册一种语言（适用文件、Monarch 高亮规则、语言配置）。 */
  registerLanguage(contribution: LanguageContribution): Disposable
  /** 注册一个基于 Monaco 基础主题的配色主题。 */
  registerTheme(contribution: ThemeContribution): Disposable
  /** 注册一个编辑器命令（进入命令面板，可绑定快捷键）。 */
  registerCommand(contribution: CommandContribution): Disposable
  /** 注册一个编辑器动作（可带上下文键前置条件）。 */
  registerAction(contribution: ActionContribution): Disposable
  /** 追加由本编辑器接管的文件扩展名；已注册的扩展名重复追加无副作用。 */
  registerFileExtensions(extensions: readonly string[]): Disposable
  /** 取得当前聚焦的编辑器；没有任何编辑器打开时为 `undefined`。 */
  getActiveEditor(): EditorCommandContext | undefined
  /**
   * 在侧边栏里打开一个文件。
   * @param request - 会话、宿主绝对路径，以及可选的 1 起始行号。
   * @returns 是否已交给侧边栏导航（没有可用的侧边栏入口时为 `false`）。
   */
  openFile(request: { readonly sessionId: string; readonly path: string; readonly line?: number }): boolean
  /** 编辑器生命周期与文档事件。 */
  readonly events: {
    onDidOpenDocument(listener: (event: DocumentOpenEvent) => void): Disposable
    onDidSaveDocument(listener: (event: DocumentSaveEvent) => void): Disposable
    onDidChangeDocument(listener: (event: DocumentChangeEvent) => void): Disposable
    onDidCloseDocument(listener: (event: DocumentOpenEvent) => void): Disposable
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 本插件提供的 Monaco 编辑器扩展服务。 */
    monacoEditor: MonacoEditorService
  }
}

