/**
 * 界面语言到 Monaco 内置消息包语言的映射。
 *
 * Monaco 的 AMD 包用 `require.config({ config: { 'vs/nls': { availableLanguages } } })`
 * 选择消息包，语言标识只有固定的十几个。
 * @module dsh-monaco/shared/locale
 */

/** Monaco 消息包支持的语言标识。 */
export const MONACO_NLS_LOCALES: readonly string[] = [
  'cs', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-br', 'ru', 'tr', 'zh-cn', 'zh-tw',
]

/**
 * 把 DSH 的界面语言映射成 Monaco 消息包语言。
 * @param localeId - 平台语言标识，如 `zh`、`zh-CN`、`en`。
 * @returns Monaco 语言标识；英语沿用 Monaco 的默认消息，返回 `undefined`。
 */
export function monacoLocaleFor(localeId: string): string | undefined {
  const normalized = localeId.trim().toLowerCase().replace(/_/gu, '-')
  if (normalized.length === 0 || normalized === 'en' || normalized.startsWith('en-')) return undefined
  if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-hans' || normalized.startsWith('zh-hans-')) return 'zh-cn'
  if (normalized === 'zh-tw' || normalized === 'zh-hant' || normalized.startsWith('zh-hant-')) return 'zh-tw'
  if (normalized.startsWith('pt')) return 'pt-br'
  const language = normalized.split('-', 1)[0] ?? ''
  return MONACO_NLS_LOCALES.includes(language) ? language : undefined
}
