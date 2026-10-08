<template>
  <section class="fact-panel" aria-labelledby="fact-graph-title" data-testid="fact-graph-panel">
    <div class="section-heading">
      <div><h2 id="fact-graph-title">事实关系图</h2><p class="muted">人物、事件、物件与地点均由当前有效关系生成。点击关系或下方列表，核对原文与修订版本。</p></div>
      <button data-testid="fact-graph-create" :disabled="!ready || actionBusy" @click="createRelation">添加关系</button>
    </div>
    <p class="muted">关系单独保存在当前浏览器，不修改正文。确认只表示作者已审核；原文修改或超出披露范围后，关系仍会自动排除。实际作品的关系随设置中的完整备份或“小说数据”导出和恢复；记忆示例不包含在备份内。</p>
    <p v-if="!active" class="empty" data-testid="fact-graph-unavailable">{{ props.project && !props.project.chapters.length ? '作品尚无可绘制的已保存章节。' : '等待当前正文校验完成。未保存修改、刷新或检索期间不展示旧关系。' }}</p>
    <p v-else-if="loading" class="empty">正在读取关系记录…</p>
    <p v-if="error" class="error" role="alert" data-testid="fact-graph-error">{{ error }}</p>
    <p v-if="selectionError" class="error" role="alert">{{ selectionError }}</p>
    <p v-if="notice" class="muted" role="status" data-testid="fact-graph-notice">{{ notice }}</p>
    <template v-if="ready">
      <div class="toolbar">
        <label class="field graph-query"><span>查找人物、关系或原文中的伏笔</span><input v-model="graphQuery" data-testid="fact-graph-query" type="search" maxlength="500" placeholder="例如：银钥匙、铜铃、西渡口" /></label>
        <button :disabled="!selection.relations.length" @click="fitGraph">适应画布</button>
      </div>
      <div class="legend" aria-label="图谱图例">
        <span class="person">● 人物</span><span class="event">◆ 事件</span><span class="object">■ 物件</span><span class="place">⬟ 地点</span>
        <span>实线：原文明示</span><span>虚线：模型推断</span><span class="confirmed">粗绿线：作者确认</span>
      </div>
      <div ref="canvas" class="graph-canvas" data-testid="fact-graph-canvas" :data-edge-count="selection.relations.length" :data-selected-relation="selectedId" role="img" aria-label="事实关系图。可用下方关系列表完成所有键盘操作。" />
      <p v-if="canvasError" class="warning" role="status">图形暂时不可用，可继续使用下方关系列表：{{ canvasError }}</p>
      <p v-if="selection.truncated" class="warning" data-testid="fact-graph-truncated">当前匹配较多，画布与列表最多显示 200 条。请使用关键词缩小范围。</p>
      <p v-if="!selection.relations.length" class="empty" data-testid="fact-graph-empty">当前披露范围内没有匹配的有效关系。可从检索依据添加，或选择已披露章节的精确片段。</p>
      <div class="graph-layout">
        <div class="relation-list" data-testid="fact-graph-list" aria-label="可用键盘浏览的关系列表">
          <button v-for="(relation, index) in selection.relations" :key="relation.id" class="relation-row" :class="{ selected: selectedId === relation.id }" :data-testid="`fact-graph-relation-${index}`" :aria-pressed="selectedId === relation.id" @click="selectRelation(relation.id)">
            <strong>{{ relation.source.label }} → {{ relation.target.label }}</strong><span>{{ relation.predicate }}</span>
            <span class="relation-meta"><span :class="{ confirmed: relation.authorConfirmed }">{{ statusLabel(relation) }}</span><span>{{ typeLabel(relation.source.type) }} → {{ typeLabel(relation.target.type) }}</span><span>{{ relation.evidence.length }} 条原文依据</span></span>
          </button>
        </div>
        <aside class="relation-evidence" data-testid="fact-graph-evidence" aria-live="polite">
          <h3>关系依据</h3>
          <p v-if="!selected" class="muted">点击一条关系查看其全部依据。</p>
          <template v-else>
            <p class="relationship"><strong>{{ selected.source.label }}</strong> {{ selected.predicate }} <strong>{{ selected.target.label }}</strong></p>
            <p data-testid="fact-graph-provenance">{{ statusLabel(selected) }} · {{ selected.createdBy === 'model' ? '模型提议' : '作者录入' }}{{ selected.authorConfirmed ? ` · 原始类别：${originLabel(selected.origin)}` : '' }}</p>
            <p v-if="selected.origin === 'inferred'" class="warning">推断可能不准确。以下片段是推断依据，不代表原文直接陈述了该关系。</p>
            <div class="toolbar">
              <button data-testid="fact-graph-confirm" :disabled="actionBusy || selected.authorConfirmed" @click="confirmRelation">{{ selected.authorConfirmed ? '已由作者确认' : '作者确认' }}</button>
              <button data-testid="fact-graph-edit" :disabled="actionBusy" @click="editRelation">编辑</button>
              <button data-testid="fact-graph-delete" :disabled="actionBusy" @click="deleteRelation">删除关系</button>
            </div>
            <article v-for="(anchor, index) in selected.evidence" :key="`${anchor.chapterId}:${anchor.start}:${index}`" class="anchor-evidence">
              <h4>第 {{ anchor.ordinal }} 章 · {{ anchor.chapterTitle }}</h4>
              <dl><dt>章节版本</dt><dd><code data-testid="fact-graph-revision">{{ anchor.sourceRevision }}</code></dd><dt>原文位置</dt><dd>{{ anchor.start }}–{{ anchor.end }}（UTF-16，左闭右开）</dd></dl>
              <blockquote data-testid="fact-graph-quote">{{ anchor.quote }}</blockquote>
            </article>
          </template>
        </aside>
      </div>
      <button v-if="selectedEvidence" data-testid="fact-graph-use-evidence" :disabled="actionBusy" @click="useSearchEvidence">使用当前检索依据添加关系</button>
      <section v-if="formOpen" class="relation-form" aria-labelledby="fact-form-title" data-testid="fact-graph-form">
        <div class="section-heading"><h3 id="fact-form-title">{{ editingId ? '编辑关系' : '添加有原文依据的关系' }}</h3><button :disabled="actionBusy" @click="closeForm">关闭</button></div>
        <p class="muted">先选择精确引用，再填写关系。每条关系可以有多条依据；只有全部依据均为当前版本且已披露时，关系才会显示。</p>
        <fieldset :disabled="actionBusy">
          <legend>原文依据</legend>
          <label class="field"><span>已披露章节</span><select v-model="anchorChapterId" data-testid="fact-graph-chapter" @change="resetQuote"><option v-for="(chapter, index) in disclosedChapters" :key="chapter.id" :value="chapter.id">{{ index + 1 }} · {{ chapter.title }}</option></select></label>
          <details v-if="anchorChapter"><summary>查看所选章节正文</summary><pre class="source-text">{{ anchorChapter.text }}</pre></details>
          <label class="field"><span>从原文复制精确片段（最多 2000 字符）</span><textarea v-model="quoteInput" data-testid="fact-graph-quote-input" rows="3" maxlength="2000" @input="locateQuote" /></label>
          <div class="toolbar"><label class="field"><span>片段起点（重复原文可指定位置）</span><input v-model.number="quoteStart" data-testid="fact-graph-quote-start" type="number" min="0" step="1" /></label><button data-testid="fact-graph-add-evidence" :disabled="anchors.length >= 8" @click="addAnchor">加入依据</button></div>
          <div class="chosen-anchors" data-testid="fact-graph-anchors"><article v-for="(anchor, index) in anchors" :key="index"><p>第 {{ chapterOrdinal(anchor.chapterId) }} 章 · {{ chapterTitle(anchor.chapterId) }} <button :data-testid="`fact-graph-remove-evidence-${index}`" @click="removeAnchor(index)">移除</button></p><blockquote>{{ anchor.quote }}</blockquote></article></div>
        </fieldset>
        <fieldset :disabled="actionBusy">
          <legend>关系内容</legend>
          <div class="entity-fields"><label class="field"><span>起点名称（须见于依据）</span><input v-model="form.sourceLabel" data-testid="fact-graph-source-label" maxlength="120" /></label><label class="field"><span>起点类别</span><select v-model="form.sourceType" data-testid="fact-graph-source-type"><option v-for="(label, type) in entityLabels" :key="type" :value="type">{{ label }}</option></select></label><label class="field"><span>终点名称（须见于依据）</span><input v-model="form.targetLabel" data-testid="fact-graph-target-label" maxlength="120" /></label><label class="field"><span>终点类别</span><select v-model="form.targetType" data-testid="fact-graph-target-type"><option v-for="(label, type) in entityLabels" :key="type" :value="type">{{ label }}</option></select></label></div>
          <label class="field"><span>关系描述</span><input v-model="form.predicate" data-testid="fact-graph-predicate" maxlength="200" placeholder="例如：保管、接应信号指向、发生于" /></label>
          <p class="muted">{{ editingOrigin === 'inferred' ? '编辑后仍保留“模型推断”来源，须重新确认。' : '手动添加按“原文明示”记录，请确保原文直接支持该关系；作者确认可在保存后单独操作。' }}</p>
          <button data-testid="fact-graph-save" :disabled="!anchors.length" @click="saveManual">{{ editingId ? '保存修改' : '保存关系' }}</button>
        </fieldset>
        <div class="model-actions">
          <h3>从这些片段提议关系</h3>
          <p class="muted">按需调用设置中的写作模型，仅发送以上所选原文片段。模型不会收到后续章节或已有图谱。明示与推断由模型标注，均未经作者确认，须逐条审核保存。</p>
          <button data-testid="fact-graph-extract" :disabled="actionBusy || !anchors.length" @click="extract">让模型提议关系</button><button v-if="extracting" data-testid="fact-graph-cancel-extract" @click="cancelExtraction">取消提议</button>
          <article v-for="(proposal, index) in proposals" :key="proposal.id" class="proposal" :data-testid="`fact-graph-proposal-${index}`"><strong>{{ proposal.source.label }} → {{ proposal.target.label }}</strong><p>{{ proposal.predicate }}</p><p class="muted">{{ statusLabel(proposal) }} · 未经作者确认 · {{ proposal.evidence.length }} 条依据</p><blockquote v-for="(anchor, anchorIndex) in proposal.evidence" :key="anchorIndex">{{ anchor.quote }}</blockquote><button :data-testid="`fact-graph-accept-${index}`" :disabled="actionBusy" @click="acceptProposal(proposal)">保存此提议</button></article>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import type { Core, ElementDefinition, StylesheetJson } from 'cytoscape'
