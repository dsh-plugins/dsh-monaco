/**
 * 关闭标签页时的未保存确认框。
 *
 * 挂在 `shell.overlay`（整帧浮层）里，没有待确认的关闭时渲染 `null`。
 * 交互与 VS Code 对齐：Esc 取消，Enter 保存，默认焦点在「保存」上。
 * @module dsh-monaco/client/editor/CloseConfirm
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { CloseChoice, CloseGuard } from './close-guard.ts'
import type { Translate } from '../types.ts'

/** 确认框需要的插件能力。 */
export interface CloseConfirmFace {
  readonly guard: CloseGuard
  readonly t: Translate
}

/**
 * 生成确认框组件。
 * @param face - 守卫与文案。
 * @returns 可注册到 `shell.overlay` 的组件。
 */
export function createCloseConfirm(face: CloseConfirmFace): () => ReactNode {
  const { guard, t } = face
  return function CloseConfirm(): ReactNode {
    const request = useSyncExternalStore(guard.subscribe, guard.snapshot, guard.snapshot)
    const saveRef = useRef<HTMLButtonElement | null>(null)
    const cardRef = useRef<HTMLDivElement | null>(null)
    const open = request !== undefined
    const busy = request?.busy === true

    const choose = useCallback((choice: CloseChoice): void => { guard.resolve(choice) }, [])

    // 打开时把焦点放到「保存」上，收起时还给原来的元素。
    useEffect(() => {
      if (!open) return
      const previous = document.activeElement
      saveRef.current?.focus()
      return () => {
        if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
      }
    }, [open])

    // 焦点圈在确认框内：Tab 不会跑到遮罩后面的页面元素上。
    useEffect(() => {
      if (!open) return
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Tab') return
        const buttons = [...(cardRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        if (buttons.length === 0) return
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (first === undefined || last === undefined) return
        const active = document.activeElement
        if (event.shiftKey && active === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
      }
      document.addEventListener('keydown', onKeyDown, true)
      return () => { document.removeEventListener('keydown', onKeyDown, true) }
    }, [open])

    // Esc 取消、Enter 保存：只在确认框存在时接管，其余按键原样交给页面。
    useEffect(() => {
      if (!open) return
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          choose('cancel')
          return
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const target = event.target
          // 焦点在按钮上时交给按钮自己处理，避免一次回车触发两次选择。
          if (target instanceof HTMLElement && target.closest('button') !== null) return
          if (busy) return
          event.preventDefault()
          event.stopPropagation()
          choose('save')
        }
      }
      // 捕获阶段先于页面快捷键（空格、方向键等）拿到按键。
      document.addEventListener('keydown', onKeyDown, true)
      return () => { document.removeEventListener('keydown', onKeyDown, true) }
    }, [busy, choose, open])

    if (request === undefined) return null
    return (
      <div className="dsh-monaco-confirm" data-dsh-monaco-close-confirm>
        <div
          className="dsh-monaco-confirm-scrim"
          onClick={() => { if (!busy) choose('cancel') }}
        />
        <div
          className="dsh-monaco-confirm-card"
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dsh-monaco-confirm-title"
          aria-describedby="dsh-monaco-confirm-body"
        >
          <div className="dsh-monaco-confirm-title" id="dsh-monaco-confirm-title">
            {t('confirm.title', { name: request.name })}
          </div>
          <div className="dsh-monaco-confirm-body" id="dsh-monaco-confirm-body">
            {t('confirm.body')}
          </div>
          {request.failure === undefined
            ? null
            : <div className="dsh-monaco-confirm-failure" data-dsh-monaco-confirm-failure>{request.failure}</div>}
          <div className="dsh-monaco-confirm-actions">
            <button
              type="button"
              className="dsh-monaco-confirm-button"
              data-variant="primary"
              ref={saveRef}
              disabled={busy}
              onClick={() => { choose('save') }}
            >
              {busy ? t('confirm.saving') : t('confirm.save')}
            </button>
            <button
              type="button"
              className="dsh-monaco-confirm-button"
              disabled={busy}
              onClick={() => { choose('discard') }}
            >
              {t('confirm.discard')}
            </button>
            <button
              type="button"
              className="dsh-monaco-confirm-button"
              disabled={busy}
              onClick={() => { choose('cancel') }}
            >
              {t('confirm.cancel')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
