/**
 * 外部插件用来扩展编辑器的注册表：语言（含高亮规则与分词器）、语义着色、主题、命令、动作与文件扩展名。
 *
 * 注册表只管数据与通知；真正写进 Monaco 的时机由插件主体在 Monaco 就绪后调用
 * {@link MonacoExtensionRegistry.syncInto} 决定，编辑器实例创建时再取命令与动作。
 * @module dsh-monaco/client/monaco/registry
 */
import type { LanguageDescriptor } from '../../shared/language.ts'
import { claimedExtensions, normalizeExtension } from '../../shared/claim.ts'
import type * as Monaco from 'monaco-editor'
import type { MonacoApi } from '../types.ts'
import type {
  ActionContribution,
  CommandContribution,
  LanguageContribution,
  SemanticTokensContribution,
  ThemeContribution,
} from '../types.ts'
import { themeDefinitionOf, type RegisteredTheme } from './theme.ts'

/** 注册表的只读快照。 */
export interface RegistrySnapshot {
  readonly revision: number
  readonly languages: readonly LanguageContribution[]
  readonly themes: readonly ThemeContribution[]
  readonly commands: readonly CommandContribution[]
  readonly actions: readonly ActionContribution[]
  /** 由外部插件追加、已归并进文档接管范围的扩展名。 */
  readonly extensions: readonly string[]
}

/** 注册表写日志用的最小接口。 */
export interface RegistryLogger {
  warn(format: unknown, ...params: unknown[]): void
}

/**
 * 基础主题对应的界面配色方案。
 * @param base - Monaco 内置主题名。
 * @returns 派生该主题所用规则的配色方案。
 */
function schemeOf(base: ThemeContribution['base']): 'light' | 'dark' {
  return base === 'vs' || base === 'hc-light' ? 'light' : 'dark'
}

/**
 * 校验一条语言贡献。
 * @param contribution - 待注册的语言。
 * @throws 当标识为空、文件名正则无法编译，或同时声明两套分词器时抛出。
 */
function validateLanguage(contribution: LanguageContribution): void {
  if (contribution.id.trim().length === 0) throw new Error('dsh-monaco: language id must not be empty')
  if (contribution.tokens !== undefined && contribution.tokensProvider !== undefined) {
    throw new Error(`dsh-monaco: language "${contribution.id}" declares both tokens and tokensProvider`)
  }
  for (const pattern of contribution.filenamePatterns ?? []) {
    // 尽早编译一次，非法正则在这里就暴露，而不是等到渲染文件时抛错。
    new RegExp(pattern, 'u')
  }
  for (const extension of contribution.extensions ?? []) normalizeExtension(extension)
}

/**
 * 校验一条动作或命令。
 * @param contribution - 待注册的条目。
 * @throws 当标识或标题为空时抛出。
 */
function validateEntry(contribution: { readonly id: string; readonly label: string }): void {
  if (contribution.id.trim().length === 0) throw new Error('dsh-monaco: entry id must not be empty')
  if (contribution.label.trim().length === 0) throw new Error(`dsh-monaco: entry "${contribution.id}" must have a label`)
}

/**
 * 把一个已注册主题写进 Monaco，并合入该基础主题配色方案下的语义着色规则。
 *
 * 注册主题同样需要这些规则：切换到这个主题后，语义 token 没有对应规则就会落到正文色，
 * 与跟随界面主题时的表现不一致。
 * @param api - Monaco 命名空间。
 * @param logger - 主题定义被拒绝时的记录出口。
 * @param contribution - 主题贡献。
 * @param tokenRules - 该配色方案下的语义着色规则。
 */
function defineRegisteredTheme(
  api: MonacoApi,
  logger: RegistryLogger,
  contribution: ThemeContribution,
  tokenRules: readonly Monaco.editor.ITokenThemeRule[],
): void {
  const theme: RegisteredTheme = {
    id: contribution.id,
    label: contribution.label ?? contribution.id,
    base: contribution.base,
    inherit: contribution.inherit ?? true,
    rules: [...(contribution.rules ?? []), ...tokenRules],
    colors: contribution.colors ?? {},
  }
  try {
    api.editor.defineTheme(contribution.id, themeDefinitionOf(theme))
  } catch (error) {
    logger.warn('dsh-monaco: 主题 "%s" 定义失败：%s', contribution.id,
      error instanceof Error ? error.message : String(error))
  }
}

