import { watch, type Ref } from 'vue'
import type { IDomEditor, SlateRange } from '@wangeditor/editor'

type SelectionEditor = Pick<IDomEditor,
  'selection' | 'getHtml' | 'getSelectionText' | 'select' | 'deleteFragment' | 'insertText' | 'isDestroyed'>

interface SelectionSnapshot {
  editor: SelectionEditor
  range: SlateRange
  sourceContent: string
  sourceHtml: string
  text: string
}

const cloneRange = (range: SlateRange): SlateRange => ({
  anchor: { path: [...range.anchor.path], offset: range.anchor.offset },
  focus: { path: [...range.focus.path], offset: range.focus.offset },
})

/** Own an exact editor selection until its document, editor or dialog changes. */
export function useShortStorySelection(options: {
  content: Ref<string>
  editor: Ref<SelectionEditor | null>
  onInvalidate(): void
}) {
  let snapshot: SelectionSnapshot | null = null
  let disposed = false
  const clear = () => { snapshot = null }
  const invalidate = () => {
    if (!snapshot) return
    clear()
    options.onInvalidate()
  }
  // Invalidating immediately also prevents an edit followed by Undo from reviving
  // a result whose source version has already changed.
  const stopWatching = watch([options.content, options.editor], invalidate, { flush: 'sync' })

  const capture = (currentRange?: SlateRange | null) => {
    clear()
    const editor = options.editor.value
    if (disposed || !editor || editor.isDestroyed || currentRange === null) return null
    // WangEditor's throttled selectionchange may still retain the previous range.
    if (currentRange !== undefined) editor.select(cloneRange(currentRange))
    if (!editor.selection) return null
    const text = editor.getSelectionText()
    if (!text.trim()) return null
    snapshot = {
      editor,
      range: cloneRange(editor.selection),
      sourceContent: options.content.value,
      sourceHtml: editor.getHtml(),
      text,
    }
    return { text, sourceContent: snapshot.sourceContent }
  }

  const isCurrent = () => Boolean(!disposed && snapshot
    && options.editor.value === snapshot.editor && !snapshot.editor.isDestroyed
    && options.content.value === snapshot.sourceContent
    && snapshot.editor.getHtml() === snapshot.sourceHtml)

  const replace = (text: string) => {
    if (!text.trim() || !isCurrent() || !snapshot) return false
    const target = snapshot
    // Consume before any editor mutation, including a failed attempt. A retry
    // must not apply the same result at an altered range.
    clear()
    target.editor.select(cloneRange(target.range))
    if (target.editor.getSelectionText() !== target.text) return false
    // Delete first so Slate resolves the insertion point after merging blocks.
    // Its combined insertText(range) can lose the start point when the range
    // covers complete paragraphs.
    target.editor.deleteFragment()
    target.editor.insertText(text)
    options.content.value = target.editor.getHtml()
    return true
  }

  const dispose = () => { disposed = true; clear(); stopWatching() }
  return { capture, isCurrent, replace, clear, dispose }
}
