/**
 * Monaco 静态资源路由：把 `<package>/min/vs` 整棵目录挂在 `/dsh-monaco/vs/` 下。
 *
 * 资源路径在进入文件系统之前先由 {@link resolveVsAssetPath} 归一化，
 * 只放行白名单内的扩展名，越界与隐藏协议一律 404。读取资源前先校验属主身份。
 * @module dsh-monaco/routes/vs-assets
 */
import { readFile, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { MONACO_ASSET_PREFIX } from '../shared/protocol.ts'
import { resolveVsAssetPath } from '../shared/assets.ts'
import type { ConnectionLike, HostServices, PeerLike, RequestLike, ResponseLike } from '../host-types.ts'

/** 资源路由的挂载前缀（不含结尾斜杠）。 */
const ROUTE_PATH = MONACO_ASSET_PREFIX.replace(/\/$/u, '')

/** 本插件记录日志用的最小接口。 */
type Logger = HostServices['logger']

/**
 * 文件路由只允许属主访问。0.2.3 由 WebServer 传入已认证的身份，
 * 0.2.2 由处理函数调用 Connection.admit 校验请求。停止支持 0.2.2 时可移除该分支。
 */
export function rejected(connection: ConnectionLike, req: RequestLike, res: ResponseLike, peer?: PeerLike): boolean {
  const admission = peer === undefined
    ? connection.admit?.(req) ?? { rejection: 503 }
    : { peer }
  let status: number
  if ('rejection' in admission) {
    status = admission.rejection
  } else if (admission.peer.signal.aborted) {
    status = 401
  } else if (admission.peer.principal.kind !== 'owner') {
    status = 403
  } else {
    return false
  }
  res.writeHead(status, { 'cache-control': 'no-store' })
  res.end()
  return true
}

/**
 * 发送 JSON 响应。
 * @param res - 响应。
 * @param status - HTTP 状态码。
 * @param payload - 可序列化的响应体。
 */
export function sendJson(res: ResponseLike, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body, 'utf8'),
  })
  res.end(body)
}

/**
 * 发送 405 并声明允许的方法。
 * @param res - 响应。
 * @param allowed - 允许的方法列表。
 */
export function methodNotAllowed(res: ResponseLike, allowed: readonly string[]): void {
  res.writeHead(405, { allow: allowed.join(', '), 'cache-control': 'no-store' })
  res.end()
}

/**
 * 注册 Monaco 资源路由。
 * @param services - 宿主服务。
 * @param vsRoot - `min/vs` 的绝对路径。
 * @param cacheSeconds - 浏览器缓存秒数。
 * @returns 撤销函数。
 */
export function registerAssetRoute(services: HostServices, vsRoot: string, cacheSeconds: number): () => void {
  const logger: Logger = services.logger
  return services.webServer.register({
    kind: 'prefix',
    path: ROUTE_PATH,
    auth: 'required',
    handler: async (req, res, peer) => {
      if (rejected(services.connection, req, res, peer)) {
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        methodNotAllowed(res, ['GET', 'HEAD'])
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.invalid').pathname
      if (!pathname.startsWith(MONACO_ASSET_PREFIX)) {
        res.writeHead(404, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      const asset = resolveVsAssetPath(pathname.slice(MONACO_ASSET_PREFIX.length))
      if (asset === undefined) {
        // 只放行静态资源白名单；目录、隐藏协议与非静态扩展名都按不存在处理。
        res.writeHead(404, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      const absolute = resolve(vsRoot, ...asset.relativePath.split('/'))
      // 路径解析已经拒绝了点段与藏在段内的分隔符；这里再确认落脚点仍在资源目录内。
      if (!absolute.startsWith(vsRoot + sep)) {
        logger.warn('dsh-monaco: 拒绝越界的资源请求 %s', asset.relativePath)
        res.writeHead(404, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      let info
      try {
        info = await stat(absolute)
      } catch (error) {
        logger.warn('dsh-monaco: 资源不存在 %s：%s', asset.relativePath,
          error instanceof Error ? error.message : String(error))
        res.writeHead(404, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      if (!info.isFile()) {
        res.writeHead(404, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      const etag = `W/"${String(info.size)}-${String(Math.trunc(info.mtimeMs))}"`
      const requestEtag = req.headers['if-none-match']
      if (typeof requestEtag === 'string' && requestEtag === etag) {
        res.writeHead(304, { etag, 'cache-control': `public, max-age=${String(cacheSeconds)}` })
        res.end()
        return
      }
      const headers: Record<string, string | number> = {
        'content-type': asset.contentType,
        'content-length': info.size,
        'cache-control': `public, max-age=${String(cacheSeconds)}`,
        etag,
        'x-content-type-options': 'nosniff',
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, headers)
        res.end()
        return
      }
      res.writeHead(200, headers)
      try {
        res.end(await readFile(absolute))
      } catch (error) {
        // 头已经发出，这里只能结束连接；日志留下真实原因，便于排查磁盘或权限问题。
        logger.warn('dsh-monaco: 读取资源 %s 失败：%s', asset.relativePath,
          error instanceof Error ? error.message : String(error))
        res.end()
      }
    },
  })
}
