/**
 * Monaco 资源加载器。
 *
 * 编辑器以 Monaco 官方 AMD 发行版（`monaco-editor/min/vs`）运行：本插件在宿主注册
 * 静态资源路由，浏览器注入 `loader.js` 后按 `vs/editor/editor.main` 加载。
 * 这样语言包、字体与四个语言 Worker 都由 Monaco 自己的目录结构提供，
 * 不需要把几 MB 的编辑器塞进插件产物，也不需要手写 Worker 打包。
 *
 * 页面级只加载一次：加载结果挂在 `Symbol.for('dsh-monaco/runtime')` 上，
 * 插件热重载后新实例直接复用同一个 Monaco。
 * @module dsh-monaco/client/monaco/runtime
 */
import type { MonacoApi } from '../types.ts'

/** AMD `require` 中本插件用到的成员。 */
interface AmdRequire {
  (modules: readonly string[], onLoad: () => void, onError: (error: unknown) => void): void
  config(options: {
    readonly paths?: Readonly<Record<string, string>>
    readonly config?: Readonly<Record<string, unknown>>
  }): void
}

/** 跨插件实例共享的加载状态。 */
interface SharedRuntime {
  loader?: Promise<void>
  loading?: Promise<MonacoApi>
  api?: MonacoApi
}

/** 加载器状态：编辑器据此决定渲染占位、编辑器还是失败提示。 */
export interface MonacoRuntimeState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed'
  readonly api: MonacoApi | undefined
  readonly failure: string | undefined
}

/** 加载所需的页面资源地址与语言。 */
export interface MonacoRuntimeOptions {
  /** `loader.js` 的地址。 */
  readonly loaderUrl: string
  /** `vs` 目录的地址，作为 AMD 的 `paths.vs`。 */
  readonly vsBaseUrl: string
  /** Monaco 界面语言；`undefined` 使用英文默认消息包。 */
  readonly locale: string | undefined
  /** 失败与加载过程写入的平台日志。 */
  readonly logger: { warn(format: unknown, ...params: unknown[]): void }
}

/** 取本页共享的加载状态。 */
function sharedRuntime(): SharedRuntime {
  const key = Symbol.for('dsh-monaco/runtime')
  const holder = globalThis as unknown as Record<symbol, SharedRuntime | undefined>
  return holder[key] ??= {}
}

/**
 * 向文档注入一次脚本。
 * @param url - 脚本地址。
 * @returns 加载完成或被拒绝时结算。
 */
function injectScript(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.dataset.dshMonacoLoader = ''
    script.addEventListener('load', () => { resolve() }, { once: true })
    script.addEventListener('error', () => {
      script.remove()
      reject(new Error(`dsh-monaco: failed to load ${url}`))
    }, { once: true })
    document.head.appendChild(script)
  })
}

/** 读取页面上的 AMD require。 */
function amdRequire(): AmdRequire | undefined {
  return (globalThis as { require?: AmdRequire }).require
}

/** Monaco 加载器。 */
export class MonacoRuntime {
  private state: MonacoRuntimeState = { status: 'idle', api: undefined, failure: undefined }
  private readonly listeners = new Set<() => void>()

  /** @param options - 资源地址、界面语言与日志出口。 */
  constructor(private readonly options: MonacoRuntimeOptions) {}

  /**
   * 读取当前加载状态。
   * @returns 状态快照；不变时返回同一个对象，可直接交给 `useSyncExternalStore`。
   */
  readonly getState = (): MonacoRuntimeState => this.state

  /**
   * 订阅状态变化。
   * @param listener - 状态观察者。
   * @returns 取消订阅。
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * 加载 Monaco；同一页面内只会真正执行一次。
   * @returns 就绪的 Monaco 命名空间。
   * @throws 当脚本或模块加载失败时抛出，并同时把失败写进状态与日志。
   */
  async load(): Promise<MonacoApi> {
    const shared = sharedRuntime()
    if (shared.api !== undefined) {
      this.publish({ status: 'ready', api: shared.api, failure: undefined })
      return shared.api
    }
    this.publish({ status: 'loading', api: undefined, failure: undefined })
    shared.loading ??= this.bootstrap(shared)
    try {
      const api = await shared.loading
      shared.api = api
      this.publish({ status: 'ready', api, failure: undefined })
      return api
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 失败的加载不能留下半成品状态，否则重试会永远拿到同一个拒绝：
      // 脚本地址本身出错时连 loader 也要重新注入，而不是复用被拒绝的那次加载。
      delete shared.loading
      delete shared.loader
      this.publish({ status: 'failed', api: undefined, failure: message })
      this.options.logger.warn('dsh-monaco: Monaco 加载失败：%s', message)
      throw error
    }
  }

  private publish(next: MonacoRuntimeState): void {
    const previous = this.state
    if (previous.status === next.status && previous.api === next.api && previous.failure === next.failure) return
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private async bootstrap(shared: SharedRuntime): Promise<MonacoApi> {
    shared.loader ??= injectScript(this.options.loaderUrl)
    await shared.loader
    const amd = amdRequire()
    if (amd === undefined) throw new Error('dsh-monaco: Monaco loader did not install an AMD require')
    const locale = this.options.locale
    amd.config({
      paths: { vs: this.options.vsBaseUrl },
      ...(locale === undefined ? {} : { config: { 'vs/nls': { availableLanguages: { '*': locale } } } }),
    })
    await new Promise<void>((resolve, reject) => {
      amd(['vs/editor/editor.main'], () => { resolve() }, (error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
    const api = (globalThis as { monaco?: MonacoApi }).monaco
    if (api === undefined) throw new Error('dsh-monaco: Monaco did not publish its namespace')
    return api
  }
}
