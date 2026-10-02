import assert from 'node:assert/strict'
import { nextTick, ref, shallowRef } from 'vue'
import type { IDomEditor } from '@wangeditor/editor'
import { useShortStoryEditors } from '../src/composables/useShortStoryEditors'
import {
  countWriterWords,
  countWriterPlainText,
  formatGeneratedBody,
  formatGeneratedContent,
  plainTextToWriterHtml,
  stripWriterHtml,
} from '../src/utils/writerContent'

// Stored WangEditor HTML: marks, links, soft breaks and distinct paragraphs
// must preserve the prose a reader sees when copied, exported or sent to AI.
assert.equal(
  stripWriterHtml('<p>清晨，<strong>林</strong>走进<a href="https://example.test/?q=a>b">书店</a>。<br>门铃响了。</p><p>“欢迎。”<em>店主说。</em></p>'),
  '清晨，林走进书店。\n门铃响了。\n\n“欢迎。”店主说。',
)
assert.equal(
  stripWriterHtml('<div>\n  <h3>序章</h3>\n  <p>第一段</p>\n  <blockquote><p>引文</p><p>下一段</p></blockquote>\n</div>'),
  '序章\n\n第一段\n\n引文\n\n下一段',
)
assert.equal(stripWriterHtml('<ul><li>打开门</li><li>走进雨里</li></ul>'), '打开门\n走进雨里')
assert.equal(
  stripWriterHtml('<table><tr><td>角色</td><td>林</td></tr><tr><td>地点</td><td>书店</td></tr></table>'),
  '角色\t林\n地点\t书店',
)
console.log('✓ Rich text retains paragraph, heading, soft-break, list and table boundaries')

assert.equal(
  stripWriterHtml('<p>&lt;林&gt; &amp; &quot;书&quot; &#39;店&#39; &nbsp; &#x1F31F; &copy; &eacute;</p>'),
  '<林> & "书" \'店\' \u00a0 🌟 © é',
)
assert.equal(
  stripWriterHtml('<p>&lt;strong&gt;原文&lt;/strong&gt; &amp;lt;林&amp;gt; &amp;amp;</p>'),
  '<strong>原文</strong> &lt;林&gt; &amp;',
  'Decode only once after removing real markup; escaped prose must never become tags',
)
assert.equal(stripWriterHtml('<p>A &amp B &#65 &#x42 C</p>'), 'A & B A B C', 'HTML text supports legacy entity references without semicolons')
assert.equal(stripWriterHtml('A &amp B &#65 &#x42 C'), 'A &amp B &#65 &#x42 C', 'Plain text never acquires HTML entity interpretation')
assert.equal(stripWriterHtml('<p>可见<!-- <p>隐藏注释</p> -->文字<script>不可见</script><style>也不可见</style></p>'), '可见文字')
console.log('✓ Named and numeric entities decode once; comments and non-visible script/style are omitted')

for (const prose of [
  '<林>走进书店，条件是 a<b。',
  '旧纯文本第一行\n\n第二段\n下一行',
  '第一行\r\n第二行',
  '字面 &lt;林&gt; 和 &amp; 符号',
  '他写下 <b>，没有对应结束标签。',
  '<!-- <p>这是作者的原始记号</p> -->',
]) assert.equal(stripWriterHtml(`  ${prose}  `), prose)
assert.equal(stripWriterHtml('<p><林>看见 a<b，再写下 &lt;林&gt;。</p>'), '<林>看见 a<b，再写下 <林>。')
console.log('✓ Legacy prose retains literal angle brackets, unmatched tags, entities and internal line breaks')

