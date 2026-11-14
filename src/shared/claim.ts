/**
 * 本编辑器默认接管的文本/代码扩展名，以及外部插件追加扩展名后的归并规则。
 *
 * 文档预览注册表只按扩展名静态匹配，所以这份列表在浏览器端是注册与再注册的依据。
 * @module dsh-monaco/shared/claim
 */

/**
 * 默认接管的扩展名：能当纯文本编辑的常见源码、配置与文档格式。
 * 不含二进制格式；Markdown 也在其中，因为它首先是可编辑的文本，
 * 需要渲染时用户仍可在预览工具栏切回平台的 Markdown 渲染器。
 */
export const BASE_CODE_EXTENSIONS: readonly string[] = [
  'astro', 'bash', 'bat', 'c', 'cc', 'cfg', 'cjs', 'clj', 'cljs', 'cmake', 'cmd', 'coffee',
  'conf', 'cpp', 'cs', 'csh', 'css', 'csv', 'cxx', 'dart', 'diff', 'dockerfile', 'ejs', 'env',
  'ex', 'exs', 'fish', 'fs', 'fsi', 'fsx', 'gitattributes', 'gitignore', 'go', 'gradle', 'graphql',
  'groovy', 'gql', 'h', 'handlebars', 'hbs', 'hh', 'hpp', 'hrl', 'htm', 'html', 'hxx', 'ini',
  'java', 'jl', 'js', 'json', 'json5', 'jsonc', 'jsx', 'kt', 'kts', 'less', 'lua', 'm', 'make',
  'markdown', 'md', 'mdx', 'mjs', 'mk', 'mm', 'mts', 'cts', 'mustache', 'nim', 'patch', 'php',
  'pl', 'properties', 'proto', 'ps1', 'psd1', 'psm1', 'py', 'pyi', 'r', 'rb', 'rs', 'rst', 'sass',
  'scala', 'scss', 'sh', 'sql', 'svelte', 'swift', 'toml', 'ts', 'tsv', 'tsx', 'txt', 'vb', 'vue',
  'xml', 'xsl', 'yaml', 'yml', 'zig', 'zsh',
]

/**
 * 规范化一个声明的扩展名。
 * @param extension - 声明值，可带前导点。
 * @returns 小写、去点后的扩展名。
 * @throws 当声明为空、含路径分隔符或 NUL 时抛出，说明这条声明本身不成立。
 */
export function normalizeExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase().replace(/^\.+/u, '')
  if (normalized.length === 0) throw new Error('dsh-monaco: empty file extension')
  if (normalized.includes('/') || normalized.includes('\\') || normalized.includes('\u0000')) {
    throw new Error(`dsh-monaco: invalid file extension "${extension}"`)
  }
  return normalized
}

/**
 * 合并默认扩展名与外部插件追加的扩展名。
 * @param base - 默认列表。
 * @param extra - 追加列表，允许重复。
 * @returns 去重、按字典序排列的扩展名列表。
 */
export function claimedExtensions(base: readonly string[], extra: readonly string[]): readonly string[] {
  const merged = new Set<string>()
  for (const extension of [...base, ...extra]) merged.add(normalizeExtension(extension))
  return [...merged].sort()
}
