/**
 * `dsh-resource://file/session/<sessionId>/<path>` 地址的构造。
 *
 * 编辑器需要把「在侧边栏打开这个文件」交给平台的侧边栏导航，这个地址就是它的输入。
 * 平台包里虽有同名函数，但属于宿主内部包，运行期不得值导入，因此在这里按已公布的
 * 地址语法自行构造。
 * @module dsh-monaco/shared/file-address
 */

/** 所有文件地址共用的前缀。 */
const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/** 单段编码：`:` 保持字面量，便于 Windows 盘符按原样出现。 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/giu, ':')
}

/**
 * 构造一个文件在某个会话工作区里的地址。
 * @param sessionId - 解析路径的会话。
 * @param path - 绝对路径或相对会话工作区的路径。
 * @returns `dsh-resource://file/session/<sessionId>/<path>` 地址。
 */
export function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^(?:\.\/)+/u, '')
  const encoded = normalized.split('/').map(encodeSegment).join('/')
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encoded}`
}