import { createDemoFactGraph, factEntityId, resolveFactAnchors, selectFactGraph } from '@/services/memory/factGraph'
import { readFactGraph, saveFactGraph } from '@/services/memory/factGraphStore'
import { extractFactRelations } from '@/services/memory/factExtraction'
import { createMemoryDemo, readMemoryDemo, readMemoryNovel } from '@/services/memory/labData'
import type { FactAnchor, FactEntity, FactGraphDocument, FactRelation } from '@/types/factGraph'
import type { MemoryEvidence, MemoryIndexStats, MemoryProjectInput } from '@/types/memory'

const props = defineProps<{ project: MemoryProjectInput | null; stats: MemoryIndexStats | null; throughChapterId: string; disabled: boolean; selectedEvidence?: MemoryEvidence | null }>()
const emit = defineEmits<{ 'refresh-required': [] }>()
const entityLabels = { person: '人物', event: '事件', object: '物件', place: '地点' } as const
const active = computed(() => !props.disabled && !!props.project && !!props.stats && props.project.id === props.stats.projectId && props.project.chapters.some(chapter => chapter.id === props.throughChapterId))
const document = shallowRef<FactGraphDocument | null>(null)
const loading = ref(false)
const saving = ref(false)
const extracting = ref(false)
const actionBusy = computed(() => saving.value || extracting.value)
const ready = computed(() => active.value && !!document.value && !loading.value)
const error = ref('')
const notice = ref('')
const graphQuery = ref('')
const selectedId = ref('')
const canvas = ref<HTMLDivElement>()
const canvasError = ref('')
const formOpen = ref(false)
const editingId = ref('')
const editingOrigin = ref<FactRelation['origin']>('explicit')
const editingCreatedBy = ref<FactRelation['createdBy']>('author')
const anchorChapterId = ref('')
const quoteInput = ref('')
const quoteStart = ref(0)
const anchors = ref<FactAnchor[]>([])
const proposals = ref<FactRelation[]>([])
const form = reactive({ sourceLabel: '', sourceType: 'person' as FactEntity['type'], targetLabel: '', targetType: 'object' as FactEntity['type'], predicate: '' })
let cy: Core | undefined
let resizeObserver: ResizeObserver | undefined
let themeObserver: MutationObserver | undefined
let controller: AbortController | undefined
let generation = 0
let renderGeneration = 0
let disposed = false

