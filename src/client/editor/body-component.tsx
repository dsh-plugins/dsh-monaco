/**
 * 把插件能力绑进编辑器视图的组件工厂。
 *
 * 平台按槽位注册渲染器，渲染器只收到平台交来的属性；插件自己的服务（会话状态、
 * Monaco、注册表）必须由闭包带进去，所以这里造一个稳定的组件引用——
 * 每次注册都复用同一个引用，避免切换视图时被当成新组件而重挂载。
 * @module dsh-monaco/client/editor/body-component
 */
import type { ReactNode } from 'react'
import { EditorBody } from './EditorBody.tsx'
import type { EditorBodyProps, EditorFace } from './EditorBody.tsx'

/**
 * 生成文档渲染器组件。
 * @param face - 插件能力：会话状态、Monaco 运行时、扩展注册表与读写入口。
 * @returns 接收平台文档槽属性的 React 组件。
 */
export function createEditorBody(face: EditorFace): (props: Omit<EditorBodyProps, 'editor'>) => ReactNode {
  return function MonacoEditorBody(props: Omit<EditorBodyProps, 'editor'>): ReactNode {
    return <EditorBody {...props} editor={face} />
  }
}
