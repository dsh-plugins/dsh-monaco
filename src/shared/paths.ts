/**
 * 路径形态判定：区分绝对路径与相对路径。
 *
 * 保存路由需要这个判断——会话记录决定了相对路径的基准，没有会话时只能接受绝对路径。
 * 这里只做形态识别，不碰文件系统。
 * @module dsh-monaco/shared/paths
 */

/** `C:\x`、`C:/x` 形式的盘符路径。 */
const DRIVE_PATH = /^[A-Za-z]:[\\/]/u

/**
 * 判断一个路径是否是绝对路径。
 * @param path - 待判断的路径，`/` 与 `\` 都按分隔符处理。
 * @returns POSIX 根路径、UNC 路径与盘符路径为 `true`，其余为 `false`。
 */
export function isAbsoluteFilePath(path: string): boolean {
  if (path.length === 0) return false
  if (path.startsWith('/') || path.startsWith('\\')) return true
  return DRIVE_PATH.test(path)
}

/**
 * 判断路径里是否含 NUL 字节。
 * @param path - 待判断的路径。
 * @returns 含 NUL 时为 `true`；这种路径不可能指向真实文件。
 */
export function containsNul(path: string): boolean {
  return path.includes('\u0000')
}
