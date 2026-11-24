/**
 * 保存路由：把编辑器里的整份文本写回宿主文件。
 *
 * 平台的文件远程服务是只读的，没有可复用的写入端点，所以这里自己承担一次写入：
 * 会话 cwd 决定相对路径的基准，沙箱策略决定写入权限，版本守卫负责发现磁盘上的并发修改。
 * @module dsh-monaco/routes/write
 */
import { MONACO_SAVE_PATH, parseSaveFileRequest, type SaveFailureCode } from '../shared/protocol.ts'
import { isAbsoluteFilePath } from '../shared/paths.ts'
import type {
  FsPathInfoLike,
  FsWriteIntentLike,
  HostServices,
  RequestLike,
} from '../host-types.ts'
import { methodNotAllowed, rejected, sendJson } from './vs-assets.ts'

/** 请求体在文本之外允许的 JSON 包装开销。 */
const BODY_OVERHEAD_BYTES = 64 * 1024

/** 平台文件错误到保存失败分类的映射。 */
const FAILURE_BY_FS_CODE: Readonly<Record<string, SaveFailureCode>> = {
  FS_STALE_VERSION: 'stale-version',
  FS_NOT_FOUND: 'not-found',
  FS_NOT_REGULAR_FILE: 'not-regular-file',
  FS_TOO_LARGE: 'too-large',
  FS_PERMISSION_DENIED: 'forbidden',
  FS_SANDBOX_DENIED: 'forbidden',
  FS_IO_ERROR: 'write-failed',
}

/** HTTP 状态码与失败分类的对应。 */
const STATUS_BY_CODE: Readonly<Record<SaveFailureCode, number>> = {
  'bad-request': 400,
  'forbidden': 403,
  'not-found': 404,
  'stale-version': 409,
  'not-regular-file': 409,
  'too-large': 413,
  'write-failed': 500,
}

/** 读取文件系统错误码。 */
function fsCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  const code = (error as { readonly code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * 读出请求体文本，并按上限中止。
 * @param req - 请求。
 * @param limit - 允许的最大字节数。
 * @returns 文本；超限或传输失败时给出原因。
 */
async function readBody(req: RequestLike, limit: number): Promise<{ ok: true; text: string } | { ok: false; reason: 'too-large' | 'aborted' }> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = []
    let size = 0
    let settled = false
    const settle = (value: { ok: true; text: string } | { ok: false; reason: 'too-large' | 'aborted' }): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      size += chunk.byteLength
      if (size > limit) {
        // 已经决定拒绝，就不再接收剩余字节：继续排空只会让客户端白白上传。
        settle({ ok: false, reason: 'too-large' })
        req.destroy?.()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size)
      settle({ ok: true, text: buffer.toString('utf8') })
    })
    req.on('error', () => { settle({ ok: false, reason: 'aborted' }) })
  })
}

/**
 * 注册保存路由。
 * @param services - 宿主服务。
 * @param maxWriteBytes - 单次写入允许的最大文本字节数。
 * @returns 撤销函数。
 */
export function registerWriteRoute(services: HostServices, maxWriteBytes: number): () => void {
  return services.webServer.register({
    kind: 'exact',
    path: MONACO_SAVE_PATH,
    auth: 'required',
    handler: async (req, res, peer) => {
      if (rejected(services.connection, req, res, peer)) {
        return
      }
      if (req.method !== 'POST') {
        methodNotAllowed(res, ['POST'])
        return
      }
      const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') {
        sendJson(res, 415, { ok: false, code: 'bad-request', message: 'content-type must be application/json' })
        return
      }
      const body = await readBody(req, maxWriteBytes + BODY_OVERHEAD_BYTES)
      if (!body.ok) {
        const message = body.reason === 'too-large'
          ? `request body exceeds ${String(maxWriteBytes)} bytes`
          : 'request body was aborted before it completed'
        sendJson(res, body.reason === 'too-large' ? 413 : 400, { ok: false, code: 'bad-request', message })
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(body.text)
      } catch (error) {
        services.logger.warn('dsh-monaco: 保存请求体不是合法 JSON：%s',
          error instanceof Error ? error.message : String(error))
        sendJson(res, 400, { ok: false, code: 'bad-request', message: 'body must be valid JSON' })
        return
      }
      const request = parseSaveFileRequest(parsed)
      if (!request.ok) {
        sendJson(res, 400, { ok: false, code: 'bad-request', message: request.message })
        return
      }
      const { sessionId, path, text, expectedVersion } = request.value
      if (Buffer.byteLength(text, 'utf8') > maxWriteBytes) {
        sendJson(res, 413, {
          ok: false, code: 'too-large',
          message: `text exceeds the ${String(maxWriteBytes)} byte write limit`,
        })
        return
      }
      const session = services.sessions.get(sessionId)
      if (session === undefined && !isAbsoluteFilePath(path)) {
        // 相对路径的基准只来自会话记录：会话不在了，这个请求就无处解析，直接拒绝。
        sendJson(res, 400, {
          ok: false, code: 'bad-request',
          message: `unknown session "${sessionId}": a relative path cannot be resolved`,
        })
        return
      }
      const cwd = session?.header.cwd ?? services.sandboxPolicy.workspaceRoot
      let entry: FsPathInfoLike | undefined
      try {
        entry = await services.fs.lstat(path, { cwd })
      } catch (error) {
        services.logger.warn('dsh-monaco: 检查 "%s" 失败：%s', path,
          error instanceof Error ? error.message : String(error))
        sendJson(res, 500, { ok: false, code: 'write-failed', message: 'could not inspect the target path' })
        return
      }
      if (entry === undefined) {
        sendJson(res, 404, { ok: false, code: 'not-found', message: `no file at "${path}"` })
        return
      }
      if (entry.type !== 'file') {
        sendJson(res, 409, {
          ok: false, code: 'not-regular-file',
          message: `"${path}" is a ${entry.type}, not a regular file`,
        })
        return
      }
      const policy = services.sandboxPolicy.resolve(session === undefined ? {} : { session })
      const expected: FsWriteIntentLike | undefined = expectedVersion === undefined
        ? undefined
        : { kind: 'replaceIfVersion', version: expectedVersion }
      try {
        const target = await services.fs.resolve(path, { cwd })
        const outcome = await services.fs.writeText(target, text, expected, undefined, policy)
        sendJson(res, 200, { ok: true, version: outcome.version, operation: outcome.operation })
      } catch (error) {
        const code = fsCodeOf(error)
        const failure = code === undefined ? undefined : FAILURE_BY_FS_CODE[code]
        const message = error instanceof Error ? error.message : String(error)
        services.logger.warn('dsh-monaco: 写入 "%s" 失败（%s）：%s', path, code ?? 'unknown', message)
        const kind: SaveFailureCode = failure ?? 'write-failed'
        sendJson(res, STATUS_BY_CODE[kind], { ok: false, code: kind, message })
      }
    },
  })
}
