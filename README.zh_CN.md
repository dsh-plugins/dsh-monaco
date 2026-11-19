<div align="center">

<img src="./docs/banner.svg" alt="dsh-monaco" width="720" />

# dsh-monaco

**把真正的 Monaco 编辑器放进 DeepSeek Harness 的右侧边栏：打开文本或代码文件即可就地编辑、带版本守卫地保存，并向其他插件开放语言与主题的扩展接口。**

[English](README.md) | 简体中文

[![DSH Plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4f7cff)](https://github.com/topics/dsh-plugin)
<img src="https://img.shields.io/github/license/dsh-plugins/dsh-monaco" alt="License">

</div>

![布局示意](docs/preview.svg)

## 功能 

| 能力 | 说明 |
|---|---|
| 接管文件预览 | 以 `extension` 优先级注册文档预览实现，覆盖内置的代码预览与纯文本回退；图片、PDF、Office、Excel 仍由平台原实现呈现 |
| 就地编辑与保存 | `Ctrl/Cmd+S` 写回磁盘，关闭标签页时也会提示保存；保存成功即刷新本地基线，撤销/重做、光标与滚动位置在切换到别的标签页后仍然保留 |
| 未保存标记 | 有改动的标签页把芯片上的 `×` 画成圆点（悬停恢复成 `×`），与 VS Code 一致 |
| 关闭确认 | 有未保存改动时关闭标签页会弹出「保存 / 不保存 / 取消」确认框：Esc 取消、Enter 保存；保存失败时确认框不会消失，并把原因留在框内 |
| 版本守卫 | 保存携带读取时观察到的文件版本；磁盘已被别的进程改动时返回 `409`，界面给出「重新加载」与「仍然覆盖」两条明确出路，不做静默覆盖 |
| 跟随界面主题 | 从 `--dsw-alias-*` 变量派生 Monaco 配色（选中用主题自己的文档选中蒙层，光标与焦点用品牌强调色，滚动条用边框色），界面切换亮色/暗色时同步切换；也可以在配置里固定成某个已注册主题 |
| 跟随字体设置 | 代码字体与字号取自「设置 → 外观」里的代码字体，改完立即生效，无需重开文件 |
| 编辑器设置 | 状态栏左侧的齿轮打开一个全局设置面板（同一浏览器内所有编辑器共享，写入 `localStorage`）；目前提供「自动换行」 |
| 浮层配色 | 右键菜单与命令面板跟随界面主题，并补齐它们依赖的圆角、边框与阴影 |
| 多语言 | 词条注册进平台文案系统；Monaco 自带消息包按界面语言加载（`zh-cn`、`zh-tw`、`ja`、`ko`、`de` 等） |
| 扩展接口 | `ctx.monacoEditor`：注册语言（Monarch 规则或手写逐行分词器）、语义 token 提供者与配色、主题、命令、动作，追加接管的扩展名，订阅编辑器挂载/卸载与文档打开/保存/修改/关闭事件 |

## 机制

1. **编辑器资源**：宿主把 `monaco-editor/min/vs` 整棵目录挂在 `/dsh-monaco/vs/` 下（`kind: 'prefix'` 路由），浏览器注入 `loader.js` 后按 AMD 模块 `vs/editor/editor.main` 加载。语言包、字体与四个语言 Worker 都由 Monaco 自己的目录结构提供，插件产物本身只有约 75 KB。
2. **资源防护**：请求路径先解码再逐段校验，拒绝 `.`/`..`、藏在单段里的 `/` 与 `\`、NUL，只放行白名单扩展名；解析出的绝对路径再做一次目录包含检查，随后才读盘。
3. **读取**：走平台已有的 `remote.workspaceFiles.readBytes`（按会话授权、带字节上限），以 UTF-8 严格解码；解码失败、文件不存在、超限等情况给出可读提示，不做静默降级。
4. **写入**：平台的文件远程服务是只读的，因此本插件在宿主注册 `POST /dsh-monaco/api/write`：校验协议版本与 JSON 形状 → 解析会话 cwd → `lstat` 拒绝非普通文件 → 按会话解析沙箱策略 → `fs.writeText` 带 `replaceIfVersion` 守卫。`FS_STALE_VERSION` 映射为 `409 stale-version`，沙箱拒绝映射为 `403`。
5. **文档接管**：注册进 `ctx.documentPreviews` 的实现以 `renderer` 模式工作，自己读取整份文件；标签页切走时视图卸载，但 Monaco 模型与未保存文本留在插件状态里，标签页记录消失（`tab.signal` 中止）时才释放。
6. **主题与字体**：`theme/change` 触发时重新派生配色并 `defineTheme`。这些变量的**声明值**往往还是一串 `var()`（甚至 `color-mix()`），而 Monaco 只接受最终颜色与真实字体族串，所以不手工沿变量链拼接，而是把 `var(--x, 哨兵)` 套到一个临时元素的标准属性上，再从 `getComputedStyle` 读回浏览器解析后的结果；哨兵值用来区分「变量不存在」。

   读回的值还必须再规范成**十六进制**：Monaco 0.57 的主题色只认 `#rrggbb` / `#rrggbbaa`，传入 `rgb()` / `rgba()` / `color(srgb …)` 会在 `editor.create` 时抛 `Illegal value for token color`，整个编辑器停在半初始化状态（默认白底、无语法着色）。值为 `undefined` 同样会抛错，所以解析不出的键直接不写、交给基础主题补齐，无法规范的变量写一条 warn 日志。

   语义也要对上：`--dsw-alias-brand-primary` 是文字主色级（暗色近白、亮色近黑），不是品牌强调色。因此选中用 `--dsw-alias-bg-document-selection`，光标与焦点框用 `--dsw-alias-brand-primary-new-colorprimary-new-color`，滚动条用 `--dsw-alias-border-l2/-l4`，浮层表面用 `--dsw-alias-bg-layer-3`。叠加透明度时对既有 alpha 做乘法（`border-l1` 本身就是 6% 的白，覆盖会把它放大成 50%）。

   字体取 body 上合成好的 `--ds-font-family-code` 与 `--dsh-code-font-size`；状态栏等界面文字用正文栈 `--dsw-font-family`。
7. **关闭确认**：平台的关闭链路是同步的——`sidebarRight.close(tabId)` → 关闭钩子 → 移除标签页；钩子要么正常返回（继续关），要么抛错（保留标签页，平台文档写明 *Failure preserves the tab*，点击路径上平台自己捕获并记录该异常）。所以「弹出确认框」实现为：`registerCloseHandler('text', …)` 在标签页有未保存改动时抛 `TabCloseVeto` 中止这次关闭，确认框挂在 `shell.overlay` 里；用户选完再由守卫发起一次被放行的关闭。放行只在这一次同步调用内有效，不会残留到下一次关闭。

   标签页上的 `×` 由平台停靠组件渲染，没有可替换的接口，所以圆点不改标题、只在关闭按钮上打 `data-dsh-monaco-tab-dirty` 标记，由样式把图标改成圆点（`visibility` 而非 `display`，按钮尺寸不变、标签条不抖动）。标记在脏状态变化与标签条重渲染时都会重新打一遍，避免 React 重挂节点丢掉外来属性。

   两条已知的平台侧行为：其一，`Ctrl/Cmd+W` 走平台的快捷键分发，那里没有 `try/catch`，所以按键关闭时会有一条被抛出的 `TabCloseVeto` 落到控制台——确认框照常弹出，功能不受影响；其二，平台在「用新资源替换标签页」时同样会过一遍关闭钩子，此时确认框的「保存」会先关掉旧标签页，那次导航需要重新发起。这两个都是平台关闭链路本身的性质，插件侧不做绕道。
8. **浮层变量**：右键菜单与命令面板并不渲染在编辑器内部——Monaco 把它们放进 `div.shadow-root-host` 的 Shadow DOM，宿主的 `:host { all: initial }` 切断全部继承，而 `--vscode-*` 变量只声明在 `.monaco-editor` / `.monaco-component` 上。于是浮层里 `background-color: var(--vscode-menu-background)` 整条失效（背景透明）、`color` 回落到初始值（黑字），深色背景上的黑字基本看不见。

   修法是把这些变量镜像到 `document.documentElement`：Shadow DOM 宿主继承自 document，自定义属性可以正常继承进 shadow 树。变量取自 Monaco 自己注入的 `style.monaco-colors`，因此换主题后重新镜像即可跟上，不必在此重复维护一份配色。找到配色表之后，观察范围收敛到那张表本身（Monaco 换主题是改写既有 `<style>` 的文本），页面里其他 `head` 变化不会触发重读。

   另外 Monaco 只引用不定义 `--vscode-cornerRadius-*`、`--vscode-strokeThickness`、`--vscode-shadow-lg`（在 VS Code 里由工作台样式给出），缺了它们菜单就没有圆角与边框，所以这几个由插件补默认值：圆角与描边是固定值，阴影按主题的蒙层色合成。Monaco 自己声明过同名变量时以它为准。

   主题里还显式写了 `menu.*` 一族颜色（背景、前景、边框、分隔线、选中项），否则菜单会落到 Monaco 自带的灰色，和 DSH 的层次对不上。
9. **编辑器设置**：设置在 `localStorage` 里存一份（键 `dsh-monaco/editor-settings`），当前页面与同源的其他窗口共享——跨窗口靠 `storage` 事件同步，写入方自己不会收到该事件，所以不会自激。改动立即推给已打开的实例。

   换行这个项目前有两处来源——全局设置是默认值，预览工具栏的按钮是该标签页的临时覆盖。平台那份状态默认就是「开」，无法区分「用户刚关掉」与「初始值」，所以只在工具栏的值**变化**时记为覆盖（挂载时的初值不算，否则全局设置永远不生效）；覆盖随标签页存在，切到别的文件不带走。改全局设置会清掉当前标签页的覆盖，否则用户一旦点过工具栏按钮，就再也没有回到「跟随全局」的路径。

## 安装

从 Git 源安装（拉取源码并现场构建；pnpm 默认拦截依赖的构建脚本，按提示允许一次即可）：

```powershell
dsh plugin --profile web add "github:dsh-plugins/dsh-monaco"
```

或在 DSH 会话里用 `plugin_manager` 的 `install_bundle` 指向本目录，或在命令行按本地目录安装：

```powershell
dsh plugin --profile web add C:\path\to\dsh-monaco
```

从源码构建：

```powershell
git clone https://github.com/dsh-plugins/dsh-monaco.git
cd dsh-monaco
npm install --ignore-scripts
npm run build
npm test
```

`npm test` 用 `node --test` 直接运行 `tests/*.test.ts`，依赖 Node ≥ 22.18 的类型剥离能力（`engines.node` 已声明该下限）。

> 本包尚未发布到 npm；发布后可直接 `dsh plugin --profile web add "@dsh-plugin/dsh-monaco"`。

`cordis.patch.yml` 插入一行宿主入口（`@` 是 YAML 保留指示符，包名必须加引号）：

```yaml
- insert:
    - id: dsh-monaco
      name: '@dsh-plugin/dsh-monaco'
```

以目录链接方式安装后，重新执行 `npm run build` **不会**让正在运行的实例换用新的宿主端产物：模块 URL 不变，Node 的 ESM 缓存不会重新读盘。改完宿主端代码并构建后需要重启 dsh 实例；只改客户端代码时重新构建并刷新页面即可。

## 配置

```yaml
- id: dsh-monaco
  name: '@dsh-plugin/dsh-monaco'
  config:
    editor:
      fontSize: 13
      tabSize: 2
      insertSpaces: true
      minimap: false
      theme: dsh
    extensions: [log, lock]
    maxWriteBytes: 8388608
    assetCacheSeconds: 86400
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `editor.fontSize` | `12` | 编辑器字号（8–32）；**DSH 设置了代码字号时以 DSH 为准** |
| `editor.tabSize` | `2` | 缩进宽度（1–8） |
| `editor.insertSpaces` | `true` | 使用空格缩进 |
| `editor.minimap` | `false` | 显示缩略图 |
| `editor.theme` | `'dsh'` | `dsh` 跟随界面主题；也可以写某个已注册主题的 id |
| `extensions` | `[]` | 在内置接管范围之外追加扩展名（可带前导点） |
| `maxWriteBytes` | `8388608` | 单次保存允许的最大文本字节数，超过即拒绝，不截断 |
| `assetCacheSeconds` | `86400` | Monaco 静态资源的浏览器缓存秒数 |

配置通过 `webserver/index-inject` 注入为 `window.__DSH_MONACO_CONFIG__`，浏览器端与宿主端读到的值一致。

## 给其他插件用的接口

客户端 Cordis 服务 `ctx.monacoEditor`，在依赖方的 `export const inject` 里声明 `'monacoEditor'` 即可使用。

```ts
export const inject = ['monacoEditor']

export function apply(ctx: Context): void {
  // 语言 + Monarch 高亮规则 + 语言配置
  ctx.effect(() => ctx.monacoEditor.registerLanguage({
    id: 'glsl',
    label: 'GLSL',
    extensions: ['.glsl', '.vert', '.frag'],
    tokens: {
      keywords: ['void', 'float', 'vec2', 'vec3', 'vec4', 'uniform', 'in', 'out'],
      tokenizer: {
        root: [
          [/\/\/.*$/, 'comment'],
          [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
          [/\d+\.?\d*/, 'number'],
        ],
      },
    },
    configuration: { comments: { lineComment: '//' }, brackets: [['{', '}'], ['[', ']'], ['(', ')']] },
  }))

  // 主题：基于 Monaco 内置基础主题叠加
  ctx.effect(() => ctx.monacoEditor.registerTheme({
    id: 'dsh-monaco-solarized',
    label: 'Solarized',
    base: 'vs-dark',
    inherit: true,
    rules: [{ token: 'comment', foreground: '586e75' }],
    colors: { 'editor.background': '#002b36' },
  }))

  // 命令与动作：快捷键要用 Monaco 的常量，所以在 ready 之后注册
  void ctx.monacoEditor.ready.then(() => {
    const monaco = ctx.monacoEditor.monaco
    if (monaco === undefined) return
    ctx.effect(() => ctx.monacoEditor.registerCommand({
      id: 'dsh-monaco.insertTimestamp',
      label: '插入时间戳',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: ({ editor, monaco }) => {
        const line = editor.getPosition()?.lineNumber ?? 1
        editor.executeEdits('timestamp', [{
          range: new monaco.Range(line, 1, line, 1),
          text: `${new Date().toISOString()} `,
        }])
      },
    }))
  })

  // 追加接管的扩展名
  ctx.effect(() => ctx.monacoEditor.registerFileExtensions(['log', 'properties.local']))

  // 语义 token 与它自己的词法配色：跟随界面主题的派生主题不带规则，
  // 因此每条贡献要按配色方案分别给出颜色。legend 一律由 provider 提供。
  ctx.effect(() => ctx.monacoEditor.registerSemanticTokens({
    id: 'acme/semantic-tokens',
    language: ['glsl', 'plaintext'],
    tokenRules: {
      light: [{ token: 'variable', foreground: '001080' }],
      dark: [{ token: 'variable', foreground: '74B0DF' }],
    },
    provider: {
      getLegend: () => ({ tokenTypes: ['variable', 'number'], tokenModifiers: [] }),
      provideDocumentSemanticTokens: model => ({ data: encode(model) }),
      releaseDocumentSemanticTokens: () => {},
    },
  }))

  // 编辑器实例：装饰、监听与 DOM 操作挂在这里，并在卸载事件里释放
  const cleanups = new Map<string, () => void>()
  ctx.effect(() => ctx.monacoEditor.events.onDidMountEditor(({ tabId, editor }) => {
    const collection = editor.createDecorationsCollection([])
    cleanups.set(tabId, () => { collection.clear() })
  }))
  ctx.effect(() => ctx.monacoEditor.events.onDidUnmountEditor(({ tabId }) => {
    cleanups.get(tabId)?.()
    cleanups.delete(tabId)
  }))

  // 文档事件
  ctx.effect(() => ctx.monacoEditor.events.onDidSaveDocument(({ sessionId, path, version }) => {
    ctx.logger.info('saved %s (%s) in %s', path, version, sessionId)
  }))
}
```

`registerLanguage` 的字段语义与 Monaco 的 `languages.register` 一致：`extensions`、`filenames`、`filenamePatterns` 决定文件匹配，`tokens` 是 Monarch 规则，`configuration` 是语言配置；插件注册的语言排在 Monaco 自带语言之前，同一扩展名以插件声明为准。`loader` 字段可以在应用规则之前加载另一个贡献包（例如 `globalThis.require(['vs/basic-languages/…'])`）。`tokensProvider` 是给 Monarch 表达不了跨行状态的语言准备的逃生舱（块标量、缩进栈）：它是一个手写的逐行分词器，直接接到 `languages.setTokensProvider`。它与 `tokens` 互斥，同时声明会在注册时抛错。

`registerSemanticTokens` 按语言选择器（可以是 `'yaml'` 这样的自带语言，也可以是自己的语言标识）注册 `DocumentSemanticTokensProvider`，是否作用于某份文档由提供者自己判断。`tokenRules` 必须覆盖 provider legend 里的每一种类型、并且亮暗两套都给：Monaco 用主题里该类型的前景色画语义 token，没有规则的型别会落到正文色。这些规则进的是全局 token 主题，`{ token: 'string' }` 会同时改变其它语言里同名 Monarch token 的颜色。

编辑器以 `'semanticHighlighting.enabled': true` 运行：Monaco 的 standalone 主题服务把主题侧的语义高亮开关写死为关闭，不打开这个全局选项，贡献的提供者永远画不出任何东西。它是全局选项，同页其它插件创建的 Monaco 实例也会一并启用语义着色。

`monacoEditor` 的完整成员：

| 成员 | 说明 |
|---|---|
| `version` | 扩展接口版本，当前为 `1` |
| `ready` | Monaco 就绪的 Promise；在其中可以安全调用编辑器 API |
| `monaco` | 已加载的 Monaco 命名空间，尚未就绪时为 `undefined` |
| `registerLanguage(contribution)` | 注册语言、高亮规则（Monarch 或 `tokensProvider`）与语言配置，返回撤销函数 |
| `registerTheme(contribution)` | 注册基于内置基础主题的配色主题 |
| `registerSemanticTokens(contribution)` | 为一种或多种语言注册语义 token 提供者，并给出亮暗两套词法配色 |
| `registerCommand(contribution)` | 注册命令（进命令面板，可绑定快捷键） |
| `registerAction(contribution)` | 注册动作（可带 Monaco 上下文键前置条件） |
| `registerFileExtensions(extensions)` | 追加由编辑器接管的文件扩展名 |
| `getActiveEditor()` | 当前聚焦的编辑器：`{ editor, monaco, document }`，没有打开编辑器时为 `undefined` |
| `openFile({ sessionId, path, line? })` | 在侧边栏打开文件并可选跳到某一行 |
| `events.onDidMountEditor / onDidUnmountEditor` | 编辑器实例生命周期；挂载事件带 `{ editor, monaco, tabId, sessionId, path, languageId }` |
| `events.onDidOpenDocument / onDidSaveDocument / onDidChangeDocument / onDidCloseDocument` | 文档生命周期 |

新增成员按「存在即支持」探测（例如 `typeof service.registerSemanticTokens === 'function'`）；`version` 只在不兼容调整时递增，因此 `0.1.x` 的消费者不能靠它判断新成员是否存在。

## 开发

```powershell
npm run typecheck   # 宿主端与客户端两套 tsconfig
npm test            # node --test，直接用 Node 22+ 的类型剥离跑 tests/*.test.ts
npm run build       # build:host (tsc) + build:client (tsdown + 声明文件)
```

源码分三层：

- `src/shared/`：宿主与浏览器共用的纯逻辑（地址构造、资源路径校验、扩展名归一化、语言匹配、保存协议、语言映射），测试集中在这些不依赖运行时的规则上；
- `src/`（顶层）：宿主端——资源路由、保存路由、Monaco 目录定位、配置；
- `src/client/`：浏览器端——Monaco 加载器、主题派生与浮层变量、扩展注册表、编辑器状态、保存通道、关闭守卫、编辑器设置与视图、对外服务。

客户端产物由 `tsdown.client.config.mjs` 包成 `window.__ModuleLoader__.load({ id: "@dsh-plugin/dsh-monaco", factory })`——注册 id 必须等于包名，平台按它查找工厂，否则报 *loaded without registering*；`react`、`react-dom`、`@deepseek-ai/cordis` 保持外部化，其余依赖内联。运行期不对 `@deepseek-ai/*` 做值导入：宿主端只按用到的成员声明自己的服务外观（`src/host-types.ts`），客户端同理（`src/client/types.ts`）。

## 验证清单

- [x] 启动日志无 `plugin tree failed to load`，客户端条目出现在 `window.__DSH_BOOT__.entries`
- [x] `__DSH_MONACO_CONFIG__` 注入值与宿主配置一致
- [x] `/dsh-monaco/vs/loader.js`、`editor.main.js`、`editor.main.css`、多语言与 Worker 静态资源均返回 200 与正确 Content-Type
- [x] `/dsh-monaco/vs/../../package.json`、`..%2f..%2fpackage.json`、`..%5c..%5cpackage.json` 均返回 404
- [x] 保存路由：正常写入 200、方法不符 405、非 JSON 类型 415、坏 JSON 400、版本过期 409、文件不存在 404、超出上限 413
- [x] 客户端产物在 `__ModuleLoader__.load` 之外没有顶层声明，`factory` 返回 `{ name, inject, apply, VIEWER_ID }`
- [x] 状态栏没有「保存」按钮；`Ctrl+S` 仍写回磁盘
- [x] 有未保存改动时标签芯片的 `×` 变成圆点（标记属性 `data-dsh-monaco-tab-dirty`、图标 `visibility: hidden`、按钮尺寸不变）
- [x] 关闭有改动的标签页弹出确认框；「取消」与 Esc 保留标签页与改动，「不保存」关闭且磁盘不变，「保存」关闭且磁盘写入成功
- [x] 右键菜单不透明且可读：背景 `rgb(53, 54, 56)`、字色 `rgb(249, 250, 251)`、圆角 8px、边框 1px
- [x] 状态栏最左侧是设置齿轮；面板里切换「自动换行」后 Monaco 的 `wordWrap` 随之变化，并写入 `localStorage`、刷新页面后仍生效

## 许可

LGPL-3.0-only。Monaco Editor 由 Microsoft 以 MIT 许可发布，随依赖安装，不随本仓库分发。