const selectionState = computed(() => {
  try {
    return { value: ready.value && props.project && props.stats && document.value
      ? selectFactGraph(props.project, props.stats, document.value, props.throughChapterId, graphQuery.value)
      : { relations: [], nodes: [], truncated: false }, error: '' }
  } catch (cause) { return { value: { relations: [], nodes: [], truncated: false }, error: messageOf(cause) } }
})
const selection = computed(() => selectionState.value.value)
const selectionError = computed(() => selectionState.value.error)
const selected = computed(() => selection.value.relations.find(relation => relation.id === selectedId.value))
const disclosedChapters = computed(() => {
  if (!active.value || !props.project) return []
  const through = props.project.chapters.findIndex(chapter => chapter.id === props.throughChapterId)
  return through < 0 ? [] : props.project.chapters.slice(0, through + 1)
})
const anchorChapter = computed(() => disclosedChapters.value.find(chapter => chapter.id === anchorChapterId.value))
function typeLabel(type: FactEntity['type']) { return entityLabels[type] }
function originLabel(origin: FactRelation['origin']) { return origin === 'inferred' ? '模型推断' : '原文明示' }
function statusLabel(relation: FactRelation) { return relation.authorConfirmed ? '作者确认' : relation.origin === 'inferred' ? '模型推断' : relation.createdBy === 'model' ? '原文明示（模型标注，待核对）' : '原文明示' }
function messageOf(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }
function chapterOrdinal(id: string) { return (props.project?.chapters.findIndex(chapter => chapter.id === id) ?? -1) + 1 }
function chapterTitle(id: string) { return disclosedChapters.value.find(chapter => chapter.id === id)?.title ?? '' }
function edgeId(id: string) { return `relation:${JSON.stringify(id)}` }
function selectRelation(id: string) { selectedId.value = id; cy?.elements().unselect(); cy?.getElementById(edgeId(id)).select() }
function fitGraph() { cy?.resize(); cy?.fit(undefined, 40) }
function destroyGraph() { renderGeneration += 1; resizeObserver?.disconnect(); resizeObserver = undefined; cy?.destroy(); cy = undefined }
function invalidate() {
  generation += 1
  controller?.abort()
  controller = undefined
  extracting.value = false
  saving.value = false
  selectedId.value = ''
  proposals.value = []
  formOpen.value = false
  anchors.value = []
  destroyGraph()
}

