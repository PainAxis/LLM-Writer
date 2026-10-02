import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { createEditor, Editor, Node, Text, Transforms, type Descendant, type Range } from 'slate'
import { ref, shallowRef } from 'vue'
import { useShortStorySelection } from '../src/composables/useShortStorySelection'
import { useShortStoryGeneration, type ShortStoryOperation } from '../src/composables/useShortStoryGeneration'
import type { GenerateOptions, StreamCallback } from '../src/types/api'

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const html = (node: Node): string => {
  if (Text.isText(node)) {
    const text = escape(node.text)
    return (node as { bold?: boolean }).bold ? `<strong>${text}</strong>` : text
  }
  return `<p>${node.children.map(html).join('')}</p>`
}
const paragraph = (text: string): Descendant => ({ children: [{ text }] })

// Use the real Slate range and insertion implementation underlying WangEditor.
// The small port only supplies WangEditor's DOM-independent convenience methods.
function editorWith(children: Descendant[]) {
  const editor = createEditor()
  editor.children = structuredClone(children)
  return Object.assign(editor, {
    isDestroyed: false,
    getHtml: () => editor.children.map(html).join(''),
    getSelectionText: () => editor.selection ? Editor.string(editor, editor.selection) : '',
    select: (range: Range) => Transforms.select(editor, range),
  })
}

function fixture(children = [paragraph('不要走。'), paragraph('不要走。')]) {
  const editor = editorWith(children)
  const editorRef = shallowRef<ReturnType<typeof editorWith> | null>(editor)
  const content = ref(editor.getHtml())
  let invalidations = 0
  const selection = useShortStorySelection({
    editor: editorRef, content, onInvalidate: () => { invalidations++ },
  })
  const select = (anchorPath: number[], anchorOffset: number, focusPath: number[], focusOffset: number) =>
    editor.select({ anchor: { path: anchorPath, offset: anchorOffset }, focus: { path: focusPath, offset: focusOffset } })
  return { editor, editorRef, content, selection, select, get invalidations() { return invalidations } }
}

{
  const f = fixture()
  f.select([1, 0], 0, [1, 0], 4)
  const snapshot = f.selection.capture()
  assert.equal(snapshot?.text, '不要走。')
  // Moving the caret or blurring for the modal must not change the captured range.
  f.select([0, 0], 0, [0, 0], 4)
  assert.equal(f.selection.replace('请留下。'), true)
  assert.equal(f.content.value, '<p>不要走。</p><p>请留下。</p>')
  assert.equal(f.selection.replace('不能再应用'), false)
  f.selection.dispose()
}
console.log('✓ Repeated text replacement targets the selected second occurrence after selection moves, exactly once')

