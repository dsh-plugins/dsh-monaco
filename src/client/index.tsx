/**
 * dsh-monaco 浏览器端入口。
 *
 * 这个插件做三件事：
 * 1. 把 Monaco 接进右侧边栏：它在文档预览注册表里以 `extension` 优先级接管文本/代码文件，
 *    用户打开文件时看到的就是可编辑、可保存的编辑器；
 * 2. 通过宿主路由保存文件，保存前用版本守卫发现磁盘上的并发修改；
 * 3. 向其他插件提供 `ctx.monacoEditor`：注册语言与高亮规则、主题、命令、动作，
 *    追加接管的文件扩展名，并订阅文档打开/保存/修改事件。
 * @module dsh-monaco/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { BASE_CODE_EXTENSIONS, claimedExtensions } from '../shared/claim.ts'
import { sessionFileAddress } from '../shared/file-address.ts'
import { monacoLocaleFor } from '../shared/locale.ts'
import { MONACO_ASSET_PREFIX, MONACO_SAVE_PATH } from '../shared/protocol.ts'
import { FOLLOW_THEME_ID, readClientConfig } from './config.ts'
import type { EditorDefaults } from './config.ts'
import { createEditorBody } from './editor/body-component.tsx'
import { CloseGuard, TabCloseVeto } from './editor/close-guard.ts'
import { createCloseConfirm } from './editor/CloseConfirm.tsx'
import { createSettingsControl } from './editor/EditorSettings.tsx'
import { EditorInstances } from './editor/instances.ts'
import { saveTab } from './editor/saver.ts'
import { EditorSettingsStore } from './editor/settings.ts'
import { EditorSessions } from './editor/sessions.ts'
import { readDocument as readFileText, saveDocument as writeFileText } from './editor/source.ts'
import { CLOSE_BUTTON_SELECTOR, TAB_ID_ATTRIBUTE, TAB_SELECTOR, TabBadges } from './editor/tab-badges.ts'
import { en, LOCALE_NAMESPACE, zh } from './locales.ts'
import { MonacoRuntime, type MonacoRuntimeOptions } from './monaco/runtime.ts'
import { MonacoExtensionRegistry } from './monaco/registry.ts'
import { followShadowVariables } from './monaco/shadow-vars.ts'
import { buildSchemeTheme, readDocumentTokens, readEditorFont, schemeThemeId } from './monaco/theme.ts'
import type { EditorFont } from './monaco/theme.ts'
import { STYLES, STYLE_OWNER } from './styles.ts'
import type {
  Disposable,
  DocumentOpenEvent,
  MonacoApi,
  MonacoEditorService,
  PlatformContext,
} from './types.ts'

export type {
  ActionContribution,
  CommandContribution,
  DocumentChangeEvent,
  DocumentOpenEvent,
  DocumentSaveEvent,
  EditorCommandContext,
  LanguageContribution,
  MonacoEditorService,
  ThemeContribution,
} from './types.ts'

/** 与 package.json 的 `name` 一致。 */
export const name = 'dsh-monaco'

/** 文档预览注册表里的实现身份，同时也是 `sidebar.right.tab.document` 的槽位键。 */
export const VIEWER_ID = 'dsh-monaco/editor'

/** 所需浏览器服务：插槽、文案、主题、文档预览注册表、侧边栏，以及文件读取用的远程方法。 */
export const inject = ['slots', 'locale', 'theme', 'documentPreviews', 'sidebarRight', 'remote', 'remote.workspaceFiles']

/** 平台文本预览标签页的类型；本插件在该类型内部替换正文与关闭行为。 */
const TEXT_TAB_KIND = 'text'

/** 把样式标签注入页面，热重载时按归属标记替换旧标签。 */
function installStyles(): Disposable {
  document.querySelector(`style[data-plugin-css="${STYLE_OWNER}"]`)?.remove()
  const style = document.createElement('style')
  style.dataset.pluginCss = STYLE_OWNER
  style.dataset.dshMonaco = ''
  style.textContent = STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}

/**
 * 挂载浏览器侧编辑器。
 * @param ctx - 浏览器 Cordis 上下文。
 */
