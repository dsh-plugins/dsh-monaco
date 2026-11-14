/**
 * `min/vs` 静态资源的 URL 解析与媒体类型判定。
 *
 * 路由把请求路径交给 {@link resolveVsAssetPath}，由它给出安全的相对路径与
 * Content-Type；任何越界、隐藏协议或非静态脚本的请求都被拒绝。
 * @module dsh-monaco/shared/assets
 */

/** 允许从 Monaco 目录下取出的媒体类型，按小写扩展名索引。 */
export const VS_ASSET_MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.ttf', 'font/ttf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
])

/** 一份可以安全读出的静态资源。 */
export interface VsAsset {
  /** 相对 `min/vs` 根目录的 `/` 分隔路径。 */
  readonly relativePath: string
  /** 响应用的 Content-Type。 */
  readonly contentType: string
}

/**
 * 把一段请求路径解析成 Monaco 目录内的相对资源路径。
 * @param requestPath - 挂载前缀之后的路径，可带查询串与百分号编码。
 * @returns 通过校验的资源描述，或 `undefined`（调用方回 404）。
 */
export function resolveVsAssetPath(requestPath: string): VsAsset | undefined {
  const withoutQuery = requestPath.split(/[?#]/, 1)[0] ?? ''
  if (withoutQuery.length === 0) return undefined
  const segments: string[] = []
  for (const raw of withoutQuery.split('/')) {
    if (raw.length === 0) continue
    let segment: string
    try {
      segment = decodeURIComponent(raw)
    } catch {
      // 百分号序列非法：这一段不可能是目录里真实存在的文件名。
      return undefined
    }
    // 解码之后仍可能是 `..%2f..%2fpackage.json` 这种把分隔符藏进单段里的写法，
    // 所以点段、两种分隔符与 NUL 一律按越界处理。
    if (segment === '.' || segment === '..') return undefined
    if (segment.includes('/') || segment.includes('\\') || segment.includes('\u0000')) return undefined
    segments.push(segment)
  }
  if (segments.length === 0) return undefined
  const relativePath = segments.join('/')
  const dot = relativePath.lastIndexOf('.')
  // 点必须落在文件名里而不是目录段上，且前面要有非空的名字（`.js` 是隐藏文件，不是资源）。
  if (dot <= relativePath.lastIndexOf('/') + 1) return undefined
  const contentType = VS_ASSET_MEDIA_TYPES.get(relativePath.slice(dot).toLowerCase())
  if (contentType === undefined) return undefined
  return { relativePath, contentType }
}