{
  // Exercise the actual component boundary without loading WangEditor's DOM runtime in Node.
  const source = readFileSync(new URL('../src/components/short-story/ShortFictionWorkspace.vue', import.meta.url), 'utf8')
  const handler = source.slice(source.indexOf('const optimizeCurrentSelection ='), source.indexOf('</script>'))
  assert.ok(handler.startsWith('const optimizeCurrentSelection ='))
  const executable = ts.transpileModule(`${handler}\nreturn optimizeCurrentSelection`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  const repeated = '雨落无声。'
  const before = `第一处：${repeated}第二处：`
  const after = '末尾保留。'
  const f = fixture([paragraph(before + repeated + after)])
  const end = before.length + repeated.length
  f.select([0, 0], end, [0, 0], before.length + 1)
  assert.equal(f.editor.getSelectionText(), '落无声。', 'Reproduce the throttled cached selection from Chromium')
  const ownedNode = {}
  const outsideNode = {}
  const validDOM = { rangeCount: 1, isCollapsed: false, anchorNode: ownedNode, focusNode: ownedNode }
  let nativeSelection: typeof validDOM | null = validDOM
  let converted: Range | null = { anchor: { path: [0, 0], offset: end }, focus: { path: [0, 0], offset: before.length } }
  let conversions = 0
  let conversionError = false
  let captured: ReturnType<typeof f.selection.capture> = null
  const optimize = new Function('editorRef', 'window', 'DomEditor', 'optimizeSelection', executable)(
    f.editorRef,
    { getSelection: () => nativeSelection },
    {
      hasDOMNode: (_editor: unknown, node: object) => node === ownedNode,
      toSlateRange: () => { conversions++; if (conversionError) throw new Error('Detached editor DOM'); return converted },
    },
    (range: Range | null) => { captured = f.selection.capture(range) },
  )
  optimize()
  assert.equal(captured?.text, repeated, 'Live DOM selection must override the stale editor range synchronously')
  f.select([0, 0], 0, [0, 0], 0)
  assert.equal(f.selection.replace('新雨声。'), true)
  assert.equal(Node.string(f.editor), before + '新雨声。' + after, 'Only the intended second occurrence is replaced')

  for (const invalid of [null, { ...validDOM, rangeCount: 0 }, { ...validDOM, isCollapsed: true },
    { ...validDOM, anchorNode: outsideNode }, { ...validDOM, focusNode: outsideNode }]) {
    f.select([0, 0], 0, [0, 0], 4)
    nativeSelection = invalid
    optimize()
    assert.equal(captured, null, 'Absent, collapsed or outside-editor DOM ranges cannot reuse a retained selection')
    assert.equal(f.selection.isCurrent(), false)
  }
  assert.equal(conversions, 1, 'Both selection endpoints must belong to the editor before converting')
  nativeSelection = validDOM
  converted = null
  optimize()
  assert.equal(captured, null, 'An unconvertible DOM range must not fall back to cached selection')
  conversionError = true
  assert.doesNotThrow(optimize)
  assert.equal(captured, null, 'A detached DOM conversion must reject safely')
  f.selection.dispose()
}
console.log('✓ Live DOM selection beats throttled editor state; missing, collapsed, foreign and invalid ranges cannot revive stale selections')

{
  const f = fixture([{
    children: [{ text: '门外' }, { text: '下着雨', bold: true }, { text: '，他沉默。' }],
  } as Descendant])
  // A backward range crossing plain and bold leaves must also restore exactly.
  f.select([0, 1], 3, [0, 0], 0)
  assert.equal(f.selection.capture()?.text, '门外下着雨')
  Transforms.deselect(f.editor)
  assert.equal(f.selection.replace('雨滴敲打门外'), true)
  assert.equal(Node.string(f.editor), '雨滴敲打门外，他沉默。')
  assert.equal(f.content.value.includes('门外下着雨'), false)
  f.selection.dispose()
}
console.log('✓ A backward selection spanning rich-text marks replaces the exact range and preserves the suffix')

{
  const f = fixture([paragraph('  开头'), paragraph('结尾  '), paragraph('保留')])
  f.select([0, 0], 0, [1, 0], 4)
  assert.ok(f.selection.capture()?.text.startsWith('  '), 'Capture preserves selected whitespace')
  assert.equal(f.selection.replace('<em>新文</em> & $&'), true)
  assert.equal(Node.string(f.editor), '<em>新文</em> & $&保留')
  assert.equal(f.content.value, '<p>&lt;em&gt;新文&lt;/em&gt; &amp; $&amp;</p><p>保留</p>')
  f.selection.dispose()
}
console.log('✓ Multi-paragraph selections and literal angle brackets, entities and replacement symbols remain plain text')

for (const change of ['source-and-undo', 'editor', 'destroy', 'unreported-edit', 'close', 'dispose'] as const) {
  const f = fixture()
  f.select([1, 0], 0, [1, 0], 4)
  f.selection.capture()
  const initial = f.content.value
  if (change === 'source-and-undo') {
    f.content.value = '<p>编辑后的版本</p>'
    f.content.value = initial
    assert.equal(f.invalidations, 1)
  } else if (change === 'editor') {
    f.editorRef.value = editorWith([paragraph('不要走。'), paragraph('不要走。')])
    assert.equal(f.invalidations, 1)
  } else if (change === 'destroy') f.editor.isDestroyed = true
  else if (change === 'unreported-edit') {
    f.select([0, 0], 0, [0, 0], 0)
    f.editor.insertText('模型尚未同步的编辑')
  } else if (change === 'close') f.selection.clear()
  else f.selection.dispose()
  assert.equal(f.selection.isCurrent(), false, change)
  assert.equal(f.selection.replace('过期结果'), false, change)
  assert.equal(f.content.value, initial, change)
  f.selection.dispose()
}
console.log('✓ Source versions, editor replacement/destruction, unsynced edits, closing and disposal reject stale selections')

{
  const f = fixture()
  f.select([0, 0], 0, [0, 0], 0)
  assert.equal(f.selection.capture(), null, 'A collapsed caret is not an optimization selection')
  f.select([0, 0], 0, [0, 0], 4)
  f.selection.capture()
  // Even if an editor port cannot restore the saved range, never insert at its caret.
  f.editor.select = () => Transforms.select(f.editor, { path: [0, 0], offset: 0 })
  assert.equal(f.selection.replace('不能插入'), false)
  assert.equal(f.content.value, '<p>不要走。</p><p>不要走。</p>')
  f.selection.dispose()
}
console.log('✓ Empty or unrestorable selections cannot insert text into an unrelated caret')

{
  const editor = editorWith([paragraph('不要走。'), paragraph('不要走。')])
  const editorRef = shallowRef<ReturnType<typeof editorWith> | null>(editor)
  const content = ref(editor.getHtml())
  const requests: Array<{ resolve(text: string): void; reject(error: Error): void; callback?: StreamCallback | null }> = []
  const fakeStream = () => ({
    generate: (_prompt: string, _options?: GenerateOptions, callback?: StreamCallback | null) =>
      new Promise<string>((resolve, reject) => requests.push({ resolve, reject, callback })),
    stop() {},
  })
  const streams = Object.fromEntries(['article', 'story', 'continue', 'optimize'].map(kind => [kind, fakeStream()])) as
    Record<ShortStoryOperation, ReturnType<typeof fakeStream>>
  const generation = useShortStoryGeneration({
    storyContent: content, streams, notify: { success() {}, warning() {}, error() {} },
  })
  const selection = useShortStorySelection({
    content, editor: editorRef, onInvalidate: () => generation.stop('optimize'),
  })
  const selectSecond = () => editor.select({ anchor: { path: [1, 0], offset: 0 }, focus: { path: [1, 0], offset: 4 } })
  const request = { prompt: '优化', successMessage: '完成', errorPrefix: '失败' }
  const apply = () => generation.canUseResult('optimize') && selection.replace(generation.states.optimize.text)

  selectSecond()
  selection.capture()
  const cancelled = generation.start('optimize', request)
  generation.stop('optimize')
  selection.clear() // The dialog close boundary clears both the request and selection.
  requests[0]!.callback?.('迟到', '关闭后的迟到文本')
  requests[0]!.resolve('关闭后的迟到结果')
  await cancelled
  assert.equal(apply(), false)

  selectSecond()
  selection.capture()
  const failed = generation.start('optimize', request)
  requests[1]!.reject(new Error('临时失败'))
  await failed
  assert.equal(apply(), false)
  assert.equal(selection.isCurrent(), true, 'Generation failure permits retry on the same unchanged selection')
  const retry = generation.start('optimize', request)
  requests[2]!.resolve('首次结果')
  await retry
  assert.equal(generation.canUseResult('optimize'), true)
  const regenerated = generation.start('optimize', request)
  assert.equal(apply(), false, 'Starting another attempt invalidates the previous completed result')
  requests[3]!.resolve('最新结果')
  await regenerated
  assert.equal(apply(), true)
  assert.equal(content.value, '<p>不要走。</p><p>最新结果</p>')

  selectSecond()
  selection.capture()
  const replacedEditor = generation.start('optimize', request)
  editorRef.value = editorWith([paragraph('另一个编辑器')])
  requests[4]!.resolve('旧编辑器的迟到结果')
  await replacedEditor
  assert.equal(generation.canUseResult('optimize'), false)
  assert.equal(apply(), false)
  generation.dispose()
  selection.dispose()
}
console.log('✓ Dialog cancellation, failures, retries and editor rebuilds retain generation ownership and reject stale results')
