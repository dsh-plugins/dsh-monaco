/**
 * 宿主侧配置：编辑器默认值、额外接管扩展名、写入与静态资源的边界。
 * @module dsh-monaco/config
 */
import z from '@deepseek-ai/schemastery'

/** 编辑器默认外观与行为；浏览器端可被同名全局注入覆盖。 */
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

/** 插件配置。 */
export interface Config {
  /** 编辑器默认值。 */
  readonly editor: EditorDefaults
  /** 在默认代码扩展名之外，额外接管的文件扩展名（可带前导点）。 */
  readonly extensions: string[]
  /** 单次保存允许的最大文本字节数；超过即拒绝，不做截断。 */
  readonly maxWriteBytes: number
  /** Monaco 静态资源在浏览器里的缓存秒数。 */
  readonly assetCacheSeconds: number
}

/** 配置校验：缺省项由这里补齐，浏览器端读到的永远是完整值。 */
export const Config: z<Config> = z.object({
  editor: z.object({
    fontSize: z.number().step(1).min(8).max(32).default(12),
    tabSize: z.number().step(1).min(1).max(8).default(2),
    insertSpaces: z.boolean().default(true),
    minimap: z.boolean().default(false),
    theme: z.string().default('dsh'),
  }),
  extensions: z.array(z.string()).default([]),
  maxWriteBytes: z.number().step(1).min(1).default(8 * 1024 * 1024),
  assetCacheSeconds: z.number().step(1).min(0).default(86400),
})
