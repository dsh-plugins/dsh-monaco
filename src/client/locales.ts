/** 编辑器界面词条：简体中文为键源，英文与之一一对应。 @module dsh-monaco/client/locales */

/** 简体中文字典与键源。 */
export const zh = {
  'viewer.title': 'Monaco 编辑器',
  'state.loading': '正在加载文件…',
  'state.loadingEditor': '正在准备编辑器…',
  'state.retry': '重试',
  'status.position': '第 {line} 行，第 {column} 列',
  'status.lines': '{count} 行',
  'status.unsaved': '未保存',
  'status.saved': '已与磁盘一致',
  'status.saving': '保存中…',
  'action.save': '保存',
  'action.saveHint': '保存（Ctrl+S）',
  'conflict.external': '磁盘上的文件已变化，本地编辑仍未保存。',
  'conflict.save': '保存被拒绝：磁盘上的文件版本已经更新。',
  'conflict.reload': '重新加载',
  'conflict.overwrite': '仍然覆盖',
  'error.readFailed': '读取文件失败：{message}',
  'error.notText': '这不是 UTF-8 文本文件，无法在编辑器中打开。',
  'error.tooLarge': '文件超出宿主允许的单次读取上限。',
  'error.notFound': '文件不存在或已被删除。',
  'error.notRegularFile': '目标不是普通文件。',
  'error.saveNetwork': '保存请求没有送达宿主，请检查连接后重试。',
  'error.saveResponse': '保存接口返回了无法解析的响应（HTTP {status}）。',
  'error.editorUnavailable': '编辑器资源加载失败：{message}',
} as const

/** 英文字典，键与中文一致。 */
export const en = {
  'viewer.title': 'Monaco editor',
  'state.loading': 'Loading file…',
  'state.loadingEditor': 'Preparing editor…',
  'state.retry': 'Retry',
  'status.position': 'Ln {line}, Col {column}',
  'status.lines': '{count} lines',
  'status.unsaved': 'Unsaved',
  'status.saved': 'Matches disk',
  'status.saving': 'Saving…',
  'action.save': 'Save',
  'action.saveHint': 'Save (Ctrl+S)',
  'conflict.external': 'The file changed on disk while you have unsaved edits.',
  'conflict.save': 'Save refused: the file on disk has a newer version.',
  'conflict.reload': 'Reload',
  'conflict.overwrite': 'Overwrite anyway',
  'error.readFailed': 'Could not read the file: {message}',
  'error.notText': 'This is not a UTF-8 text file and cannot be opened in the editor.',
  'error.tooLarge': 'The file exceeds the host read limit for a single read.',
  'error.notFound': 'The file is missing or was deleted.',
  'error.notRegularFile': 'The path is not a regular file.',
  'error.saveNetwork': 'The save request did not reach the host; check the connection and retry.',
  'error.saveResponse': 'The save endpoint answered with an unreadable response (HTTP {status}).',
  'error.editorUnavailable': 'The editor failed to load: {message}',
} satisfies Record<keyof typeof zh, string>

/** 词条命名空间。 */
export const LOCALE_NAMESPACE = 'dshMonaco'