/** 扩展注册表。 */
export class MonacoExtensionRegistry {
  private readonly languageMap = new Map<string, LanguageContribution>()
  private readonly themeMap = new Map<string, ThemeContribution>()
  private readonly commandMap = new Map<string, CommandContribution>()
  private readonly actionMap = new Map<string, ActionContribution>()
  /** 语义着色贡献：贡献标识到贡献的映射。同一标识重复注册覆盖旧条目。 */
  private readonly semanticMap = new Map<string, SemanticTokensContribution>()
  /** 已写进 Monaco 的语义着色注册：贡献标识到撤销函数。 */
  private readonly semanticRegistrations = new Map<string, () => void>()
  private readonly extraExtensions = new Map<string, number>()
  private readonly listeners = new Set<() => void>()
  /** 已把 loader 跑完的语言贡献，避免重复执行同一份加载逻辑。 */
  private readonly loadedLanguages = new Map<string, LanguageContribution>()
  private revision = 0
  private disposed = false
  private snapshot: RegistrySnapshot = {
    revision: 0, languages: [], themes: [], commands: [], actions: [], extensions: [],
  }
  private syncChain: Promise<void> = Promise.resolve()

  /** @param logger - 同步进 Monaco 失败的记录出口。 */
  constructor(private readonly logger: RegistryLogger) {}

  /**
   * 注册一种语言。
   * @param contribution - 语言描述、可选加载器、Monarch 规则与语言配置。
   * @returns 撤销注册；同名语言再次注册时以后来的为准。
   */
  registerLanguage(contribution: LanguageContribution): () => void {
    validateLanguage(contribution)
    this.languageMap.set(contribution.id, contribution)
    this.bump()
    return () => {
      if (this.languageMap.get(contribution.id) !== contribution) return
      this.languageMap.delete(contribution.id)
      this.bump()
    }
  }

  /**
   * 注册一个主题。
   * @param contribution - 基础主题与覆盖项。
   * @returns 撤销注册。
   */
  registerTheme(contribution: ThemeContribution): () => void {
    if (contribution.id.trim().length === 0) throw new Error('dsh-monaco: theme id must not be empty')
    this.themeMap.set(contribution.id, contribution)
    this.bump()
    return () => {
      if (this.themeMap.get(contribution.id) !== contribution) return
      this.themeMap.delete(contribution.id)
      this.bump()
    }
  }

  /**
   * 注册一个命令。
   * @param contribution - 标识、标题、快捷键与执行体。
   * @returns 撤销注册。
   */
  registerCommand(contribution: CommandContribution): () => void {
    validateEntry(contribution)
    this.commandMap.set(contribution.id, contribution)
    this.bump()
    return () => {
      if (this.commandMap.get(contribution.id) !== contribution) return
      this.commandMap.delete(contribution.id)
      this.bump()
    }
  }

  /**
   * 注册一个动作。
   * @param contribution - 标识、标题、快捷键、前置条件与执行体。
   * @returns 撤销注册。
   */
  registerAction(contribution: ActionContribution): () => void {
    validateEntry(contribution)
    this.actionMap.set(contribution.id, contribution)
    this.bump()
    return () => {
      if (this.actionMap.get(contribution.id) !== contribution) return
      this.actionMap.delete(contribution.id)
      this.bump()
    }
  }

  /**
   * 为一种或多种语言注册语义着色。
   *
   * 提供者按语言选择器注册进 Monaco；同一标识再次注册会先撤销上一次的 Monaco 注册，
   * 因此热重载不会留下两份互相竞争的提供者。
   * @param contribution - 语言选择器、提供者与两套词法配色。
   * @returns 撤销注册。
   */
  registerSemanticTokens(contribution: SemanticTokensContribution): () => void {
    if (this.disposed) throw new Error('dsh-monaco: the extension registry has been disposed')
    if (contribution.id.trim().length === 0) throw new Error('dsh-monaco: semantic tokens id must not be empty')
    const selector = contribution.language
    const empty = typeof selector === 'string'
      ? selector.trim().length === 0
      : Array.isArray(selector)
        ? selector.length === 0
        : ((selector as Monaco.languages.LanguageFilter).language ?? '').trim().length === 0
          && (selector as Monaco.languages.LanguageFilter).pattern === undefined
    if (empty) throw new Error(`dsh-monaco: semantic tokens "${contribution.id}" must name a language`)
    for (const other of this.semanticMap.values()) {
      if (other.id === contribution.id) continue
      if (JSON.stringify(other.language) !== JSON.stringify(contribution.language)) continue
      // Monaco 在同一分组里只采用第一个产出 token 的提供者；后注册的那条会被静默丢掉。
      this.logger.warn('dsh-monaco: 语义着色贡献 "%s" 与 "%s" 声明了同一语言选择器，后者的部分结果可能不会生效',
        contribution.id, other.id)
    }
    const existing = this.semanticMap.get(contribution.id)
    if (existing !== undefined) this.releaseSemantic(contribution.id)
    this.semanticMap.set(contribution.id, contribution)
    this.bump()
    return () => {
      if (this.semanticMap.get(contribution.id) !== contribution) return
      this.semanticMap.delete(contribution.id)
      this.releaseSemantic(contribution.id)
      this.bump()
    }
  }

