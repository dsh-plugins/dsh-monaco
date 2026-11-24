/**
 * 宿主端用到的平台服务外观。
 *
 * 本插件不在运行期值导入 `@deepseek-ai/*`，也不把平台类型并进 `Context`：
 * 平台内部服务签名随小版本变化，重复声明会与使用者工程里的同一份声明冲突。
 * 这里只列出实际调用到的成员，由插件入口做一次窄化转换。
 * @module dsh-monaco/host-types
 */

/** 文件目标的不透明身份与展示路径。 */
export interface FsTargetLike {
  readonly targetKey: string
  readonly displayPath: string
}

/** 路径元数据，`lstat` 不跟随最后一段符号链接。 */
export interface FsPathInfoLike {
  readonly version: string
  readonly type: 'file' | 'directory' | 'symlink' | 'other'
  readonly size?: number
}

/** 已解析目标的元数据。 */
export interface FsInfoLike {
  readonly version: string
  readonly type: 'file' | 'directory' | 'other'
  readonly size?: number
}

/** 写入意图：缺省表示无条件创建或覆盖。 */
export type FsWriteIntentLike =
  | { readonly kind: 'createIfAbsent' }
  | { readonly kind: 'replaceIfVersion'; readonly version: string }

/** 写入结果。 */
export interface FsWriteOutcomeLike {
  readonly operation: 'create' | 'update'
  readonly version: string
  readonly before: string | null
  readonly after: string
}

/** 一次文件能力调用所用的沙箱策略。 */
export interface SandboxExecutionPolicyLike {
  readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly workspaceRoot: string
  readonly additionalWritableRoots?: readonly string[]
  readonly sessionId?: string
}

/** 会话外观：写入只需要它记录的 cwd。 */
export interface SessionLike {
  readonly header: { readonly cwd?: string }
}

/** 组合文件系统里本插件用到的成员。 */
export interface HostFsLike {
  resolve(path: string, options?: { readonly cwd?: string; readonly signal?: AbortSignal }): Promise<FsTargetLike>
  lstat(path: string, options?: { readonly cwd?: string }, signal?: AbortSignal): Promise<FsPathInfoLike | undefined>
  stat(target: FsTargetLike, signal?: AbortSignal): Promise<FsInfoLike | undefined>
  writeText(
    target: FsTargetLike,
    content: string,
    expected?: FsWriteIntentLike,
    signal?: AbortSignal,
    sandboxPolicy?: SandboxExecutionPolicyLike,
  ): Promise<FsWriteOutcomeLike>
}

/** 沙箱策略服务。 */
export interface SandboxPolicyLike {
  readonly workspaceRoot: string
  resolve(request?: { readonly session?: SessionLike; readonly mode?: SandboxExecutionPolicyLike['mode'] }): SandboxExecutionPolicyLike
}

/** 会话存储。 */
export interface SessionsLike {
  get(id: string): SessionLike | undefined
}

/** 宿主认证的请求身份，文件路由只供属主访问。 */
export interface PeerLike {
  readonly principal: { readonly kind: string }
  readonly signal: AbortSignal
}

/** 一个已注册的 Web 路由。 */
export interface WebRouteLike {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly auth: 'required'
  readonly handler: (req: RequestLike, res: ResponseLike, peer?: PeerLike) => void | Promise<void>
}

/** `node:http` 请求里用到的字段。 */
export interface RequestLike {
  readonly method?: string
  readonly url?: string
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  on(event: 'data', listener: (chunk: Uint8Array) => void): void
  on(event: 'end', listener: () => void): void
  on(event: 'error', listener: (error: Error) => void): void
  /** 提前终止请求流，用于拒绝超限的上传。 */
  destroy?(): void
}

/** `node:http` 响应里用到的字段。 */
export interface ResponseLike {
  statusCode: number
  setHeader(name: string, value: string | number): void
  writeHead(status: number, headers?: Readonly<Record<string, string | number>>): unknown
  end(body?: string | Uint8Array): unknown
}

/** 浏览器 HTTP 载体。 */
export interface WebServerLike {
  register(route: WebRouteLike): () => void
}

/** WebServer 未传入身份时，由 Connection 校验请求来源和凭据。 */
export interface ConnectionLike {
  admit?(request: RequestLike): { readonly peer: PeerLike } | { readonly rejection: 401 | 403 | 503 }
}

/** 注入到 index.html 的一行结构化内容；这里只用到全局变量一种。 */
export interface IndexInjectionRow {
  readonly kind: 'global'
  readonly name: string
  readonly value: unknown
}

/** 本插件从宿主上下文取用的服务集合。`connection` 与服务同名声明：缺它时插件不该上岗。 */
export interface HostServices {
  readonly webServer: WebServerLike
  readonly fs: HostFsLike
  readonly sessions: SessionsLike
  readonly sandboxPolicy: SandboxPolicyLike
  readonly connection: ConnectionLike
  readonly logger: {
    info(format: unknown, ...params: unknown[]): void
    warn(format: unknown, ...params: unknown[]): void
    error(format: unknown, ...params: unknown[]): void
  }
  /** 页面渲染前收集注入行。 */
  on(event: 'webserver/index-inject', listener: (table: IndexInjectionRow[]) => void): () => void
  effect(callback: () => (() => void) | void, label: string): () => void
}