assert.equal(countWriterWords('<p>林 &amp; 星🌟</p><p> 空\t白<br/>外</p>'), 7)
assert.equal(countWriterWords('🌟\n林\t A B'), 4, 'Count visible Unicode characters, not UTF-16 units or whitespace')
assert.equal(countWriterWords('<p>&lt;林&gt;</p>'), 3, 'Entity spelling and rich markup cannot inflate the count')
assert.equal(countWriterWords(''), 0)
assert.equal(countWriterPlainText('<b>字</b>'), 8, 'Raw AI prose is counted exactly as displayed, including literal markup')
assert.equal(countWriterWords(plainTextToWriterHtml('<b>字</b>')), 8, 'Raw and rendered text share the same visible character count')
console.log('✓ Word counts share visible text semantics and count emoji once without whitespace')

const raw = '<林>说："a<b & &lt;"\n\n<script>这是故事原文</script>\n# 尾声'
const streamHtml = plainTextToWriterHtml(raw)
assert.equal(
  streamHtml,
  '<p>&lt;林&gt;说：&quot;a&lt;b &amp; &amp;lt;&quot;<br/><br/>&lt;script&gt;这是故事原文&lt;/script&gt;<br/># 尾声</p>',
)
assert.equal(stripWriterHtml(streamHtml), raw)
assert.equal(stripWriterHtml(plainTextToWriterHtml('第一行\r\n第二行\r第三行')), '第一行\n第二行\n第三行')

const chapterTitle = '第1章 <林> & "书店"'
assert.equal(
  formatGeneratedContent('<林>走进书店。\n"a<b & &lt;"\n## 尾声 <结束>', chapterTitle),
  '<h3>第1章 &lt;林&gt; &amp; &quot;书店&quot;</h3><p>&lt;林&gt;走进书店。</p><p class="dialogue">&quot;a&lt;b &amp; &amp;lt;&quot;</p><h3>尾声 &lt;结束&gt;</h3>',
)
assert.equal(
  stripWriterHtml(formatGeneratedContent('<林>走进书店。\n"a<b & &lt;"\n## 尾声 <结束>', chapterTitle)),
  `${chapterTitle}\n\n<林>走进书店。\n\n"a<b & &lt;"\n\n尾声 <结束>`,
)
assert.equal(formatGeneratedContent(`${chapterTitle}\n正文`, chapterTitle), '<h3>第1章 &lt;林&gt; &amp; &quot;书店&quot;</h3><p>正文</p>')
assert.equal(formatGeneratedBody('第一段\n“对话”'), '<p>第一段</p><p class="dialogue">“对话”</p>')
assert.equal(formatGeneratedBody('<p><h3>用户原文</h3></p>'), '<p>&lt;p&gt;&lt;h3&gt;用户原文&lt;/h3&gt;&lt;/p&gt;</p>')
console.log('✓ AI body/title rendering escapes raw prose, emits valid sibling blocks and preserves streaming newlines')

// Exercise the real editor orchestration, including the queued nextTick boundary.
{
  const editors = useShortStoryEditors()
  const published = ref('')
  const writes: string[] = []
  const instance = { setHtml: (html: string) => writes.push(html) } as IDomEditor
  const editor = shallowRef<IDomEditor | null>(instance)
  let current = true
  editors.updateGeneratedEditor(published, editor, raw, () => current)
  assert.equal(published.value, streamHtml)
  assert.deepEqual(writes, [])
  await nextTick()
  assert.deepEqual(writes, [streamHtml])

  editors.updateGeneratedEditor(published, editor, '过期流式内容', () => current)
  current = false
  await nextTick()
  assert.equal(writes.length, 1, 'Cancelled requests cannot mutate the editor on the queued tick')

  current = true
  editors.updateGeneratedEditor(published, editor, '旧编辑器内容', () => current)
  editor.value = { setHtml: (html: string) => writes.push(html) } as IDomEditor
  await nextTick()
  assert.equal(writes.length, 1, 'Replacing an editor invalidates its queued writes')

  editors.updateGeneratedEditor(published, editor, '生成的新内容', () => current)
  published.value = '<p>用户已经编辑</p>'
  await nextTick()
  assert.equal(writes.length, 1, 'User edits must survive a queued generated update')
}
console.log('✓ ShortStory streaming publishes escaped HTML without reviving cancelled, replaced or edited editor updates')
