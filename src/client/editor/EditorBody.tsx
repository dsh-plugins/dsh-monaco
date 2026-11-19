/**
 * 侧边栏里的 Monaco 编辑视图。
 *
 * 平台的文件预览把内容交给渲染器：这里以 `renderer` 模式工作——自己通过 Remote 读取整份
 * 文件（带版本），拿 Monaco 模型承载编辑，并通过宿主路由写回磁盘。标签页切走时视图卸载，
 * 模型与未保存文本留在状态容器里，所以撤销历史、光标与滚动位置都不会丢。
 * @module dsh-monaco/client/editor/EditorBody
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type * as Monaco from 'monaco-editor'
import { languageForPath } from '../../shared/language.ts'
import type { SaveFileRequest, SaveFileResult } from '../../shared/protocol.ts'
import type { EditorDefaults } from '../config.ts'
import type { MonacoRuntime, MonacoRuntimeState } from '../monaco/runtime.ts'
import type { MonacoExtensionRegistry } from '../monaco/registry.ts'
import type { EditorFont } from '../monaco/theme.ts'
import type { EditorCommandContext, MonacoApi, Translate } from '../types.ts'
import type { EditorInstances } from './instances.ts'
import { saveTab } from './saver.ts'
import { useEditorSettings } from './settings.ts'
import type { EditorSettingsStore } from './settings.ts'
import type { EditorSessions, DocumentState } from './sessions.ts'
import type { DocumentRead } from './source.ts'

/** 平台交给我们渲染的内容：渲染器自己负责读取。 */
export interface RendererContent {
  readonly kind: 'renderer'
  /** 内容代数；平台每次要求重新读取都会递增。 */
  readonly revision: number
  /** 报告已显示的磁盘版本。 */
  readonly loaded: (version: string) => void
  /** 报告本次加载失败。 */
  readonly failed: () => void
  /** 重新开始一次加载。 */
  readonly reload: () => void
}

/** 平台文档视图交来的内容；本编辑器只处理 `renderer` 形态。 */
export type DocumentContentLike =
  | RendererContent
  | { readonly kind: 'text' | 'bytes' }

/** 标签页信息中视图用到的部分。 */
export interface TabInfoLike {
  readonly tab: {
    readonly id: string
    readonly contentId: string
    readonly signal: AbortSignal
    readonly navigation: { readonly revision: number; readonly params: unknown }
    readonly actions: {
      openResource(address: string, options?: { readonly params?: { readonly line?: number } }): void
    }
  }
  readonly panel: { readonly id: string }
}

/** `useResource` 中视图用到的部分。 */
export interface ResourceSnapshotLike {
  readonly status: 'none' | 'loading' | 'live' | 'failed'
  readonly value: { readonly absolutePath: string; readonly version: string } | undefined
  readonly failure: { readonly code: string; readonly message: string } | undefined
}

/** 视图需要的插件能力，由插件主体在闭包里绑定。 */
export interface EditorFace {
  readonly sessions: EditorSessions
  readonly instances: EditorInstances
  readonly runtime: MonacoRuntime
  readonly registry: MonacoExtensionRegistry
  readonly config: EditorDefaults
  /** 全局编辑器设置（同一浏览器内所有编辑器共享）。 */
  readonly settings: EditorSettingsStore
  /** 状态栏左侧的设置入口。 */
  readonly settingsControl: () => ReactNode
  readonly t: Translate
  readonly logger: { warn(format: unknown, ...params: unknown[]): void }
  readonly readDocument: (sessionId: string, path: string, signal: AbortSignal) => Promise<DocumentRead>
  readonly saveDocument: (request: SaveFileRequest) => Promise<SaveFileResult>
  /** 当前应使用的代码字体与字号（来自 DSH 字体设置）。 */
  readonly font: () => EditorFont
  /**
   * 定义并启用当前主题，返回要传给 `editor.create` 的主题标识。
   * 必须在创建编辑器之前调用：主题无效会让 Monaco 在创建中途抛错。
   */
  readonly prepareTheme: (api: MonacoApi) => string
}