  /**
   * 读取当前生效的语义着色词法配色。
   * @param scheme - 界面配色方案。
   * @returns 合并后的规则；没有贡献时为只读空数组。
   */
  semanticTokenRules(scheme: 'light' | 'dark'): readonly Monaco.editor.ITokenThemeRule[] {
    const rules: Monaco.editor.ITokenThemeRule[] = []
    for (const contribution of this.semanticMap.values()) rules.push(...(contribution.tokenRules?.[scheme] ?? []))
    return rules
  }

  /**
   * 释放注册表。
   *
   * Monaco 是全页共享的：插件卸载或热重载后，写进 Monaco 的语义着色注册若没有人撤销，
   * 会以「先注册者优先」的方式压住新实例的提供者，并且再也无法回收。
   * @returns 卸载时仍未撤销的贡献标识，供调用方记录。
   */
  dispose(): readonly string[] {
    if (this.disposed) return []
    this.disposed = true
    const leaked = [...this.semanticMap.keys()]
    for (const id of leaked) this.releaseSemantic(id)
    this.semanticMap.clear()
    this.languageMap.clear()
    this.themeMap.clear()
    this.commandMap.clear()
    this.actionMap.clear()
    this.extraExtensions.clear()
    this.listeners.clear()
    return leaked
  }

  /**
   * 追加由编辑器接管的文件扩展名。
   * @param extensions - 扩展名列表，可带前导点。
   * @returns 撤销这一次追加。
   */
  registerFileExtensions(extensions: readonly string[]): () => void {
    const normalized = extensions.map(normalizeExtension)
    for (const extension of normalized) this.extraExtensions.set(extension, (this.extraExtensions.get(extension) ?? 0) + 1)
    this.bump()
    let active = true
    return () => {
      if (!active) return
      active = false
      for (const extension of normalized) {
        const count = this.extraExtensions.get(extension)
        if (count === undefined) continue
        if (count <= 1) this.extraExtensions.delete(extension)
        else this.extraExtensions.set(extension, count - 1)
      }
      this.bump()
    }
  }

  /**
   * 读取当前快照。
   * @returns 不变时返回同一个对象。
   */
  readonly getSnapshot = (): RegistrySnapshot => this.snapshot

  /**
   * 订阅注册变化。
   * @param listener - 变化观察者。
   * @returns 取消订阅。
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 外部追加的扩展名。 */
  extraExtensionList(): readonly string[] {
    return [...this.extraExtensions.keys()]
  }

  /** 供文件匹配使用的语言描述表：插件注册的语言排在 Monaco 自带语言之前。 */
  languageDescriptors(builtin: readonly LanguageDescriptor[]): readonly LanguageDescriptor[] {
    return [...[...this.languageMap.values()].map(contribution => ({
      id: contribution.id,
      extensions: contribution.extensions,
      filenames: contribution.filenames,
      filenamePatterns: contribution.filenamePatterns,
    })), ...builtin]
  }

  /** 注册语言里声明的扩展名，用于补充文档接管范围。 */
  languageExtensions(): readonly string[] {
    const extensions: string[] = []
    for (const contribution of this.languageMap.values()) {
      for (const extension of contribution.extensions ?? []) extensions.push(normalizeExtension(extension))
    }
    return extensions
  }

  /**
   * 取一种语言显示名。
   * @param id - 语言标识。
   * @returns 注册时声明的显示名。
   */
  labelOf(id: string): string | undefined {
    return this.languageMap.get(id)?.label
  }

