/**
 * 编辑器设置：全局共享、跨标签页生效，并保存在浏览器本地。
 *
 * 「全局」指同一浏览器里的所有编辑器实例读同一份设置，改动立即推给已经打开的编辑器；
 * 设置本身写进 `localStorage`，刷新页面后仍然有效。
 * @module dsh-monaco/client/editor/settings
 */
import { useCallback, useSyncExternalStore } from 'react'

/** 设置项。 */
export interface EditorSettings {
  /**
   * 自动换行：长行折行而不是横向滚动。
   *
   * 它是**默认值**：预览工具栏上的换行按钮仍然可以单独改变某个标签页，
   * 两者同时存在时以工具栏为准（见 `EditorBody` 里的覆盖逻辑）。
   */
  readonly wordWrap: boolean
}

/** 缺省设置：与平台文本预览的默认一致（默认开启换行）。 */
export const DEFAULT_SETTINGS: EditorSettings = {
  wordWrap: true,
}

/** 本地存储键。 */
const STORAGE_KEY = 'dsh-monaco/editor-settings'

/** 记录日志的最小接口。 */
interface Logger {
  warn(format: unknown, ...params: unknown[]): void
}

/** 校验并补齐一份来自存储或外部的设置。 */
function normalize(value: unknown, logger: Logger): EditorSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    logger.warn('dsh-monaco: 编辑器设置的存储内容不是 JSON 对象（%s），已回退到默认值', String(value))
    return DEFAULT_SETTINGS
  }
  const record = value as Record<string, unknown>
  const wordWrap = record.wordWrap
  if (wordWrap !== undefined && typeof wordWrap !== 'boolean') {
    logger.warn('dsh-monaco: 设置项 wordWrap 的值 %s 不是布尔值，已忽略', String(wordWrap))
  }
  return {
    wordWrap: typeof wordWrap === 'boolean' ? wordWrap : DEFAULT_SETTINGS.wordWrap,
  }
}

/** 两份设置是否等价。 */
function sameSettings(left: EditorSettings, right: EditorSettings): boolean {
  return left.wordWrap === right.wordWrap
}

/** 全局编辑器设置容器。 */
export class EditorSettingsStore {
  private readonly logger: Logger
  private readonly listeners = new Set<() => void>()
  private current: EditorSettings

  /**
   * @param logger - 读取或写入失败时的记录点。
   */
  constructor(logger: Logger) {
    this.logger = logger
    this.current = this.read()
  }

  /** 从本地存储读出已保存的设置。 */
  private read(): EditorSettings {
    let raw: string | null
    try {
      raw = window.localStorage.getItem(STORAGE_KEY)
    } catch (error) {
      // 隐私模式等场景下存储不可用：设置只在本次会话内有效，但必须让用户知道。
      this.logger.warn('dsh-monaco: 无法读取编辑器设置（%s），本次会话使用默认值',
        error instanceof Error ? error.message : String(error))
      return DEFAULT_SETTINGS
    }
    return raw === null ? DEFAULT_SETTINGS : this.parse(raw)
  }

  /** 订阅设置变化。 */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 当前设置。 */
  readonly getSnapshot = (): EditorSettings => this.current

  /**
   * 修改设置并持久化。
   * @param patch - 要改的项。
   */
  update(patch: Partial<EditorSettings>): void {
    const next = normalize({ ...this.current, ...patch }, this.logger)
    if (sameSettings(next, this.current)) return
    this.current = next
    this.persist(next)
    for (const listener of this.listeners) listener()
  }

  /**
   * 跟随其它窗口的改动。
   *
   * `localStorage` 的 `storage` 事件只在**别的**窗口写入时触发，正好用来让多个页面保持一致。
   * @returns 停止跟随。
   */
  watchOtherWindows(): () => void {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== STORAGE_KEY) return
      const next = event.newValue === null ? DEFAULT_SETTINGS : this.parse(event.newValue)
      if (sameSettings(next, this.current)) return
      this.current = next
      for (const listener of this.listeners) listener()
    }
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener('storage', onStorage) }
  }

  private persist(settings: EditorSettings): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (error) {
      // 写不进去就只在本次会话生效；界面照常反映改动，但日志必须留下原因。
      this.logger.warn('dsh-monaco: 无法保存编辑器设置（%s），改动只在本次会话有效',
        error instanceof Error ? error.message : String(error))
    }
  }

  private parse(raw: string): EditorSettings {
    try {
      return normalize(JSON.parse(raw), this.logger)
    } catch (error) {
      this.logger.warn('dsh-monaco: 编辑器设置的存储内容无法解析（%s），已回退到默认值',
        error instanceof Error ? error.message : String(error))
      return DEFAULT_SETTINGS
    }
  }
}

/**
 * 在组件里订阅设置。
 * @param store - 设置容器。
 * @returns 当前设置。
 */
export function useEditorSettings(store: EditorSettingsStore): EditorSettings {
  const get = useCallback(() => store.getSnapshot(), [store])
  return useSyncExternalStore(store.subscribe, get, get)
}