/** 编辑器视图属性，来自平台文档槽与插件注入。 */
export interface EditorBodyProps {
  readonly resourceAddress: string
  readonly content: DocumentContentLike
  /** 预览工具栏的换行开关。 */
  readonly wrap: boolean
  readonly useTabInfo: () => TabInfoLike
  readonly useResource: (address: string) => ResourceSnapshotLike
  readonly sessionId: string
  /** 平台按注册时的 `locale` 注入的文案函数；组件本身用闭包里那一份。 */
  readonly t?: Translate
  readonly editor: EditorFace
}

/** 订阅文档状态。 */
function useDocumentState(sessions: EditorSessions, tabId: string): DocumentState | undefined {
  const get = useCallback(() => sessions.stateOf(tabId), [sessions, tabId])
  return useSyncExternalStore(sessions.subscribe, get, get)
}

/** 订阅 Monaco 加载状态。 */
function useRuntime(runtime: MonacoRuntime): MonacoRuntimeState {
  return useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState)
}

/** 订阅扩展注册表。 */
function useRegistry(registry: MonacoExtensionRegistry): number {
  return useSyncExternalStore(registry.subscribe, () => registry.getSnapshot().revision, () => registry.getSnapshot().revision)
}

/** 导航参数里的行号。 */
function navigationLine(params: unknown): number | undefined {
  if (typeof params !== 'object' || params === null || !('line' in params)) return undefined
  const line = (params as { readonly line?: unknown }).line
  return typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : undefined
}

/**
 * 按路径挑选语言：插件注册的语言优先，其次 Monaco 自带语言。
 * @param api - Monaco 命名空间。
 * @param registry - 扩展注册表。
 * @param path - 文件路径。
 * @returns 语言标识；没有匹配时用 `plaintext`。
 */
export function resolveLanguageId(api: MonacoApi, registry: MonacoExtensionRegistry, path: string): string {
  const descriptors = registry.languageDescriptors(api.languages.getLanguages())
  return languageForPath(descriptors, path) ?? 'plaintext'
}

/** 编辑器构造选项。 */
function constructionOptions(
  config: EditorDefaults,
  font: EditorFont,
  wrap: boolean,
  theme: string,
  label: string,
): Monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    theme,
    wordWrap: wrap ? 'on' : 'off',
    // 字号优先跟随 DSH 的代码字号设置，未设置时才用插件配置的默认值。
    fontSize: font.size ?? config.fontSize,
    tabSize: config.tabSize,
    insertSpaces: config.insertSpaces,
    minimap: { enabled: config.minimap },
    automaticLayout: true,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    fixedOverflowWidgets: true,
    renderWhitespace: 'selection',
    padding: { top: 8, bottom: 8 },
    lineNumbersMinChars: 4,
    fontFamily: font.family,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
    wordBasedSuggestions: 'currentDocument',
    unicodeHighlight: { ambiguousCharacters: false },
    // 语义着色的开关默认跟随主题，而 Monaco 0.57 的 standalone 主题服务把主题侧的
    // `semanticHighlighting` 固定成关闭，等于任何语义 token 都不会上色。
    // 这里全局打开：没有提供者的语言收不到语义 token，行为不变。
    'semanticHighlighting.enabled': true,
    ariaLabel: label,
  }
}

/**
 * 侧边栏编辑器视图。
 * @param props - 平台文档槽属性与插件能力。
 * @returns 编辑器根节点：提示条、编辑区与状态栏。
 */
