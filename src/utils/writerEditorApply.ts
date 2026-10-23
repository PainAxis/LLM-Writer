import { decodeHTML } from 'entities/decode'

/** A known, non-mutating refusal, not an uncertain editor/save result. */
export class WriterEditorApplyBlockedError extends Error {}

/** wangEditor 5's text serializer does not escape ampersands. A literal HTML
 * entity would be decoded again on reload. Refuse only that text, not ordinary
 * ampersands or literal angle brackets, until the editor can round-trip it.
 */
export function assertWriterEditorTextRoundTrip(text: string, source: '当前正文' | '草稿'): void {
  if (decodeHTML(text) !== text) {
    throw new WriterEditorApplyBlockedError(`${source}含有编辑器暂不能原样保存的实体字面文本（如 &lt; 或 &#60;）。正文未修改；请复制草稿，不会自动追加。`)
  }
}
