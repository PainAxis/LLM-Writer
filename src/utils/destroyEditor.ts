import { DomEditor, type IDomEditor } from '@wangeditor/editor'

/** wangEditor 5 removes its listener but leaves a trailing throttled selection callback. */
export function destroyEditor(editor: IDomEditor | null | undefined): void {
  if (!editor) return
  // This adapter is the only dependency on the v5 internal throttle. Keep the
  // cancel before destroy, while TextArea still owns its editor weak-map entry.
  const textarea = DomEditor.getTextarea(editor) as unknown as {
    onDOMSelectionChange?: { cancel(): void }
  } | undefined
  textarea?.onDOMSelectionChange?.cancel()
  editor.destroy()
}
