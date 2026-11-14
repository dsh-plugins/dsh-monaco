/**
 * 宿主路由与浏览器编辑器共用的保存协议。
 *
 * 编辑器读文件走平台已有的 `workspaceFiles.readBytes` 远程方法，写文件则由本插件
 * 注册的 HTTP 路由承担：平台的文件服务是只读的，没有可复用的写入端点。
 * @module dsh-monaco/shared/protocol
 */

/** Monaco 静态资源挂载点；`min/vs` 目录整体挂在这个前缀下。 */
export const MONACO_ASSET_PREFIX = '/dsh-monaco/vs/'

/** 保存请求端点。 */
export const MONACO_SAVE_PATH = '/dsh-monaco/api/write'

/** 保存协议版本；宿主对不认识的版本直接拒绝。 */
export const MONACO_SAVE_PROTOCOL = 1

/** 一次保存请求：把编辑器里的整份文本写回宿主文件。 */
export interface SaveFileRequest {
  /** 协议版本，固定为 {@link MONACO_SAVE_PROTOCOL}。 */
  readonly protocol: number
  /** 文件所在会话；宿主用它解析工作区与沙箱策略。 */
  readonly sessionId: string
  /** 文件在宿主执行环境中的绝对路径。 */
  readonly path: string
  /** 编辑器中的完整文本。 */
  readonly text: string
  /**
   * 编辑器读取时观察到的文件版本。
   * 缺省表示无条件覆盖：只有在用户对冲突明确选择「覆盖」时才会省略。
   */
  readonly expectedVersion?: string
}

/** 保存失败的原因分类，浏览器按它决定提示与后续动作。 */
export type SaveFailureCode =
  | 'bad-request'
  | 'stale-version'
  | 'not-found'
  | 'not-regular-file'
  | 'too-large'
  | 'forbidden'
  | 'write-failed'

/** 保存成功时返回写入后的新版本；失败时返回分类与可直接展示的原因。 */
export type SaveFileResult =
  | {
    readonly ok: true
    /** 写入后宿主报告的文件版本，编辑器用它刷新本地基线。 */
    readonly version: string
    /** 写入动作：新建或替换。 */
    readonly operation: 'create' | 'update'
  }
  | {
    readonly ok: false
    readonly code: SaveFailureCode
    readonly message: string
  }

/** 解析结果：成功带值，失败带原因。 */
export type ParseResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly message: string }

/** 请求里唯一允许的非空字符串字段。 */
function requiredString(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== 'string' || value.length === 0) {
    return { ok: false, message: `${field} must be a non-empty string` }
  }
  if (value.includes('\u0000')) {
    return { ok: false, message: `${field} must not contain NUL` }
  }
  return { ok: true, value }
}

/**
 * 校验一次保存请求。
 * @param input - 已解析的 JSON 值，来源不可信。
 * @returns 合法请求，或可直接写回前端的拒绝原因。
 */
export function parseSaveFileRequest(input: unknown): ParseResult<SaveFileRequest> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, message: 'body must be a JSON object' }
  }
  const body = input as Record<string, unknown>
  if (body.protocol !== MONACO_SAVE_PROTOCOL) {
    return { ok: false, message: `unsupported save protocol ${String(body.protocol)}` }
  }
  const sessionId = requiredString(body.sessionId, 'sessionId')
  if (!sessionId.ok) return sessionId
  const path = requiredString(body.path, 'path')
  if (!path.ok) return path
  if (typeof body.text !== 'string') {
    return { ok: false, message: 'text must be a string' }
  }
  if (body.expectedVersion !== undefined && (typeof body.expectedVersion !== 'string' || body.expectedVersion.length === 0)) {
    return { ok: false, message: 'expectedVersion must be a non-empty string when present' }
  }
  return {
    ok: true,
    value: {
      protocol: MONACO_SAVE_PROTOCOL,
      sessionId: sessionId.value,
      path: path.value,
      text: body.text,
      ...body.expectedVersion === undefined ? {} : { expectedVersion: body.expectedVersion as string },
    },
  }
}
