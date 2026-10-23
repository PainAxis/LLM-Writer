<template>
  <section class="plot-panel" data-testid="plot-links-panel" aria-labelledby="plot-links-title">
    <div class="toolbar"><div><h2 id="plot-links-title">伏笔与可能回收</h2><p class="muted">独立的多前提标注，不自动作为 Writer 依据。列表与引用是上次核验快照，静置时不后台读取全书；刷新、查看原文、确认和删除前重新校验全部前提。</p></div><button data-testid="plot-links-refresh" :disabled="!active || busy" @click="reload">刷新标注</button></div>
    <p v-if="!active" class="muted" data-testid="plot-links-unavailable">等待已保存正文校验。旧版本或披露范围外的标注不会展示；已保存作者数据仍保留，不会自动删除。</p>
    <p v-if="error" role="alert" class="error" data-testid="plot-links-error">{{ error }}</p>
    <p v-if="notice" role="status" class="muted" data-testid="plot-links-notice">{{ notice }}</p>
    <template v-if="ready">
      <label class="field"><span>查找标注或原文</span><input v-model="query" type="search" maxlength="500" data-testid="plot-links-query" /></label>
      <p v-if="!visible.plotLinks.length" class="muted" data-testid="plot-links-empty">上次核验时的披露范围内没有匹配的有效标注。这不表示全书没有伏笔或回收。</p>
      <p v-if="visible.truncated" class="warning">当前最多显示 200 条，请缩小搜索范围。</p>
      <article v-for="(link, index) in visible.plotLinks" :key="link.id" class="plot-card" :data-testid="`plot-links-item-${index}`" :data-confirmed="String(link.authorConfirmed)">
        <h3>{{ link.title }}</h3>
        <p>{{ link.mode === 'possible_recovery' ? '可能回收' : '伏笔候选（不代表尚未回收）' }} · {{ link.origin === 'inferred' ? '模型推断' : '原文明示（仍须核对）' }} · {{ link.authorConfirmed ? '作者已确认' : '尚未经作者确认' }}</p>
        <p class="explanation" data-testid="plot-links-explanation">{{ link.explanation }}</p>
        <p class="muted">模型解释不是原文事实；引用位置与修订仅在上次读取时通过校验，静置期间仍可能变化。</p>
        <div class="toolbar"><button :data-testid="`plot-links-confirm-${index}`" :disabled="busy || link.authorConfirmed" @click="confirm(link.id)">作者确认</button><button :data-testid="`plot-links-delete-${index}`" :disabled="busy" @click="remove(link.id)">删除标注</button></div>
        <section v-for="(premise, group) in link.premises" :key="group" class="premise" :data-role="premise.role" data-testid="plot-links-premise">
          <h4>{{ roleLabels[premise.role] }}</h4>
          <article v-for="(anchor, anchorIndex) in premise.evidence" :key="anchorIndex">
            <p>第 {{ anchor.ordinal }} 章 · {{ anchor.chapterTitle }} · {{ anchor.start }}–{{ anchor.end }}（UTF-16）</p>
            <p class="revision" data-testid="plot-links-revision">章节修订 {{ anchor.sourceRevision }}</p>
            <blockquote data-testid="plot-links-quote">{{ anchor.quote }}</blockquote>
            <button data-testid="plot-links-view-source" :disabled="busy" @click="viewSource(anchor)">查看当前原文</button>
          </article>
        </section>
      </article>
      <aside v-if="sourceView" class="source-view" data-testid="plot-links-source">
        <div class="toolbar"><h3>最近核验的章节原文</h3><button @click="sourceView = null">关闭原文</button></div>
        <pre>{{ sourceView.before }}<mark>{{ sourceView.quote }}</mark>{{ sourceView.after }}</pre>
      </aside>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { confirmFactPlotLink, resolveFactAnchors, selectFactPlotLinks } from '@/services/memory/factGraph'
import { readFactGraph, saveFactGraph } from '@/services/memory/factGraphStore'
import { readMemoryDemo, readMemoryNovel } from '@/services/memory/labData'
import { createCommittedMemorySourceGuard, withMemoryAbort } from '@/services/memory/semanticScanUi'
import type { FactAnchor, FactGraphDocument } from '@/types/factGraph'
import type { MemoryIndexStats, MemoryProjectInput } from '@/types/memory'

