/**
 * 关闭标签页时的未保存确认。
 *
 * 平台的关闭链路是同步的：`sidebarRight.close(tabId)` → 关闭钩子 → `commit()` 移除标签页。
 * 钩子只有两种结局——正常返回则继续关闭，抛错则保留标签页（平台文档写明
 * 「Failure preserves the tab」，标签芯片路径上平台自己捕获并记录该异常）。
 * 因此「弹出确认框」的实现是：钩子抛出 {@link TabCloseVeto} 中止这次关闭，
 * 用户选择后再由守卫发起一次被放行的关闭。
 *
 * 放行只在一次同步调用内有效，避免标志残留导致下一次关闭跳过确认。
 * @module dsh-monaco/client/editor/close-guard
 */
import type { Translate } from '../types.ts'
import type { EditorSessions } from './sessions.ts'
import type { SaveOutcome } from './saver.ts'

/** 用户在确认框里的选择。 */
export type CloseChoice = 'save' | 'discard' | 'cancel'

/** 一次待确认的关闭。 */
export interface CloseConfirm {
  /** 要关闭的标签页。 */
  readonly tabId: string
  /** 标签页所属会话：关闭必须在同一个会话里发起。 */
  readonly sessionId: string
  /** 展示用的文件名（路径最后一段）。 */
  readonly name: string
  /** 正在执行用户选的「保存」。 */
  readonly busy: boolean
  /** 保存失败的原因，需留在确认框里让用户重选。 */
  readonly failure: string | undefined
}

/** 守卫需要的插件能力。 */
export interface CloseGuardFace {
  readonly sessions: EditorSessions
  readonly save: (tabId: string) => Promise<SaveOutcome>
  readonly close: (sessionId: string, tabId: string) => void
  /** 当前屏幕上挂载的会话；与请求不一致时说明标签页已经不在原会话里。 */
  readonly mountedSession: () => string | undefined
  readonly logger: { warn(format: unknown, ...params: unknown[]): void }
  readonly t: Translate
}

/** 取消一次关闭的信号：平台看到钩子抛错就保留标签页。 */
export class TabCloseVeto extends Error {
  /** 被拦下的标签页。 */
  readonly tabId: string

  /**
   * @param tabId - 被拦下的标签页。
   */
  constructor(tabId: string) {
    super(`dsh-monaco: closing tab ${tabId} was vetoed to confirm unsaved changes`)
    this.name = 'TabCloseVeto'
    this.tabId = tabId
  }
}

/**
 * 取路径的最后一段，用作确认框里的文件名。
 * @param path - 宿主绝对路径（可能用 `\` 或 `/`）。
 * @returns 文件名；路径以分隔符结尾时返回整段路径。
 */
export function fileNameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const name = cut === -1 ? path : path.slice(cut + 1)
  return name.length === 0 ? path : name
}

/** 未保存关闭的守卫与确认框状态。 */
export class CloseGuard {
  private readonly face: CloseGuardFace
  private readonly listeners = new Set<() => void>()
  private request: CloseConfirm | undefined
  private allowed: string | undefined
  private saving = false

  /**
   * @param face - 状态容器、保存通道与真正的关闭动作。
   */
  constructor(face: CloseGuardFace) {
    this.face = face
  }

  /** 订阅确认框状态。 */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 当前待确认的关闭。 */
  readonly snapshot = (): CloseConfirm | undefined => this.request

