/**
 * 编辑器与宿主之间的文件读写。
 *
 * 读走平台已有的 `remote.workspaceFiles.readBytes`（按会话授权、带字节上限）；
 * 写走本插件在宿主注册的 JSON 路由，带版本守卫以便发现磁盘上的并发修改。
 * @module dsh-monaco/client/editor/source
 */
import type { SaveFileRequest, SaveFileResult } from '../../shared/protocol.ts'
import type { RemoteFace, Translate } from '../types.ts'

/** 读取结果：成功给出文本与版本，失败给出可直接展示的原因。 */
export type DocumentRead =
  | { readonly ok: true; readonly value: { readonly text: string; readonly version: string } }
  | { readonly ok: false; readonly error: string }

/** 写日志用的最小接口。 */
export interface SourceLogger {
  warn(format: unknown, ...params: unknown[]): void
}

/**
 * 把平台的文件读取失败翻译成界面文案。
 * @param t - 文案函数。
 * @param failure - 平台返回的失败。
 * @returns 可直接展示的句子。
 */
function describeReadFailure(t: Translate, failure: { readonly code: string; readonly message: string }): string {
  switch (failure.code) {
    case 'workspace-file/too-large':
      return t('error.tooLarge')
    case 'workspace-file/not-found':
      return t('error.notFound')
    case 'workspace-file/not-text':
      return t('error.notText')
    case 'workspace-file/not-regular-file':
      return t('error.notRegularFile')
    default:
      return t('error.readFailed', { message: failure.message })
  }
}

/**
 * 读取一份文件的完整文本。
 * @param remote - 平台客户端 Remote。
 * @param t - 文案函数。
 * @param logger - 解码失败的记录出口。
 * @param sessionId - 文件所在会话。
 * @param path - 宿主执行环境中的绝对路径。
 * @param signal - 取消信号。
 * @returns 文本与版本，或失败原因。
 */
export async function readDocument(
  remote: RemoteFace,
  t: Translate,
  logger: SourceLogger,
  sessionId: string,
  path: string,
  signal: AbortSignal,
): Promise<DocumentRead> {
  const result = await remote.workspaceFiles.readBytes(sessionId, path, {}, signal)
  if (!result.ok) return { ok: false, error: describeReadFailure(t, result.error) }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(result.value.data)
    return { ok: true, value: { text, version: result.value.version } }
  } catch (error) {
    // 非 UTF-8 字节不是编辑器能展示的文本；记录下来，界面给出一句可读的说明。
    logger.warn('dsh-monaco: 文件不是 UTF-8 文本（%s）：%s', path,
      error instanceof Error ? error.message : String(error))
    return { ok: false, error: t('error.notText') }
  }
}

/**
 * 把一份文本写回宿主文件。
 * @param url - 保存端点。
 * @param t - 文案函数。
 * @param logger - 网络或响应异常的记录出口。
 * @param request - 保存请求。
 * @returns 成功的新版本，或分类后的失败。
 */
export async function saveDocument(
  url: string,
  t: Translate,
  logger: SourceLogger,
  request: SaveFileRequest,
): Promise<SaveFileResult> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch (error) {
    logger.warn('dsh-monaco: 保存请求未送达：%s', error instanceof Error ? error.message : String(error))
    return { ok: false, code: 'write-failed', message: t('error.saveNetwork') }
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    logger.warn('dsh-monaco: 保存响应不是 JSON（HTTP %d）：%s', response.status,
      error instanceof Error ? error.message : String(error))
    return { ok: false, code: 'write-failed', message: t('error.saveResponse', { status: response.status }) }
  }
  if (typeof payload !== 'object' || payload === null || !('ok' in payload)) {
    logger.warn('dsh-monaco: 保存响应缺少结果字段（HTTP %d）', response.status)
    return { ok: false, code: 'write-failed', message: t('error.saveResponse', { status: response.status }) }
  }
  return payload as SaveFileResult
}
