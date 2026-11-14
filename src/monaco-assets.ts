/**
 * 定位 Monaco 的 AMD 发行目录（`<package>/min/vs`）。
 *
 * 插件以 npm 依赖方式安装，`monaco-editor` 与它同处一个依赖树，因此按包的解析结果
 * 上溯到包根即可；找不到时抛错而不是静默降级——没有编辑器资源，插件等于没装。
 * @module dsh-monaco/monaco-assets
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

/** Monaco 发行目录相对包根的位置。 */
const VS_DIRECTORY = join('min', 'vs')

/** 判定目录是 Monaco 发行目录的锚点文件。 */
const VS_ANCHOR = join('editor', 'editor.main.js')

/**
 * 解析 `monaco-editor` 包的入口文件。
 * @param fromUrl - 调用方的模块 URL。
 * @returns 入口文件的绝对路径。
 * @throws 当依赖缺失或无法解析时抛出。
 */
function resolveMonacoEntry(fromUrl: string): string {
  const require = createRequire(fromUrl)
  try {
    return require.resolve('monaco-editor')
  } catch (error) {
    throw new Error(
      'dsh-monaco: cannot resolve the "monaco-editor" package; install it as a dependency of this plugin',
      { cause: error },
    )
  }
}

/**
 * 从入口文件上溯到包含 `min/vs` 的包根。
 * @param entry - 入口文件绝对路径。
 * @returns `min/vs` 目录的绝对路径。
 * @throws 当上溯不到 Monaco 发行目录时抛出。
 */
function locateVsRoot(entry: string): string {
  let current = dirname(entry)
  while (true) {
    const candidate = join(current, VS_DIRECTORY)
    if (existsSync(join(candidate, VS_ANCHOR))) return candidate
    const parent = dirname(current)
    if (parent === current) {
      throw new Error(`dsh-monaco: no ${VS_DIRECTORY} directory found above "${entry}"`)
    }
    current = parent
  }
}

/**
 * 取得 Monaco 资源根目录。
 * @param fromUrl - 本插件入口模块的 URL（`import.meta.url`）。
 * @returns `<package>/min/vs` 的绝对路径。
 */
export function monacoVsRoot(fromUrl: string): string {
  return locateVsRoot(resolveMonacoEntry(fromUrl))
}
