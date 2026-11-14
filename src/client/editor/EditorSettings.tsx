/**
 * 编辑器设置面板。
 *
 * 状态栏左侧的按钮开合它；面板浮在按钮上方，点击外部或按 Esc 关闭。
 * 设置是全局的（同一浏览器里所有编辑器共享），所以面板不绑定任何标签页。
 * @module dsh-monaco/client/editor/EditorSettings
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useEditorSettings } from './settings.ts'
import type { EditorSettingsStore } from './settings.ts'
import type { Translate } from '../types.ts'

/** 设置面板需要的插件能力。 */
export interface EditorSettingsFace {
  readonly settings: EditorSettingsStore
  readonly t: Translate
}

/**
 * 生成设置按钮与面板。
 * @param face - 设置容器与文案。
 * @returns 状态栏里的一个设置入口。
 */
export function createSettingsControl(face: EditorSettingsFace): () => ReactNode {
  const { settings, t } = face
  return function SettingsControl(): ReactNode {
    const value = useEditorSettings(settings)
    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const buttonRef = useRef<HTMLButtonElement | null>(null)
    const checkboxRef = useRef<HTMLInputElement | null>(null)

    const close = useCallback((restoreFocus: boolean): void => {
      setOpen(false)
      if (restoreFocus) buttonRef.current?.focus()
    }, [])

    // 打开后把焦点送进面板，键盘用户不必再按一次 Tab 才能到开关上。
    useEffect(() => {
      if (open) checkboxRef.current?.focus()
    }, [open])

    // 点击面板与按钮之外的地方收起。
    useEffect(() => {
      if (!open) return
      const onPointerDown = (event: MouseEvent): void => {
        const target = event.target
        if (!(target instanceof Node)) return
        if (rootRef.current?.contains(target) === true) return
        setOpen(false)
      }
      // 捕获阶段：先一步收起，页面上的其他控件照常收到这次点击。
      document.addEventListener('mousedown', onPointerDown, true)
      return () => { document.removeEventListener('mousedown', onPointerDown, true) }
    }, [open])

    // Esc 收起并把焦点还给按钮。
    useEffect(() => {
      if (!open) return
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        close(true)
      }
      document.addEventListener('keydown', onKeyDown, true)
      return () => { document.removeEventListener('keydown', onKeyDown, true) }
    }, [close, open])

    return (
      <div className="dsh-monaco-settings" ref={rootRef} data-dsh-monaco-settings>
        <button
          type="button"
          className="dsh-monaco-settings-trigger"
          ref={buttonRef}
          title={t('settings.open')}
          aria-label={t('settings.open')}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-active={open ? 'true' : 'false'}
          onClick={() => { setOpen(current => !current) }}
        >
          <GearGlyph />
        </button>
        {open
          ? (
            <div className="dsh-monaco-settings-panel" role="dialog" aria-label={t('settings.title')}>
              <div className="dsh-monaco-settings-title">{t('settings.title')}</div>
              <label className="dsh-monaco-settings-row">
                <input
                  type="checkbox"
                  ref={checkboxRef}
                  checked={value.wordWrap}
                  onChange={event => { settings.update({ wordWrap: event.target.checked }) }}
                  data-dsh-monaco-setting="wordWrap"
                />
                <span className="dsh-monaco-settings-label">{t('settings.wordWrap')}</span>
              </label>
              <div className="dsh-monaco-settings-hint">{t('settings.wordWrapHint')}</div>
            </div>
          )
          : null}
      </div>
    )
  }
}

/** 齿轮图标。 */
function GearGlyph(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M13.1 9.6a1.1 1.1 0 0 0 .22 1.21l.04.04a1.33 1.33 0 1 1-1.88 1.88l-.04-.04a1.1 1.1 0 0 0-1.21-.22 1.1 1.1 0 0 0-.67 1v.11a1.33 1.33 0 1 1-2.67 0v-.06a1.1 1.1 0 0 0-.72-1 1.1 1.1 0 0 0-1.21.22l-.04.04a1.33 1.33 0 1 1-1.88-1.88l.04-.04a1.1 1.1 0 0 0 .22-1.21 1.1 1.1 0 0 0-1-.67h-.11a1.33 1.33 0 1 1 0-2.67h.06a1.1 1.1 0 0 0 1-.72 1.1 1.1 0 0 0-.22-1.21l-.04-.04a1.33 1.33 0 1 1 1.88-1.88l.04.04a1.1 1.1 0 0 0 1.21.22h.05a1.1 1.1 0 0 0 .67-1v-.11a1.33 1.33 0 1 1 2.67 0v.06a1.1 1.1 0 0 0 .67 1 1.1 1.1 0 0 0 1.21-.22l.04-.04a1.33 1.33 0 1 1 1.88 1.88l-.04.04a1.1 1.1 0 0 0-.22 1.21v.05a1.1 1.1 0 0 0 1 .67h.11a1.33 1.33 0 1 1 0 2.67h-.06a1.1 1.1 0 0 0-1 .67Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
