/**
 * 文件路径到 Monaco 语言的匹配。
 *
 * Monaco 自带语言都以 `extensions` / `filenames` / `filenamePatterns` 声明适用文件；
 * 外部插件注册的语言同样进入这份描述表，并且排在 Monaco 自带语言之前，
 * 因此同名扩展名以插件声明为准。
 * @module dsh-monaco/shared/language
 */

/** 一种语言的适用文件描述，字段含义与 Monaco 的 `ILanguageExtensionPoint` 一致。 */
export interface LanguageDescriptor {
  /** 语言标识，如 `typescript`。 */
  readonly id: string
  /** 带前导点的扩展名，如 `.ts`。 */
  readonly extensions?: readonly string[]
  /** 完整文件名，如 `Dockerfile`（大小写不敏感）。 */
  readonly filenames?: readonly string[]
  /** 文件名的正则表达式，用于无法用扩展名表达的命名约定。 */
  readonly filenamePatterns?: readonly string[]
}

/** 路径的最后一段，统一按 `/` 切分。 */
function basenameOf(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

/**
 * 按描述表为一个路径挑选语言。
 * @param descriptors - 语言描述表，越靠前优先级越高（同一扩展名长度时先到先得）。
 * @param path - 文件路径，允许 Windows 分隔符。
 * @returns 匹配到的语言标识，或 `undefined` 表示按纯文本处理。
 */
export function languageForPath(descriptors: readonly LanguageDescriptor[], path: string): string | undefined {
  const name = basenameOf(path).toLowerCase()
  if (name.length === 0) return undefined
  for (const descriptor of descriptors) {
    if (descriptor.filenames?.some(filename => filename.toLowerCase() === name) === true) return descriptor.id
  }
  let best: { readonly id: string; readonly length: number } | undefined
  for (const descriptor of descriptors) {
    for (const extension of descriptor.extensions ?? []) {
      const suffix = extension.toLowerCase()
      if (!suffix.startsWith('.')) continue
      if (!name.endsWith(suffix)) continue
      if (best === undefined || suffix.length > best.length) best = { id: descriptor.id, length: suffix.length }
    }
  }
  if (best !== undefined) return best.id
  for (const descriptor of descriptors) {
    for (const pattern of descriptor.filenamePatterns ?? []) {
      if (new RegExp(pattern, 'u').test(name)) return descriptor.id
    }
  }
  return undefined
}
