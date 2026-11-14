/**
 * 编辑器视图样式。
 *
 * 预览主体是平台的滚动容器（`position: relative`，`overflow: auto`），
 * 所以编辑器根节点用 `position: absolute; inset: 0` 铺满它，让 Monaco 拿到确定的高度。
 * @module dsh-monaco/client/styles
 */

/** 样式表标签的归属标记：热重载时按它替换旧样式。 */
export const STYLE_OWNER = 'dsh-monaco'

/** 注入到页面的样式文本。 */
export const STYLES = `
.dsh-monaco-root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  /* 界面文字（状态栏、提示条）沿用 DSH 的正文字体栈；编辑器正文的字体由 Monaco 自己按代码字体设置渲染。 */
  font-family: var(--dsw-font-family, inherit);
}
.dsh-monaco-host {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
.dsh-monaco-notice {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dsh-monaco-notice[data-tone="error"] {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-monaco-notice[data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary);
}
.dsh-monaco-status {
  display: flex;
  flex: 0 0 auto;
  gap: 12px;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-monaco-status[data-dirty="true"] {
  color: var(--dsw-alias-state-warn-primary);
}
.dsh-monaco-spacer {
  flex: 1 1 auto;
}
.dsh-monaco-action {
  padding: 2px 8px;
  font: inherit;
  color: inherit;
  cursor: pointer;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
}
.dsh-monaco-action:hover:enabled {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary);
}
.dsh-monaco-action:disabled {
  cursor: default;
  opacity: 0.55;
}
.dsh-monaco-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  justify-content: center;
  padding: 24px;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-base);
}
`