const props = defineProps<{ project: MemoryProjectInput | null; stats: MemoryIndexStats | null; throughChapterId: string; disabled: boolean }>()
const emit = defineEmits<{ 'refresh-required': [] }>()
const roleLabels = { setup: '铺垫前提', recovery: '回收前提', context: '上下文前提' }
const graph = shallowRef<FactGraphDocument | null>(null)
const query = ref('')
const error = ref('')
const notice = ref('')
const busy = ref(false)
const sourceView = shallowRef<{ before: string; quote: string; after: string } | null>(null)
const active = computed(() => !props.disabled && !!props.project && !!props.stats && props.project.id === props.stats.projectId && props.project.chapters.some(chapter => chapter.id === props.throughChapterId))
const ready = computed(() => active.value && !!graph.value)
const selection = computed(() => {
  try { return { value: ready.value ? selectFactPlotLinks(props.project!, props.stats!, graph.value!, props.throughChapterId, query.value) : { plotLinks: [], truncated: false }, error: '' } }
  catch { return { value: { plotLinks: [], truncated: false }, error: '标注格式或来源无效，已隐藏旧内容。原有数据不会被覆盖。' } }
})
const visible = computed(() => selection.value.value)
watch(() => selection.value.error, value => { if (value) error.value = value })
const eventOwner = `plot-panel:${crypto.randomUUID()}`
let generation = 0
let disposed = false
let controller: AbortController | null = null
function clear() { generation++; controller?.abort(); controller = null; graph.value = null; sourceView.value = null; busy.value = false }
function owner(token: number) { if (disposed || token !== generation || !active.value) throw new DOMException('标注已失效', 'AbortError') }
async function checkedSource(token: number, signal: AbortSignal) {
  const project = props.project
  if (!project) throw new Error('没有当前正文')
  const assertCurrent = () => { owner(token); if (props.project !== project) throw new Error('正文已变化') }
  const guard = createCommittedMemorySourceGuard(project, () => project.id === 'memory-demo' ? readMemoryDemo() : readMemoryNovel(project.id), assertCurrent, signal)
  try { await guard(); assertCurrent(); return project }
  catch (cause) { if (!signal.aborted && token === generation && !disposed) { clear(); notice.value = '已保存的标注仍保留，但当前来源已变化或无法核验，旧内容已隐藏。'; emit('refresh-required') }; throw cause }
}
async function bounded<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const own = new AbortController(); controller?.abort(); controller = own
  const timer = setTimeout(() => own.abort(), 10000)
  try { return await withMemoryAbort(run(own.signal), own.signal) }
  finally { clearTimeout(timer); if (controller === own) controller = null }
}
async function reload() {
  clear()
  if (!active.value || !props.project) return
  const token = generation
  busy.value = true; error.value = ''
  try {
    const value = await bounded(async signal => { const project = await checkedSource(token, signal); const value = await readFactGraph(project.id); owner(token); await checkedSource(token, signal); return value })
    owner(token); graph.value = value
  } catch { if (!disposed && token === generation) error.value = '标注读取或原文校验失败。已有数据已保留，不能用空列表覆盖；请刷新后重试。' }
  finally { if (token === generation) busy.value = false }
}
async function mutate(id: string, action: 'confirm' | 'delete') {
  const before = graph.value
  if (!ready.value || !before || busy.value || !visible.value.plotLinks.some(link => link.id === id)) return
  const token = generation
  busy.value = true; error.value = ''; notice.value = ''
  let committed = false
  let saveStarted = false
  try {
    await bounded(async signal => {
      const project = await checkedSource(token, signal)
      const current = await readFactGraph(project.id); owner(token)
      if (current.revision !== before.revision) throw new Error('graph_changed')
      await checkedSource(token, signal); owner(token)
      // Both deletion and confirmation require every premise to remain visible.
      if (!selectFactPlotLinks(project, props.stats!, { ...before, plotLinks: before.plotLinks.filter(link => link.id === id) }, props.throughChapterId).plotLinks.length) throw new Error('source_changed')
      const next = action === 'confirm' ? confirmFactPlotLink(project, props.stats!, before, props.throughChapterId, id) : { ...before, plotLinks: before.plotLinks.filter(link => link.id !== id) }
      saveStarted = true
      const saving = saveFactGraph(next, before.revision || null)
      void saving.then(saved => { if (disposed || token !== generation || signal.aborted) {
        if (!disposed && props.project?.id === saved.projectId) notice.value = '更改已保存，但会话或来源随后失效。已有作者数据仍保留。'
        window.dispatchEvent(new CustomEvent('memory-fact-graph-changed', { detail: { projectId: saved.projectId, revision: saved.revision, owner: `${eventOwner}:${token}` } }))
      } }, () => undefined)
      const saved = await withMemoryAbort(saving, signal)
      committed = true
      if (disposed || token !== generation) return
      await checkedSource(token, signal); owner(token)
      graph.value = saved
      notice.value = action === 'confirm' ? '作者确认已保存，所有前提仍受修订和披露校验。' : '标注已删除，正文未修改。'
      window.dispatchEvent(new CustomEvent('memory-fact-graph-changed', { detail: { projectId: saved.projectId, revision: saved.revision, owner: `${eventOwner}:${token}` } }))
    })
  } catch {
    if (!disposed && token === generation) { clear(); error.value = committed ? '更改已保存，但保存后的来源无法核验，旧内容已隐藏。已有作者数据未自动删除。' : saveStarted ? '保存结果尚未确认。请勿重复操作；刷新标注核对保存结果。' : '来源或图谱已变化，或读取失败。本次未写入，请刷新后重试。' }
  } finally { if (token === generation) busy.value = false }
}
function confirm(id: string) { return mutate(id, 'confirm') }
function remove(id: string) { return mutate(id, 'delete') }
async function viewSource(anchor: FactAnchor) {
  if (busy.value || !ready.value) return
  const token = generation; busy.value = true
  try { await bounded(async signal => { const project = await checkedSource(token, signal); const current = await readFactGraph(project.id); owner(token); if (current.revision !== graph.value?.revision) throw new Error('graph_changed'); await checkedSource(token, signal); if (!resolveFactAnchors(project, props.stats!, props.throughChapterId, [anchor])) throw new Error('source_changed'); const chapter = project.chapters.find(item => item.id === anchor.chapterId)!; owner(token); sourceView.value = { before: chapter.text.slice(0, anchor.start), quote: anchor.quote, after: chapter.text.slice(anchor.end) } }) }
  catch { if (token === generation) { clear(); error.value = '原文无法核验，旧引用已隐藏。' } }
  finally { if (token === generation) busy.value = false }
}
function onGraphChanged(event: Event) {
  const detail = (event as CustomEvent<{ projectId?: string; owner?: string }>).detail
  if (detail?.projectId === props.project?.id && detail.owner !== `${eventOwner}:${generation}`) void reload()
}
function onFocus() { if (active.value) void reload() }
watch(() => [active.value, props.project, props.stats?.fingerprint, props.throughChapterId], () => { notice.value = ''; void reload() }, { immediate: true, flush: 'sync' })
onMounted(() => { window.addEventListener('memory-fact-graph-changed', onGraphChanged); window.addEventListener('focus', onFocus) })
onUnmounted(() => { disposed = true; clear(); window.removeEventListener('memory-fact-graph-changed', onGraphChanged); window.removeEventListener('focus', onFocus) })
</script>

