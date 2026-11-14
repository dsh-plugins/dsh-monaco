/**
 * dsh-monaco 宿主端入口。
 *
 * 浏览器里的编辑器需要两样宿主能力：
 * 1. `min/vs` 静态资源（编辑器脚本、语言包、四个语言 Worker）——由 {@link registerAssetRoute} 提供；
 * 2. 一处可写的文件端点——平台的文件远程服务是只读的，由 {@link registerWriteRoute} 补上。
 *
 * 编辑器本体、文档接管与扩展接口都在浏览器端（见 `src/client`）。
 * @module dsh-monaco
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Config as ConfigShape } from './config.ts'
import { monacoVsRoot } from './monaco-assets.ts'
import { registerAssetRoute } from './routes/vs-assets.ts'
import { registerWriteRoute } from './routes/write.ts'
import type { HostServices, IndexInjectionRow } from './host-types.ts'
import { CLIENT_CONFIG_GLOBAL } from './shared/client-config.ts'

export { Config } from './config.ts'
export type { Config as MonacoConfig, EditorDefaults } from './config.ts'

/** 与 package.json 的 `name` 一致。 */
export const name = '@dsh-plugin/dsh-monaco'

/** 所需宿主服务：HTTP 载体、组合文件系统、会话存储与沙箱策略。 */
export const inject = ['webServer', 'fs', 'sessions', 'sandboxPolicy', 'connection']

/**
 * 挂载宿主侧能力。
 * @param ctx - 宿主上下文。
 * @param config - 编辑器默认值、扩展名补充与读写边界。
 */
export function apply(ctx: Context, config: ConfigShape): void {
  // 平台服务签名不在本包的类型面里，这里做一次窄化转换；用到的成员在 host-types.ts 中逐一列出。
  const services = ctx as unknown as HostServices
  const vsRoot = monacoVsRoot(import.meta.url)
  services.logger.info('dsh-monaco: Monaco 资源目录 %s', vsRoot)

  ctx.effect(() => {
    const disposeAssets = registerAssetRoute(services, vsRoot, config.assetCacheSeconds)
    const disposeWrite = registerWriteRoute(services, config.maxWriteBytes)
    return () => {
      disposeWrite()
      disposeAssets()
    }
  }, 'dsh-monaco: web routes')

  ctx.effect(() => services.on('webserver/index-inject', (table: IndexInjectionRow[]) => {
    table.push({
      kind: 'global',
      name: CLIENT_CONFIG_GLOBAL,
      value: { editor: config.editor, extensions: config.extensions },
    })
  }), 'dsh-monaco: client config')
}
