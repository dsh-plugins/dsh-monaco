/**
 * 把编辑器里的内容写回磁盘。
 *
 * 保存有两条触发路径：编辑器里的 Ctrl+S，以及关闭标签页时的「保存」。
 * 两条路径必须写出同一份内容、走同一套版本守卫与状态迁移，所以实现放在这里，
 * 由视图与关闭守卫共用。
 * @module dsh-monaco/client/editor/saver
 */
import { MONACO_SAVE_PROTOCOL, type SaveFileRequest, type SaveFileResult } from '../../shared/protocol.ts'
import type { Translate } from '../types.ts'
import type { EditorSessions } from './sessions.ts'

/** 一次保存的结果。 */
export type SaveOutcome =
  /** 本来就没有改动，无需写入。 */
  | { readonly status: 'clean' }
  /** 已写入磁盘。 */
  | { readonly status: 'saved'; readonly version: string }
  /** 已有一次保存在飞，本次没有发起。 */
  | { readonly status: 'busy' }
  /** 没有写入，原因已写进标签页状态。 */
  | { readonly status: 'failed' }

/** 保存需要的插件能力。 */
export interface SaveFace {
  readonly sessions: EditorSessions
  readonly saveDocument: (request: SaveFileRequest) => Promise<SaveFileResult>
  readonly logger: { warn(format: unknown, ...params: unknown[]): void }
  readonly t: Translate
}

/**
 * 保存一个标签页的当前内容。
 *
 * 失败与冲突都写进标签页状态（提示条会显示），这里只回报结果，
 * 由调用方决定是否继续（例如关闭守卫要据此决定是否关掉标签页）。
 * @param face - 状态容器与保存通道。
 * @param tabId - 标签页 id。
 * @param options - `force` 为真时跳过版本守卫，用于用户明确选择覆盖。
 * @returns 保存结果。
 */
export async function saveTab(
  face: SaveFace,
  tabId: string,
  options: { readonly force?: boolean } = {},
): Promise<SaveOutcome> {
  const { sessions } = face
  const current = sessions.stateOf(tabId)
  const view = sessions.viewOf(tabId)
  const model = view?.model
  if (current === undefined || view === undefined || model === undefined) {
    // 没有模型的标签页不该走到保存：说明调用方给了错误的身份。
    face.logger.warn('dsh-monaco: 标签页 %s 没有可保存的编辑器内容', tabId)
    return { status: 'failed' }
  }
  if (current.saving) return { status: 'busy' }
  if (!current.dirty) return { status: 'clean' }

  sessions.beginSave(tabId)
  const request: SaveFileRequest = {
    protocol: MONACO_SAVE_PROTOCOL,
    sessionId: view.sessionId,
    path: current.path,
    text: model.getValue(),
    ...(options.force === true || current.version === undefined ? {} : { expectedVersion: current.version }),
  }
  const result = await face.saveDocument(request)
  if (result.ok) {
    sessions.saved(tabId, result.version)
    return { status: 'saved', version: result.version }
  }
  if (result.code === 'stale-version') {
    // 界面上给用户一句固定文案（它能被翻译），服务端的细节只进日志。
    face.logger.warn('dsh-monaco: 保存 "%s" 被版本守卫拒绝：%s', current.path, result.message)
    sessions.conflict(tabId, face.t('conflict.save'))
    return { status: 'failed' }
  }
  face.logger.warn('dsh-monaco: 保存 "%s" 失败（%s）：%s', current.path, result.code, result.message)
  sessions.saveFailed(tabId, result.message)
  return { status: 'failed' }
}