async function loadDocument() {
  if (!active.value || !props.project) return
  const token = generation
  const id = props.project.id
  loading.value = true
  error.value = ''
  try {
    let value = await readFactGraph(id)
    if (!value.revision && id === 'memory-demo') value = await createDemoFactGraph(await createMemoryDemo())
    if (disposed || generation !== token || !active.value || props.project?.id !== id) return
    document.value = value
  } catch (cause) {
    if (generation === token && !disposed) { document.value = null; error.value = `关系记录读取失败：${messageOf(cause)}。已有记录不会被覆盖。` }
  } finally { if (generation === token) loading.value = false }
}

watch(() => [active.value, props.project, props.stats?.fingerprint, props.throughChapterId], () => {
  invalidate()
  document.value = null
  loading.value = false
  notice.value = ''
  if (active.value) void loadDocument()
}, { flush: 'sync', immediate: true })
watch(graphQuery, () => { selectedId.value = '' })
watch(() => [selection.value, canvas.value], () => { void renderGraph() }, { flush: 'post' })

function graphStyles(): StylesheetJson {
  const text = canvas.value ? getComputedStyle(canvas.value).getPropertyValue('--el-text-color-primary').trim() || '#303133' : '#303133'
  return [
    { selector: 'node', style: { label: 'data(label)', color: text, 'font-size': 12, 'text-valign': 'bottom', 'text-margin-y': 7, 'text-wrap': 'wrap', 'text-max-width': '120px', width: 32, height: 32, 'background-color': '#409eff' } },
    { selector: 'node[type="event"]', style: { shape: 'diamond', 'background-color': '#9c6ade' } },
    { selector: 'node[type="object"]', style: { shape: 'round-rectangle', 'background-color': '#e6a23c' } },
    { selector: 'node[type="place"]', style: { shape: 'hexagon', 'background-color': '#16a394' } },
    { selector: 'edge', style: { label: 'data(label)', 'text-events': 'yes', width: 2, 'line-color': '#8592a3', 'target-arrow-color': '#8592a3', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', color: text, 'font-size': 11, 'text-wrap': 'wrap', 'text-max-width': '150px', 'text-background-color': canvas.value ? getComputedStyle(canvas.value).getPropertyValue('--el-bg-color').trim() || '#fff' : '#fff', 'text-background-opacity': 0.9, 'text-background-padding': '3px' } },
    { selector: 'edge[origin="inferred"]', style: { 'line-style': 'dashed' } },
    { selector: 'edge[confirmed="yes"]', style: { width: 4, 'line-color': '#3c9a53', 'target-arrow-color': '#3c9a53' } },
    { selector: 'edge:selected', style: { width: 5, 'line-color': '#409eff', 'target-arrow-color': '#409eff' } },
  ]
}

async function renderGraph() {
  const renderToken = ++renderGeneration
  const element = canvas.value
  if (!ready.value || !element) { destroyGraph(); return }
  const graph = selection.value
  try {
    const { default: cytoscape } = await import('cytoscape')
    if (disposed || renderGeneration !== renderToken || !ready.value || element !== canvas.value) return
    resizeObserver?.disconnect()
    cy?.destroy()
    const elements: ElementDefinition[] = [
      ...graph.nodes.map(node => ({ data: { id: node.id, label: node.label, type: node.type } })),
      ...graph.relations.map(relation => ({ data: { id: edgeId(relation.id), relationId: relation.id, source: factEntityId(relation.source), target: factEntityId(relation.target), label: relation.predicate, origin: relation.origin, confirmed: relation.authorConfirmed ? 'yes' : 'no' } })),
    ]
    // The canvas is wide: automatic grid dimensions otherwise collapse several
    // distinct relationships onto one row, hiding long-edge labels under nodes.
    cy = cytoscape({ container: element, elements, style: graphStyles(), layout: { name: 'grid', cols: Math.max(1, Math.ceil(Math.sqrt(graph.nodes.length))), padding: 40, avoidOverlap: true, condense: false }, minZoom: 0.15, maxZoom: 2.5, wheelSensitivity: 0.25 })
    cy.on('tap', 'edge', event => { selectRelation(event.target.data('relationId')) })
    cy.on('tap', event => { if (event.target === cy) selectedId.value = '' })
    if (selectedId.value) cy.getElementById(edgeId(selectedId.value)).select()
    resizeObserver = new ResizeObserver(() => { cy?.resize() })
    resizeObserver.observe(element)
    canvasError.value = ''
  } catch (cause) { if (renderGeneration === renderToken) canvasError.value = messageOf(cause) }
}

function resetQuote() { quoteInput.value = ''; quoteStart.value = 0 }
function locateQuote() { quoteStart.value = Math.max(0, anchorChapter.value?.text.indexOf(quoteInput.value) ?? 0) }
function closeForm() { formOpen.value = false; proposals.value = []; anchors.value = [] }
function createRelation() {
  if (!ready.value || actionBusy.value) return
  error.value = ''; notice.value = ''; editingId.value = ''; editingOrigin.value = 'explicit'; editingCreatedBy.value = 'author'
  Object.assign(form, { sourceLabel: '', sourceType: 'person', targetLabel: '', targetType: 'object', predicate: '' })
  anchors.value = []; proposals.value = []; anchorChapterId.value = disclosedChapters.value[0]?.id ?? ''; resetQuote(); formOpen.value = true
}
function addAnchor() {
  const chapter = anchorChapter.value
  const manifest = props.stats?.chapters.find(item => item.id === chapter?.id)
  const quote = quoteInput.value
  if (!chapter || !manifest || !quote || quote.length > 2000 || !Number.isInteger(quoteStart.value) || quoteStart.value < 0 || chapter.text.slice(quoteStart.value, quoteStart.value + quote.length) !== quote) {
    error.value = '片段须与所选章节的原文及起点完全一致。请复制原文并检查位置。'; return
  }
  if (anchors.value.length >= 8) { error.value = '一条关系最多使用 8 条依据。'; return }
  const anchor: FactAnchor = { chapterId: chapter.id, sourceRevision: manifest.revision, start: quoteStart.value, end: quoteStart.value + quote.length, quote }
  if (!anchors.value.some(item => item.chapterId === anchor.chapterId && item.start === anchor.start && item.end === anchor.end)) anchors.value.push(anchor)
  proposals.value = []; error.value = ''
}
function removeAnchor(index: number) { anchors.value.splice(index, 1); proposals.value = [] }
function useSearchEvidence() {
  const hit = props.selectedEvidence
  if (!hit || !ready.value || actionBusy.value || !props.project || !props.stats) return
  const cutoff = props.project.chapters.findIndex(chapter => chapter.id === props.throughChapterId)
  const ordinal = props.project.chapters.findIndex(chapter => chapter.id === hit.chapterId)
  const chapter = props.project.chapters[ordinal]
  const revision = props.stats.chapters.find(item => item.id === hit.chapterId)?.revision
  if (ordinal < 0 || ordinal > cutoff || hit.projectId !== props.project.id || revision !== hit.revision || chapter?.text.slice(hit.start, hit.end) !== hit.quote) return
  createRelation()
  anchorChapterId.value = hit.chapterId; quoteInput.value = hit.quote.slice(0, 2000); quoteStart.value = hit.start
  addAnchor()
}
function editRelation() {
  const relation = selected.value
  if (!relation || actionBusy.value) return
  createRelation()
  editingId.value = relation.id; editingOrigin.value = relation.origin; editingCreatedBy.value = relation.createdBy
  Object.assign(form, { sourceLabel: relation.source.label, sourceType: relation.source.type, targetLabel: relation.target.label, targetType: relation.target.type, predicate: relation.predicate })
  anchors.value = relation.evidence.map(({ chapterId, sourceRevision, start, end, quote }) => ({ chapterId, sourceRevision, start, end, quote }))
  anchorChapterId.value = relation.evidence[0]?.chapterId ?? anchorChapterId.value
}

function sameSource(left: MemoryProjectInput, right: MemoryProjectInput) {
  return left.id === right.id && left.title === right.title && left.chapters.length === right.chapters.length && left.chapters.every((chapter, index) => {
    const other = right.chapters[index]
    return !!other && chapter.id === other.id && chapter.title === other.title && chapter.text === other.text
  })
}
async function freshSource(token: number) {
  const snapshot = props.project
  if (!ready.value || !snapshot || token !== generation) throw new Error('正文状态已变化，请刷新后重试')
  let fresh: MemoryProjectInput
  try { fresh = snapshot.id === 'memory-demo' ? await readMemoryDemo() : await readMemoryNovel(snapshot.id) }
  catch (cause) { if (!disposed && token === generation) emit('refresh-required'); throw cause }
  if (disposed || token !== generation || !ready.value || props.project !== snapshot) throw new Error('正文状态已变化，请刷新后重试')
  if (!sameSource(snapshot, fresh)) { emit('refresh-required'); throw new Error('已保存正文已变化，旧关系已隐藏；请刷新正文后重试') }
  return snapshot
}
async function persist(next: FactRelation[], success: string) {
  if (!ready.value || !document.value || actionBusy.value) return false
  const token = generation
  const previous = document.value
  saving.value = true; error.value = ''; notice.value = ''
  try {
    await freshSource(token)
    const value = await saveFactGraph({ ...previous, relations: next }, previous.revision || null)
    if (disposed || token !== generation || !ready.value) return false
    await freshSource(token)
    if (disposed || token !== generation) return false
    document.value = value; notice.value = success
    return true
  } catch (cause) {
    if (!disposed && token === generation) error.value = `${messageOf(cause)}。如在其他窗口编辑过关系，请刷新后重试。`
    return false
  } finally { if (generation === token) saving.value = false }
}
async function saveManual() {
  const previous = document.value
  if (!previous || !anchors.value.length) return
  const relation: FactRelation = { id: editingId.value || crypto.randomUUID(), projectId: previous.projectId, source: { label: form.sourceLabel.trim(), type: form.sourceType }, target: { label: form.targetLabel.trim(), type: form.targetType }, predicate: form.predicate.trim(), origin: editingOrigin.value, createdBy: editingCreatedBy.value, authorConfirmed: false, evidence: anchors.value.map(anchor => ({ ...anchor })) }
  if (!relation.source.label || !relation.target.label || !relation.predicate || !relation.evidence.some(anchor => anchor.quote.includes(relation.source.label)) || !relation.evidence.some(anchor => anchor.quote.includes(relation.target.label))) { error.value = '请填写关系描述，并确保起点与终点名称均出现在所选原文依据中。'; return }
  if (!props.project || !props.stats || !resolveFactAnchors(props.project, props.stats, props.throughChapterId, relation.evidence)) { error.value = '原文依据已失效，请重新选择当前披露范围内的原文。'; return }
  if (!isVisibleCandidate(relation)) return
  const next = [...previous.relations.filter(item => item.id !== relation.id), relation]
  if (await persist(next, '关系已保存。可在依据面板完成作者确认。')) { closeForm(); graphQuery.value = ''; await nextTick(); selectRelation(relation.id) }
}
async function confirmRelation() {
  const relation = selected.value
  if (!relation || relation.authorConfirmed || !document.value) return
  await persist(document.value.relations.map(item => item.id === relation.id ? { ...item, authorConfirmed: true } : item), '作者确认已保存，原始来源类型保留。')
}
async function deleteRelation() {
  const relation = selected.value
  if (!relation || !document.value) return
  if (await persist(document.value.relations.filter(item => item.id !== relation.id), '关系已删除。正文保持不变。')) selectedId.value = ''
}
async function extract() {
  if (!ready.value || actionBusy.value || !props.stats || !anchors.value.length) return
  const token = generation
  const evidence = anchors.value.map(anchor => ({ ...anchor }))
  const stats = props.stats
  const throughChapterId = props.throughChapterId
  controller = new AbortController()
  const signal = controller.signal
  extracting.value = true; proposals.value = []; error.value = ''; notice.value = ''
  try {
    const project = await freshSource(token)
    const result = await extractFactRelations({ project, stats, throughChapterId, evidence, signal })
    if (disposed || signal.aborted || generation !== token) return
    await freshSource(token)
    if (disposed || signal.aborted || generation !== token) return
    proposals.value = result
    notice.value = result.length ? '提议尚未保存。请核对每条关系及其原文依据。' : '模型未提出有效关系。可换用更明确的片段，或手动添加。'
  } catch (cause) { if (!disposed && generation === token && !signal.aborted) error.value = `提议失败：${messageOf(cause)}` }
  finally { if (generation === token && controller?.signal === signal) { extracting.value = false; controller = undefined } }
}
function cancelExtraction() { controller?.abort(); controller = undefined; extracting.value = false; proposals.value = []; notice.value = '已取消模型提议。' }
async function acceptProposal(proposal: FactRelation) {
  if (!document.value || !isVisibleCandidate(proposal)) return
  if (await persist([...document.value.relations, proposal], '模型提议已保存，尚未经作者确认。')) { proposals.value = proposals.value.filter(item => item.id !== proposal.id); graphQuery.value = ''; await nextTick(); selectRelation(proposal.id) }
}
function isVisibleCandidate(relation: FactRelation) {
  try {
    if (!ready.value || !document.value || !props.project || !props.stats || selectFactGraph(props.project, props.stats, { ...document.value, relations: [relation] }, props.throughChapterId).relations.length !== 1) throw new Error('关系名称或原文依据与当前披露范围不符，请重新选择原文')
    return true
  } catch (cause) { error.value = messageOf(cause); return false }
}
async function refreshOnFocus() {
  if (!active.value || !props.project) return
  const snapshot = props.project
  invalidate(); document.value = null; loading.value = true
  const token = generation
  try {
    const fresh = snapshot.id === 'memory-demo' ? await readMemoryDemo() : await readMemoryNovel(snapshot.id)
    if (disposed || token !== generation || !active.value) return
    if (!sameSource(snapshot, fresh)) { emit('refresh-required'); return }
    await loadDocument()
  } catch (cause) { if (!disposed && token === generation) error.value = `关系刷新失败：${messageOf(cause)}` }
  finally { if (token === generation) loading.value = false }
}
onMounted(() => {
  window.addEventListener('focus', refreshOnFocus)
  themeObserver = new MutationObserver(() => { cy?.style(graphStyles()) })
  themeObserver.observe(window.document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
})
onUnmounted(() => { disposed = true; invalidate(); themeObserver?.disconnect(); window.removeEventListener('focus', refreshOnFocus) })
</script>

<style scoped>
.fact-panel { background: var(--el-bg-color); border: 1px solid var(--el-border-color-light); border-radius: 12px; padding: 20px; margin-bottom: 18px; min-width: 0; }
h2 { margin: 0; font-size: 18px; } h3 { margin: 0 0 12px; font-size: 15px; } h4 { font-size: 14px; margin: 0 0 12px; }
p { line-height: 1.7; } .muted, .legend { color: var(--el-text-color-secondary); font-size: 13px; } .empty { text-align: center; padding: 20px; color: var(--el-text-color-secondary); font-size: 14px; } .warning { color: var(--el-color-warning-dark-2); font-size: 13px; } .error { color: var(--el-color-danger); background: var(--el-color-danger-light-9); border-radius: 6px; padding: 12px; overflow-wrap: anywhere; font-size: 13px; }
.section-heading, .toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }.section-heading { justify-content: space-between; align-items: flex-start; }.section-heading p { margin-bottom: 0; }.toolbar { align-items: flex-end; margin: 12px 0; }
button { border: 1px solid var(--el-border-color); border-radius: 6px; padding: 8px 12px; color: var(--el-text-color-primary); background: var(--el-fill-color-blank); cursor: pointer; font: inherit; font-size: 13px; } button:hover:not(:disabled), button.selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); } button:disabled { opacity: 0.55; cursor: not-allowed; } button:focus-visible, input:focus, select:focus, textarea:focus { outline: 2px solid var(--el-color-primary-light-5); outline-offset: 2px; }
.field { display: flex; flex-direction: column; gap: 7px; min-width: 0; font-size: 13px; margin-bottom: 12px; } .graph-query { flex: 1; margin: 0; } input, select, textarea { color: var(--el-text-color-primary); background: var(--el-fill-color-blank); border: 1px solid var(--el-border-color); border-radius: 6px; padding: 9px 11px; font: inherit; width: 100%; box-sizing: border-box; } textarea { resize: vertical; line-height: 1.7; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 12px 0; }.person { color: #409eff; }.event { color: #9c6ade; }.object { color: #bc7c1c; }.place { color: #168477; }.confirmed { color: #3c9a53; font-weight: 600; }.graph-canvas { height: 360px; width: 100%; background: var(--el-fill-color-lighter); border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.graph-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; margin: 18px 0; align-items: start; }.relation-list { max-height: 650px; overflow-y: auto; padding: 3px; }.relation-row { display: flex; flex-direction: column; gap: 8px; width: 100%; margin-bottom: 9px; text-align: left; padding: 12px; overflow-wrap: anywhere; }.relation-meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--el-text-color-secondary); }.relation-evidence { min-width: 0; padding: 14px; border: 1px solid var(--el-border-color-light); border-radius: 8px; font-size: 13px; }.relationship { overflow-wrap: anywhere; }.anchor-evidence { border-top: 1px solid var(--el-border-color-light); padding-top: 14px; margin-top: 16px; } dl { display: grid; grid-template-columns: 65px minmax(0, 1fr); gap: 8px; font-size: 12px; line-height: 1.7; } dt { color: var(--el-text-color-secondary); } dd { margin: 0; overflow-wrap: anywhere; } blockquote { margin: 8px 0; border-left: 3px solid var(--el-color-primary); background: var(--el-fill-color-light); padding: 10px 13px; white-space: pre-wrap; line-height: 1.8; font-size: 13px; overflow-wrap: anywhere; }
.relation-form { border-top: 1px solid var(--el-border-color-light); margin-top: 20px; padding-top: 20px; }.relation-form fieldset { min-width: 0; border: 1px solid var(--el-border-color-light); border-radius: 8px; margin: 16px 0; padding: 16px; }.relation-form legend { font-size: 14px; padding: 0 6px; }.entity-fields { display: grid; grid-template-columns: minmax(0, 1fr) 110px minmax(0, 1fr) 110px; gap: 12px; }.source-text { max-height: 260px; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 13px; line-height: 1.8; background: var(--el-fill-color-light); padding: 12px; } summary { cursor: pointer; font-size: 13px; margin: 10px 0; }.chosen-anchors article, .proposal { margin-top: 12px; padding: 12px; border: 1px solid var(--el-border-color-light); border-radius: 6px; }.chosen-anchors p { margin: 0; font-size: 13px; }.chosen-anchors button { margin-left: 12px; padding: 4px 8px; }.model-actions > button { margin-right: 10px; }
@media (max-width: 850px) { .fact-panel { padding: 16px; }.graph-layout { grid-template-columns: 1fr; }.entity-fields { grid-template-columns: minmax(0, 1fr) 100px; }.graph-canvas { height: 300px; } }
@media (max-width: 480px) {
  .fact-panel { padding: 12px; }
  .entity-fields { grid-template-columns: minmax(0, 1fr); }
  .graph-query { flex-basis: 100%; }
  .toolbar > .field { width: 100%; }
  button, input, select { min-height: 44px; }
  input, select, textarea { font-size: 16px; }
  .relation-form fieldset { padding: 10px; }
  .relation-evidence { padding: 10px; }
  .chosen-anchors article { padding: 8px; }
  .model-actions > button { margin-bottom: 8px; }
}
</style>
