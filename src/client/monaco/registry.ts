/**
 * 外部插件用来扩展编辑器的注册表：语言（含高亮规则）、主题、命令、动作与文件扩展名。
 *
 * 注册表只管数据与通知；真正写进 Monaco 的时机由插件主体在 Monaco 就绪后调用
 * {@link MonacoExtensionRegistry.syncInto} 决定，编辑器实例创建时再取命令与动作。
 * @module dsh-monaco/client/monaco/registry
 */
import type { LanguageDescriptor } from '../../shared/language.ts'
import { claimedExtensions, normalizeExtension } from '../../shared/claim.ts'
import type { MonacoApi } from '../types.ts'
import type {
  ActionContribution,
  CommandContribution,
  LanguageContribution,
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
 * 校验一条语言贡献。
 * @param contribution - 待注册的语言。
 * @throws 当标识为空或文件名正则无法编译时抛出。
 */
function validateLanguage(contribution: LanguageContribution): void {
  if (contribution.id.trim().length === 0) throw new Error('dsh-monaco: language id must not be empty')
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

/** 扩展注册表。 */
export class MonacoExtensionRegistry {
  private readonly languageMap = new Map<string, LanguageContribution>()
  private readonly themeMap = new Map<string, ThemeContribution>()
  private readonly commandMap = new Map<string, CommandContribution>()
  private readonly actionMap = new Map<string, ActionContribution>()
  private readonly extraExtensions = new Map<string, number>()
  private readonly listeners = new Set<() => void>()
  /** 已把 loader 跑完的语言贡献，避免重复执行同一份加载逻辑。 */
  private readonly loadedLanguages = new Map<string, LanguageContribution>()
  private revision = 0
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
      if (contribution.configuration !== undefined) {
        api.languages.setLanguageConfiguration(contribution.id, contribution.configuration)
      }
    }
    for (const contribution of this.themeMap.values()) {
      api.editor.defineTheme(contribution.id, themeDefinitionOf({
        id: contribution.id,
        label: contribution.label ?? contribution.id,
        base: contribution.base,
        inherit: contribution.inherit ?? true,
        rules: contribution.rules ?? [],
        colors: contribution.colors ?? {},
      }))
    }
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