  /**
   * 取一个已注册主题。
   * @param id - 主题标识。
   * @returns 主题定义。
   */
  themeOf(id: string): RegisteredTheme | undefined {
    const contribution = this.themeMap.get(id)
    if (contribution === undefined) return undefined
    return {
      id: contribution.id,
      label: contribution.label ?? contribution.id,
      base: contribution.base,
      inherit: contribution.inherit ?? true,
      rules: contribution.rules ?? [],
      colors: contribution.colors ?? {},
    }
  }

  /**
   * 把注册表里尚未生效的条目写进 Monaco。
   *
   * 语言与主题的注册是幂等的，重复调用只会刷新同一批条目；带 `loader` 的语言只执行一次加载器。
   * 调用被串行化，避免两次注册并发写入 Monaco 时互相覆盖。
   * @param api - 已就绪的 Monaco 命名空间。
   */
  syncInto(api: MonacoApi): Promise<void> {
    this.syncChain = this.syncChain
      .then(() => this.apply(api))
      .catch((error: unknown) => {
        // Monaco 侧写入失败（例如语法定义被 editors 拒绝）不该让后续同步全部停摆。
        this.logger.warn('dsh-monaco: 扩展同步失败：%s', error instanceof Error ? error.message : String(error))
      })
    return this.syncChain
  }

  private async apply(api: MonacoApi): Promise<void> {
    for (const contribution of this.languageMap.values()) {
      if (contribution.loader !== undefined && this.loadedLanguages.get(contribution.id) !== contribution) {
        this.loadedLanguages.set(contribution.id, contribution)
        try {
          await contribution.loader()
        } catch (error) {
          // 加载器来自外部插件：失败只影响这一种语言，其它注册继续生效。
          this.logger.warn('dsh-monaco: 语言 "%s" 的加载器执行失败：%s', contribution.id,
            error instanceof Error ? error.message : String(error))
        }
      }
      api.languages.register({
        id: contribution.id,
        ...(contribution.extensions === undefined ? {} : { extensions: [...contribution.extensions] }),
        ...(contribution.aliases === undefined ? {} : { aliases: [...contribution.aliases] }),
        ...(contribution.filenames === undefined ? {} : { filenames: [...contribution.filenames] }),
        ...(contribution.filenamePatterns === undefined ? {} : { filenamePatterns: [...contribution.filenamePatterns] }),
      })
      if (contribution.tokens !== undefined) api.languages.setMonarchTokensProvider(contribution.id, contribution.tokens)
      if (contribution.tokensProvider !== undefined) {
        api.languages.setTokensProvider(contribution.id, contribution.tokensProvider)
      }
      if (contribution.configuration !== undefined) {
        api.languages.setLanguageConfiguration(contribution.id, contribution.configuration)
      }
    }
    for (const contribution of this.themeMap.values()) {
      defineRegisteredTheme(api, this.logger, contribution, this.semanticTokenRules(schemeOf(contribution.base)))
    }
    for (const contribution of this.semanticMap.values()) {
      if (this.semanticRegistrations.has(contribution.id)) continue
      try {
        const disposer = api.languages.registerDocumentSemanticTokensProvider(
          contribution.language,
          contribution.provider,
        )
        this.semanticRegistrations.set(contribution.id, () => { disposer.dispose() })
      } catch (error) {
        // 一条贡献被 Monaco 拒绝时不该让同一批里其余贡献一起失效。
        this.logger.warn('dsh-monaco: 语义着色贡献 "%s" 注册失败：%s', contribution.id,
          error instanceof Error ? error.message : String(error))
      }
    }
  }

  /** 撤销一条贡献已写进 Monaco 的语义着色注册。 */
  private releaseSemantic(id: string): void {
    const release = this.semanticRegistrations.get(id)
    if (release === undefined) return
    release()
    this.semanticRegistrations.delete(id)
  }

  private bump(): void {
    this.revision += 1
    this.snapshot = {
      revision: this.revision,
      languages: [...this.languageMap.values()],
      themes: [...this.themeMap.values()],
      commands: [...this.commandMap.values()],
      actions: [...this.actionMap.values()],
      extensions: claimedExtensions([], this.extraExtensionList()),
    }
    for (const listener of this.listeners) listener()
  }
}