  /**
   * 判断一次关闭是否需要拦下来确认。
   * @param tabId - 即将关闭的标签页。
   * @param sessionId - 关闭动作所属的会话；缺省时用屏幕上挂载的会话。
   * @returns `true` 表示已接管（调用方必须中止这次关闭）。
   */
  intercept(tabId: string, sessionId?: string): boolean {
    // 守卫自己发起的关闭：这一次必须直接通过。
    if (this.allowed === tabId) return false
    const state = this.face.sessions.stateOf(tabId)
    if (state === undefined || !state.dirty) return false
    if (this.request?.tabId === tabId) return true
    const owner = sessionId ?? this.face.mountedSession()
    if (owner === undefined) {
      // 没有会话身份就无法安全地重放关闭；说明情况并保留标签页，不静默丢弃用户改动。
      this.face.logger.warn('dsh-monaco: 标签页 %s 有未保存改动，但当前没有可用会话，关闭已中止', tabId)
      return true
    }
    this.publish({ tabId, sessionId: owner, name: fileNameOf(state.path), busy: false, failure: undefined })
    return true
  }

  /**
   * 处理用户的选择。
   * @param choice - 保存、不保存或取消。
   */
  resolve(choice: CloseChoice): void {
    const request = this.request
    if (request === undefined || this.saving) return
    if (choice === 'cancel') {
      this.publish(undefined)
      return
    }
    if (choice === 'discard') {
      this.publish(undefined)
      this.closeNow(request)
      return
    }
    this.saving = true
    this.publish({ ...request, busy: true, failure: undefined })
    void this.face.save(request.tabId).then((outcome) => {
      this.saving = false
      if (outcome.status === 'failed') {
        // 保存被拒或写入失败：留在确认框里，把原因交给用户，而不是丢掉他的内容。
        const message = this.face.sessions.stateOf(request.tabId)?.message
        this.publish({ ...request, busy: false, failure: message ?? this.face.t('confirm.saveFailed') })
        return
      }
      if (outcome.status === 'busy') {
        // 已有保存在飞：等它落地后再判断，而不是谎报一次失败。
        this.publish({ ...request, busy: true, failure: undefined })
        this.retryWhenIdle(request)
        return
      }
      this.publish(undefined)
      this.closeNow(request)
    }, (error: unknown) => {
      this.saving = false
      const message = error instanceof Error ? error.message : String(error)
      this.face.logger.warn('dsh-monaco: 关闭 "%s" 前保存失败：%s', request.name, message)
      this.publish({ ...request, busy: false, failure: this.face.t('confirm.saveFailed') })
    })
  }

  /**
   * 丢弃某个标签页的待确认状态。
   * @param tabId - 已消失的标签页。
   */
  forget(tabId: string): void {
    if (this.request?.tabId === tabId) this.publish(undefined)
  }

  /** 等飞在天上的保存结束后重试一次。 */
  private retryWhenIdle(request: CloseConfirm): void {
    const stop = this.face.sessions.subscribe(() => {
      if (this.request?.tabId !== request.tabId) {
        stop()
        return
      }
      if (this.face.sessions.stateOf(request.tabId)?.saving === true) return
      stop()
      this.saving = false
      this.resolve('save')
    })
  }

  /**
   * 放行一次关闭，并在这次同步调用结束后立刻收回放行。
   *
   * 关闭必须落在原来的会话里：平台在没有会话挂载时会抛错，落到别的会话上则会静默找不到标签页。
   */
  private closeNow(request: CloseConfirm): void {
    const mounted = this.face.mountedSession()
    if (mounted !== request.sessionId) {
      this.face.logger.warn('dsh-monaco: "%s" 所属会话已不在屏幕上（当前 %s），关闭被跳过',
        request.name, mounted ?? '无')
      return
    }
    this.allowed = request.tabId
    try {
      this.face.close(request.sessionId, request.tabId)
    } catch (error) {
      // 平台只在标签芯片路径上兜底；这里再包一层，避免异常冒到 React 事件处理器。
      const message = error instanceof Error ? error.message : String(error)
      this.face.logger.warn('dsh-monaco: 关闭 "%s" 失败：%s', request.name, message)
    } finally {
      this.allowed = undefined
    }
  }

  private publish(next: CloseConfirm | undefined): void {
    this.request = next
    for (const listener of this.listeners) listener()
  }
}