export function apply(ctx: ClientContext): void {
  // 平台浏览器服务的类型面不在本包内，这里只按实际用到的成员做一次窄化转换。
  // 副作用一律经由 `platform.effect` 登记，卸载或热重载时按逆序自动回收。
  const platform = ctx as unknown as PlatformContext
  const config = readClientConfig(globalThis as { readonly __DSH_MONACO_CONFIG__?: unknown })
  const t = platform.locale.bind(LOCALE_NAMESPACE)
  const sessions = new EditorSessions()
  const instances = new EditorInstances()
  const registry = new MonacoExtensionRegistry(platform.logger)
  const runtimeOptions: MonacoRuntimeOptions = {
    loaderUrl: `${MONACO_ASSET_PREFIX}loader.js`,
    // AMD 的 `vs` 路径指向包含 `editor/` 与 `assets/` 的目录，也就是资源前缀本身（去掉结尾斜杠）。
    vsBaseUrl: MONACO_ASSET_PREFIX.replace(/\/$/u, ''),
    locale: monacoLocaleFor(platform.locale.getLocale().active),
    logger: platform.logger,
  }
  const runtime = new MonacoRuntime(runtimeOptions)
  const editorDefaults: EditorDefaults = config.editor
  const settings = new EditorSettingsStore(platform.logger)
  let disposed = false

  platform.effect(installStyles, 'dsh-monaco: styles')
  platform.effect(() => platform.locale.register(LOCALE_NAMESPACE, { zh, en }), 'dsh-monaco: dictionaries')

  /** 当前应使用的 Monaco 主题标识。 */
  const unknownThemeReported = new Set<string>()
  const themeId = (): string => {
    const configured = editorDefaults.theme
    if (configured !== FOLLOW_THEME_ID) {
      if (registry.themeOf(configured) !== undefined) return configured
      if (!unknownThemeReported.has(configured)) {
        unknownThemeReported.add(configured)
        platform.logger.warn('dsh-monaco: 配置的主题 "%s" 尚未注册，暂时跟随界面主题', configured)
      }
    }
    return schemeThemeId(platform.theme.getTheme().active.colorScheme)
  }

  /** 把界面主题的颜色写进 Monaco，并切到当前选择。 */
  const applyTheme = (api: MonacoApi): void => {
    const scheme = platform.theme.getTheme().active.colorScheme
    api.editor.defineTheme(schemeThemeId(scheme), buildSchemeTheme(scheme, readDocumentTokens(platform.logger)))
    api.editor.setTheme(themeId())
  }

  /**
   * 在创建编辑器之前把主题定义好并设成全局默认。
   *
   * 主题必须以十六进制、且在 `editor.create` 之前定义完毕：否则 Monaco 会在创建过程
   * 中途抛错，留下一个没有配色、没有 token 颜色的半初始化编辑器。
   * @param api - 已就绪的 Monaco 命名空间。
   * @returns 应当传给本次构造的 `theme` 的值。
   */
  const prepareTheme = (api: MonacoApi): string => {
    applyTheme(api)
    return themeId()
  }

  /** 当前代码字体与字号，来自 DSH 的字体设置。 */
  const font = (): EditorFont => readEditorFont()

  /**
   * 把字体变化推给已经打开的编辑器。
   *
   * `fontFamily` / `fontSize` 不会随主题自动重算，插件自己更新；
   * 改了字体后 Monaco 会重新测量行高，正在编辑的内容与光标不受影响。
   */
  const applyFont = (): void => {
    const next = font()
    for (const entry of instances.all()) {
      entry.editor.updateOptions({
        fontFamily: next.family,
        ...next.size === undefined ? {} : { fontSize: next.size },
      })
    }
  }

  /** 文档接管范围：默认文本扩展名 + 宿主配置 + 其它插件追加。 */
  const claimedNow = (): readonly string[] => claimedExtensions(BASE_CODE_EXTENSIONS, [
    ...config.extensions,
    ...registry.extraExtensionList(),
    ...registry.languageExtensions(),
  ])

  /**
   * 扩展注册表变化后重写文档接管范围与 Monaco 侧注册。
   *
   * 文档接管同步更新：任何一次注册之后立刻打开文件都必须命中本编辑器。
   * 写进 Monaco 的那一半合并到下一个微任务，避免连续注册时反复重写语言与主题。
   */
  let definition: Disposable | undefined
  let syncQueued = false
  const reconcile = (): void => {
    if (disposed) return
    definition?.()
    definition = platform.documentPreviews.register({
      id: VIEWER_ID,
      extensions: claimedNow(),
      priority: 'extension',
      title: () => t('viewer.title'),
      loading: 'renderer',
      wrap: true,
    })
    if (syncQueued) return
    syncQueued = true
    queueMicrotask(() => {
      syncQueued = false
      if (disposed) return
      const api = runtime.getState().api
      if (api === undefined) return
      void registry.syncInto(api).then(() => { applyTheme(api) })
    })
  }

  // 初始化时就注册一次：用户打开文件即可命中本编辑器。
  reconcile()
  platform.effect(() => () => {
    disposed = true
    definition?.()
    definition = undefined
  }, 'dsh-monaco: document claim')
  platform.effect(() => registry.subscribe(reconcile), 'dsh-monaco: registry subscription')

  // 界面主题或字体设置变化：重新派生配色，并把字体推给已打开的编辑器。
  platform.effect(() => platform.on('theme/change', () => {
    const api = runtime.getState().api
    if (api !== undefined) applyTheme(api)
    applyFont()
  }), 'dsh-monaco: theme sync')

  // Monaco 本体：页面内只加载一次，加载完把扩展与主题写进去。
  // `readyPromise` 是同一个 Promise：多次访问 `service.ready` 不会重复触发加载。
  const readyPromise: Promise<void> = runtime.load()
    .then(api => registry.syncInto(api).then(() => { applyTheme(api) }))
  void readyPromise.catch((error: unknown) => {
    // 具体原因已由 MonacoRuntime 记录并在视图里展示；这里补一句排查方向。
    platform.logger.warn('dsh-monaco: 编辑器初始化失败（%s），检查 /dsh-monaco/vs/ 资源路由是否可用',
      error instanceof Error ? error.message : String(error))
  })

  // 视图：一个闭包里绑定好插件能力的组件，注册为文档渲染器。
  platform.effect(() => platform.slots.inject('sidebar.right.tab.document', () => platform.slots.register(
    { name: 'sidebar.right.tab.document', key: VIEWER_ID, locale: LOCALE_NAMESPACE },
    createEditorBody({
      sessions,
      instances,
      runtime,
      registry,
      config: editorDefaults,
      settings,
      settingsControl: createSettingsControl({ settings, t }),
      t,
      logger: platform.logger,
      readDocument: (sessionId, path, signal) => readFileText(platform.remote, t, platform.logger, sessionId, path, signal),
      saveDocument: request => writeFileText(MONACO_SAVE_PATH, t, platform.logger, request),
      prepareTheme,
      font,
    }),
  )), 'dsh-monaco: editor body')

  // 未保存关闭的守卫：确认框状态、保存通道与真正的关闭动作。
  const guard = new CloseGuard({
    sessions,
    save: tabId => saveTab(
      { sessions, saveDocument: request => writeFileText(MONACO_SAVE_PATH, t, platform.logger, request), logger: platform.logger, t },
      tabId,
    ),
    close: (_sessionId, tabId) => { platform.sidebarRight.close(tabId) },
    mountedSession: () => platform.sidebarRight.mounted.getSnapshot(),
    logger: platform.logger,
    t,
  })
  platform.effect(() => sessions.on('close', tabId => { guard.forget(tabId) }), 'dsh-monaco: close guard cleanup')

  // 关闭钩子：只在本编辑器承载的标签页有未保存改动时中止关闭。
  // `'text'` 是平台内置类型，同一 kind 只能有一个钩子；注册冲突时只让本项失效，
  // 不把异常抛给 `apply`，否则整个客户端插件会一起加载失败。
  platform.effect(() => {
    try {
      return platform.sidebarRight.registerCloseHandler(TEXT_TAB_KIND, (sessionId, tab) => {
        if (guard.intercept(tab.id, sessionId)) throw new TabCloseVeto(tab.id)
      })
    } catch (error) {
      platform.logger.warn('dsh-monaco: 无法注册关闭钩子（%s），关闭标签页时将不会提示未保存改动',
        error instanceof Error ? error.message : String(error))
      return () => {}
    }
  }, 'dsh-monaco: close guard')

  // 关闭手势：标签芯片上的 × 与中键点击先经过这里，避免走平台那趟必然被拒的关闭。
  platform.effect(() => {
    const swallow = (event: MouseEvent, tabId: string | undefined): void => {
      if (tabId === undefined || !guard.intercept(tabId)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      swallow(event, target.closest<HTMLElement>(CLOSE_BUTTON_SELECTOR)?.dataset.dockkitTabClose)
    }
    const onAuxClick = (event: MouseEvent): void => {
      if (event.button !== 1) return
      const target = event.target
      if (!(target instanceof Element)) return
      swallow(event, target.closest<HTMLElement>(TAB_SELECTOR)?.dataset[TAB_ID_ATTRIBUTE])
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('auxclick', onAuxClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('auxclick', onAuxClick, true)
    }
  }, 'dsh-monaco: close gestures')

  // Monaco 的独立浮层（右键菜单、命令面板）渲染在 Shadow DOM 里，拿不到编辑器上的
  // `--vscode-*` 变量；把它们镜像到根元素，浮层才有背景、边框与正确的字色。
  platform.effect(() => followShadowVariables(platform.logger), 'dsh-monaco: shadow variables')

  // 标签页未保存标记：关闭按钮在脏状态下画成圆点。
  platform.effect(() => new TabBadges(sessions).start(), 'dsh-monaco: tab badges')

  // 确认框：挂在整帧浮层里，没有待确认的关闭时不渲染。
  platform.effect(() => platform.slots.inject('shell.overlay', () => platform.slots.register(
    { name: 'shell.overlay', id: 'dsh-monaco/close-confirm', order: 100 },
    createCloseConfirm({ guard, t }),
  )), 'dsh-monaco: close confirm')

  /** 把一个标签页描述成公开事件。 */
  const openEventOf = (tabId: string): DocumentOpenEvent | undefined => {
    const state = sessions.stateOf(tabId)
    const view = sessions.viewOf(tabId)
    if (state === undefined || view === undefined) return undefined
    return { tabId, sessionId: view.sessionId, path: state.path, languageId: state.languageId }
  }

  const service: MonacoEditorService = {
    version: 1,
    ready: readyPromise,
    get monaco() { return runtime.getState().api },
    registerLanguage: contribution => registry.registerLanguage(contribution),
    registerTheme: contribution => registry.registerTheme(contribution),
    registerCommand: contribution => registry.registerCommand(contribution),
    registerAction: contribution => registry.registerAction(contribution),
    registerFileExtensions: extensions => registry.registerFileExtensions(extensions),
    getActiveEditor: () => instances.pick(sessions.activeTabId())?.describe(),
    openFile: ({ sessionId, path, line }) => {
      const opener = sessions.lastOpener()
      if (opener === undefined) {
        platform.logger.warn('dsh-monaco: 没有可用的侧边栏入口，打开 "%s" 的请求被忽略', path)
        return false
      }
      opener(sessionFileAddress(sessionId, path), line === undefined ? {} : { params: { line } })
      return true
    },
    events: {
      onDidOpenDocument: listener => sessions.on('open', (tabId) => {
        const base = openEventOf(tabId)
        if (base !== undefined) listener(base)
      }),
      onDidSaveDocument: listener => sessions.on('save', (tabId) => {
        const base = openEventOf(tabId)
        const version = sessions.stateOf(tabId)?.version
        if (base === undefined || version === undefined) return
        listener({ ...base, version })
      }),
      onDidChangeDocument: listener => sessions.on('change', (tabId) => {
        const base = openEventOf(tabId)
        const dirty = sessions.stateOf(tabId)?.dirty
        if (base === undefined || dirty === undefined) return
        listener({ ...base, dirty })
      }),
      onDidCloseDocument: listener => sessions.on('close', (tabId) => {
        const base = openEventOf(tabId)
        if (base !== undefined) listener(base)
      }),
    },
  }
  platform.effect(() => platform.provide('monacoEditor', service), 'dsh-monaco: editor service')
}