export function EditorBody(props: EditorBodyProps): ReactNode {
  const { editor, content, wrap, resourceAddress, sessionId, useResource, useTabInfo } = props
  // 文案来自插件闭包，而不是槽位注入：组件在注册时就绑定了自己的命名空间。
  const t = editor.t
  const { sessions, instances, registry, runtime } = editor
  const { tab } = useTabInfo()
  const meta = useResource(resourceAddress)
  const state = useDocumentState(sessions, tab.id)
  const registryRevision = useRegistry(registry)
  const runtimeState = useRuntime(runtime)
  const api = runtimeState.api
  const hostRef = useRef<HTMLDivElement | null>(null)
  const instanceRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const contentRef = useRef(content)
  contentRef.current = content
  const settings = useEditorSettings(editor.settings)
  // 换行有两个来源：全局设置是默认值，预览工具栏的按钮是当前标签页的覆盖。
  // 平台那份状态默认就是「开」，无法区分「用户刚关掉」与「初始值」，所以只在工具栏的值
  // **变化**时记为覆盖（挂载时的初值不算，否则全局设置永远不生效）。
  // 改全局设置会清掉所有覆盖，让新值对每个文件都生效——否则用户一旦点过工具栏按钮，
  // 就再也没有回到「跟随全局」的路径。
  const previousWrap = useRef(wrap)
  const wrapTab = useRef(tab.id)
  const [wrapOverride, setWrapOverride] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    // 组件可能被复用到另一个标签页：覆盖是「这个文件的选择」，不能跟着搬过去。
    if (wrapTab.current !== tab.id) {
      wrapTab.current = tab.id
      previousWrap.current = wrap
      setWrapOverride(undefined)
      return
    }
    if (wrap === previousWrap.current) return
    previousWrap.current = wrap
    setWrapOverride(wrap)
  }, [tab.id, wrap])
  useEffect(() => { setWrapOverride(undefined) }, [settings.wordWrap])
  const effectiveWrap = wrapOverride ?? settings.wordWrap
  const saveRef = useRef<(force: boolean) => void>(() => {})
  // 编辑器自己管理滚动，不再把共享滚动容器的位置与行导航交给平台正文。
  const absolutePath = meta.value?.absolutePath
  const contentRevision = content.kind === 'renderer' ? content.revision : -1
  // 建立模型的代数与读取阶段：光标移动也会刷新文档状态，但这两个值不变，
  // 所以依赖它们的副作用不会因为一次光标移动而重建编辑器。
  const modelRevision = state?.modelRevision ?? 0
  const phase = state?.phase ?? 'idle'

  // 标签页身份：建立状态、登记导航入口、跟随标签页记录的生命周期回收。
  useEffect(() => {
    sessions.setActive(tab.id)
    sessions.registerOpener(tab.id, (address, options) => {
      tab.actions.openResource(address, options.params === undefined ? {} : { params: options.params })
    })
    const abort = (): void => {
      // 先销毁编辑器实例再丢模型：两者都随标签页记录消失，顺序反了会让仍挂载的
      // 编辑器短暂持有一个已 dispose 的模型，此时任何击键都会抛错。
      instances.set(tab.id, undefined)
      instanceRef.current?.dispose()
      instanceRef.current = null
      sessions.registerOpener(tab.id, undefined)
      sessions.dispose(tab.id)
    }
    if (tab.signal.aborted) {
      abort()
      return
    }
    tab.signal.addEventListener('abort', abort, { once: true })
    return () => { tab.signal.removeEventListener('abort', abort) }
  }, [instances, sessions, tab.actions, tab.id, tab.signal])

  // 平台交出文件路径后建立标签页状态。
  useEffect(() => {
    if (absolutePath === undefined) return
    sessions.ensure(tab.id, { sessionId, path: absolutePath })
  }, [absolutePath, sessionId, sessions, tab.id])

  // 读文件：首次进入，或平台要求重新读取（外部变更、手动刷新）时执行。
  useEffect(() => {
    if (absolutePath === undefined) return
    const current = sessions.stateOf(tab.id)
    const view = sessions.viewOf(tab.id)
    if (current === undefined || view === undefined) return
    const needsLoad = current.phase === 'idle' || view.revision !== contentRevision
    if (!needsLoad) return
    if (current.dirty) {
      sessions.conflict(tab.id, t('conflict.external'))
      return
    }
    const controller = new AbortController()
    sessions.beginLoad(tab.id, contentRevision)
    void editor.readDocument(sessionId, absolutePath, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok) {
        sessions.loadFailed(tab.id, result.error)
        const renderer = contentRef.current
        if (renderer.kind === 'renderer') renderer.failed()
        return
      }
      sessions.loaded(tab.id, { text: result.value.text, version: result.value.version, revision: contentRevision })
      const renderer = contentRef.current
      if (renderer.kind === 'renderer') renderer.loaded(result.value.version)
    }, (error: unknown) => {
      if (controller.signal.aborted) return
      // Remote 调用本身不 reject；走到这里说明传输层出了问题。
      const message = error instanceof Error ? error.message : String(error)
      editor.logger.warn('dsh-monaco: 读取 "%s" 失败：%s', absolutePath, message)
      sessions.loadFailed(tab.id, t('error.readFailed', { message }))
      const renderer = contentRef.current
      if (renderer.kind === 'renderer') renderer.failed()
    })
    return () => {
      controller.abort()
      // 还没拿到内容就放弃（切走标签页、组件重挂）时，把已记下的内容代数退回，
      // 下一次挂载才会重新发起读取，而不是永远停在加载态。
      sessions.cancelLoad(tab.id)
    }
  }, [absolutePath, contentRevision, editor, sessionId, sessions, t, tab.id])

  // 模型：文本读进来后建一次，之后跟随标签页存活，保留撤销历史。
  useEffect(() => {
    if (api === undefined || phase !== 'ready') return
    if (sessions.viewOf(tab.id)?.model !== undefined) return
    const view = sessions.viewOf(tab.id)
    if (view === undefined) return
    const languageId = resolveLanguageId(api, registry, view.path)
    // 同一个路径可能已经有一个模型：组件重挂时旧模型尚未释放，或别的标签页/插件用同一 URI
    // 建过模型。`createModel` 遇到重复 URI 会抛错并把整个视图打挂，所以这里先查再决定：
    // 同一个路径上可能已经有模型：组件重挂时旧模型尚未释放，或别的插件用同一个 `file:` URI
    // 建过模型。`createModel` 遇到重复 URI 会抛错，把整个视图打挂。
    // 这里既不释放也不复用来源不明的模型——它可能属于别的插件，销毁它会让对方拿着已释放的
    // 模型继续渲染；复用则会让两个使用者共享生命周期。给本次换一个带 fragment 的 URI 即可。
    let uri = api.Uri.file(view.path)
    if (api.editor.getModel(uri) !== null) {
      editor.logger.warn('dsh-monaco: 路径 "%s" 上已有其它 Monaco 模型占用该 URI，本次使用独立 URI', view.path)
      uri = uri.with({ fragment: `dsh-monaco-tab=${tab.id}` })
    }
    const model = api.editor.createModel(view.text, languageId, uri)
    model.onDidChangeContent(() => { sessions.refreshDirty(tab.id) })
    sessions.attachModel(tab.id, model, languageId)
  }, [api, editor, phase, registry, sessions, tab.id])

  // 编辑器实例：模型与 Monaco 都就绪后创建一次。
  useEffect(() => {
    const host = hostRef.current
    if (api === undefined || host === null || modelRevision === 0) return
    if (instanceRef.current !== null) return
    const view = sessions.viewOf(tab.id)
    if (view?.model === undefined) return
    const instance = api.editor.create(host, {
      ...constructionOptions(editor.config, editor.font(), effectiveWrap, editor.prepareTheme(api), t('viewer.title')),
      model: view.model,
    })
    instanceRef.current = instance
    instances.set(tab.id, {
      tabId: tab.id,
      editor: instance,
      describe: (): EditorCommandContext => {
        const latest = sessions.stateOf(tab.id)
        return {
          editor: instance,
          monaco: api,
          document: {
            sessionId,
            path: latest?.path ?? view.path,
            languageId: latest?.languageId ?? 'plaintext',
          },
        }
      },
    })
    const disposeCursor = instance.onDidChangeCursorPosition((event) => {
      sessions.setPosition(tab.id, event.position.lineNumber, event.position.column,
        instance.getModel()?.getLineCount() ?? 1)
    })
    const disposeFocus = instance.onDidFocusEditorWidget(() => { sessions.setActive(tab.id) })
    instance.addCommand(api.KeyMod.CtrlCmd | api.KeyCode.KeyS, () => { saveRef.current(false) })
    return () => {
      disposeCursor.dispose()
      disposeFocus.dispose()
      instances.set(tab.id, undefined)
      instanceRef.current = null
      instance.dispose()
    }
  }, [api, editor, instances, modelRevision, sessions, t, tab.id])

  // 磁盘文本回装：外部变更或手动刷新读到新内容时，在保留光标的前提下替换模型文本，
  // 随后把保存基线移到新内容上（否则会被误判为未保存）。
  const appliedDisk = useRef(0)
  useEffect(() => {
    const view = sessions.viewOf(tab.id)
    const model = view?.model
    if (state === undefined || view === undefined || model === undefined) return
    if (state.diskRevision === 0 || state.diskRevision === appliedDisk.current) return
    appliedDisk.current = state.diskRevision
    if (model.getValue() !== view.text) {
      const instance = instanceRef.current
      const position = instance?.getPosition() ?? null
      model.setValue(view.text)
      if (instance !== null && position !== null && position.lineNumber <= model.getLineCount()) {
        instance.setPosition(position)
      }
    }
    sessions.appliedDiskText(tab.id, model)
  }, [sessions, state, tab.id])

  // 命令与动作：跟随注册表变化重新绑定。两者都走 `addAction`，因此在下次重建时
  // 能够完整释放——撤销注册的命令不会留下仍然响应快捷键的旧闭包。
  useEffect(() => {
    const instance = instanceRef.current
    if (api === undefined || instance === null) return
    const disposables: Monaco.IDisposable[] = []
    for (const command of registry.getSnapshot().commands) {
      disposables.push(instance.addAction({
        id: command.id,
        label: command.label,
        ...(command.keybindings === undefined ? {} : { keybindings: [...command.keybindings] }),
        run: () => {
          const entry = instances.pick(tab.id)
          if (entry !== undefined) void command.run(entry.describe())
        },
      }))
    }
    for (const action of registry.getSnapshot().actions) {
      disposables.push(instance.addAction({
        id: action.id,
        label: action.label,
        ...(action.keybindings === undefined ? {} : { keybindings: [...action.keybindings] }),
        ...(action.precondition === undefined ? {} : { precondition: action.precondition }),
        run: () => {
          const entry = instances.pick(tab.id)
          if (entry !== undefined) void action.run(entry.describe())
        },
      }))
    }
    return () => {
      for (const disposable of disposables) disposable.dispose()
    }
  }, [api, instances, modelRevision, registry, registryRevision, tab.id])

  // 换行：工具栏覆盖或全局设置变化时同步给 Monaco。
  useEffect(() => {
    instanceRef.current?.updateOptions({ wordWrap: effectiveWrap ? 'on' : 'off' })
  }, [effectiveWrap, modelRevision])

  // 行导航：只在平台给出新的导航代数时应答一次，滚动与光标都落在目标行。
  const answeredNavigation = useRef(-1)
  useEffect(() => {
    if (answeredNavigation.current === tab.navigation.revision) return
    const line = navigationLine(tab.navigation.params)
    const instance = instanceRef.current
    if (line === undefined || instance === null) return
    answeredNavigation.current = tab.navigation.revision
    instance.revealLineInCenter(line)
    instance.setPosition({ lineNumber: line, column: 1 })
    instance.focus()
  }, [modelRevision, tab.navigation.params, tab.navigation.revision])

  const commit = useCallback((force: boolean) => {
    void saveTab({ sessions, saveDocument: editor.saveDocument, logger: editor.logger, t }, tab.id, { force })
      .then((outcome) => {
        if (outcome.status !== 'saved') return
        // 平台文档视图据此刷新它记录的磁盘版本。
        const renderer = contentRef.current
        if (renderer.kind === 'renderer') renderer.loaded(outcome.version)
      })
  }, [editor, sessions, t, tab.id])
  saveRef.current = commit

  const reloadFromDisk = useCallback(() => {
    sessions.discardLocal(tab.id)
    const renderer = contentRef.current
    if (renderer.kind === 'renderer') renderer.reload()
  }, [sessions, tab.id])

  const overwrite = (): void => { commit(true) }
  const retry = (): void => {
    const renderer = contentRef.current
    if (renderer.kind === 'renderer') renderer.reload()
  }

  const runtimeFailure = runtimeState.status === 'failed' ? runtimeState.failure : undefined
  const notice = state?.conflict === true
    ? (
      <div className="dsh-monaco-notice" data-tone="warn" data-dsh-monaco-conflict>
        <span>{state.message ?? t('conflict.external')}</span>
        <button type="button" className="dsh-monaco-action" onClick={reloadFromDisk}>{t('conflict.reload')}</button>
        <button type="button" className="dsh-monaco-action" onClick={overwrite}>{t('conflict.overwrite')}</button>
      </div>
    )
    : state?.message !== undefined && state.phase === 'ready'
      ? (
        <div className="dsh-monaco-notice" data-tone="error" data-dsh-monaco-notice>
          <span>{state.message}</span>
        </div>
      )
      : null
  const overlay = runtimeFailure !== undefined
    ? (
      <div className="dsh-monaco-overlay" data-dsh-monaco-runtime-failure>
        <span>{t('error.editorUnavailable', { message: runtimeFailure })}</span>
      </div>
    )
    : state?.phase === 'failed'
      ? (
        <div className="dsh-monaco-overlay" data-dsh-monaco-load-failure>
          <span>{state.message ?? t('error.readFailed', { message: '' })}</span>
          <button type="button" className="dsh-monaco-action" onClick={retry}>{t('state.retry')}</button>
        </div>
      )
      : meta.status === 'failed'
        ? (
          // 文件元数据读不到（文件不存在或其工作区未知）时没有任何正文可读，
          // 这里必须明说原因，否则界面会一直停在「正在加载文件…」。
          <div className="dsh-monaco-overlay" data-tone="error" data-dsh-monaco-meta-failure>
            <span>{t('error.readFailed', { message: meta.failure?.message ?? '' })}</span>
            <button type="button" className="dsh-monaco-action" onClick={retry}>{t('state.retry')}</button>
          </div>
        )
        : state === undefined || state.phase !== 'ready'
          ? (
            <div className="dsh-monaco-overlay" data-dsh-monaco-loading>
              <span>{runtimeState.status === 'ready' ? t('state.loading') : t('state.loadingEditor')}</span>
            </div>
          )
          : null
  const languageLabel = state === undefined
    ? ''
    : registry.labelOf(state.languageId) ?? state.languageId
  return (
    <div className="dsh-monaco-root" data-dsh-monaco-root>
      {notice}
      <div className="dsh-monaco-host" ref={hostRef} data-dsh-monaco-host />
      {overlay}
      <div className="dsh-monaco-status" data-dirty={state?.dirty === true ? 'true' : 'false'} data-dsh-monaco-status>
        <editor.settingsControl />
        <span data-dsh-monaco-language>{languageLabel}</span>
        <span data-dsh-monaco-position>
          {t('status.position', { line: state?.line ?? 1, column: state?.column ?? 1 })}
        </span>
        <span data-dsh-monaco-lines>{t('status.lines', { count: state?.lines ?? 1 })}</span>
        <span className="dsh-monaco-spacer" />
        <span data-dsh-monaco-dirty>
          {state?.saving === true
            ? t('status.saving')
            : state?.dirty === true ? t('status.unsaved') : t('status.saved')}
        </span>
      </div>
    </div>
  )
}