<style scoped>
.plot-panel { padding: 20px; margin-bottom: 18px; border: 1px solid var(--el-border-color-light); border-radius: 12px; background: var(--el-bg-color); min-width: 0; } h2 { font-size: 18px; margin: 0; } h3 { font-size: 15px; } h4 { font-size: 14px; } p { line-height: 1.7; overflow-wrap: anywhere; } .muted { color: var(--el-text-color-secondary); font-size: 13px; } .warning { color: var(--el-color-warning-dark-2); } .error { color: var(--el-color-danger); } .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; justify-content: space-between; } button, input { padding: 9px 12px; font: inherit; color: inherit; background: var(--el-fill-color-blank); border: 1px solid var(--el-border-color); border-radius: 6px; } button { cursor: pointer; } button:disabled { opacity: .55; cursor: not-allowed; } .field { display: flex; flex-direction: column; gap: 8px; } .plot-card { margin-top: 16px; padding: 16px; border: 1px solid var(--el-border-color); border-radius: 8px; } .premise { border-top: 1px solid var(--el-border-color-lighter); margin-top: 14px; } .revision { font-size: 12px; overflow-wrap: anywhere; } blockquote { margin: 8px 0; padding: 12px; border-left: 3px solid var(--el-color-primary); background: var(--el-fill-color-light); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; } pre { max-height: 480px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.8; } mark { color: inherit; background: var(--el-color-warning-light-7); } @media(max-width: 480px) { .plot-panel, .plot-card { padding: 12px; } button, input { min-height: 44px; } }
</style>
