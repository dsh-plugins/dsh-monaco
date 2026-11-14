/**
 * 编辑器默认值：宿主通过 `__DSH_MONACO_CONFIG__` 注入，浏览器端缺省值与宿主 Config 保持一致。
 * @module dsh-monaco/client/config
 */
import { CLIENT_CONFIG_GLOBAL } from '../shared/client-config.ts'

/** 编辑器外观与行为默认值。 */
export interface EditorDefaults {
  /** 字号（px）。 */
  readonly fontSize: number
  /** 一个缩进级别的空格/制表符数量。 */
  readonly tabSize: number
  /** 缩进使用空格。 */
  readonly insertSpaces: boolean
  /** 是否显示缩略图。 */
  readonly minimap: boolean
  /** 主题：`dsh` 跟随界面主题，或某个已注册主题的 id。 */
  readonly theme: string
}

/** 浏览器端的完整配置。 */
export interface ClientConfig {
  readonly editor: EditorDefaults
  /** 在默认代码扩展名之外，额外接管的文件扩展名。 */
  readonly extensions: readonly string[]
}

/** 缺省配置。 */
export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  editor: {
    fontSize: 12,
    tabSize: 2,
    insertSpaces: true,
    minimap: false,
    theme: 'dsh',
  },
  extensions: [],
}

/** Monaco 可以接受的界面主题选择：`dsh` 表示跟随界面主题。 */
export const FOLLOW_THEME_ID = 'dsh'

/**
 * 读取宿主注入的配置。
 * @param source - 承载注入值的全局对象。
 * @returns 与缺省值合并后的配置；注入值缺项时沿用缺省值。
 */
export function readClientConfig(source: { readonly [CLIENT_CONFIG_GLOBAL]?: unknown }): ClientConfig {
  const injected = source[CLIENT_CONFIG_GLOBAL]
  if (typeof injected !== 'object' || injected === null) return DEFAULT_CLIENT_CONFIG
  const value = injected as Partial<ClientConfig>
  const editor = typeof value.editor === 'object' && value.editor !== null ? value.editor : {}
  return {
    editor: { ...DEFAULT_CLIENT_CONFIG.editor, ...editor },
    extensions: Array.isArray(value.extensions) ? value.extensions : DEFAULT_CLIENT_CONFIG.extensions,
  }
}
