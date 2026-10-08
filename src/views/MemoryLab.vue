<template>
  <main class="memory-lab" aria-labelledby="memory-title">
    <header class="lab-header">
      <div>
        <p class="eyebrow">第三阶段 · 验收原型</p>
        <h1 id="memory-title">记忆检索原型</h1>
        <p class="muted">关键词与人工标记伏笔可在本地检索；按需开启语义召回和重排，所有结果均可核对章节原文。</p>
      </div>
      <el-tag type="info" effect="plain">原文依据可核查</el-tag>
    </header>

    <section class="lab-card source-card" aria-label="检索来源">
      <div class="control-row">
        <label class="field source-field">
          <span>素材来源</span>
          <select v-model="sourceId" data-testid="memory-source" :disabled="busy || dirty" @change="changeSource">
            <option value="memory-demo">内置示例 · 80 章</option>
            <option v-for="novel in novelChoices" :key="novel.id" :value="novel.id">{{ novel.title }}（只读）</option>
          </select>
        </label>
        <el-button data-testid="memory-refresh" :disabled="busy || dirty" :loading="busy && operation === 'load'" @click="loadSource">刷新并重建</el-button>
      </div>
      <p class="muted source-note">{{ isDemo ? '示例单独保存，可自由改写；不会修改你的小说。' : '真实小说仅读取已保存的正文；每次检索都会重新读取最新快照，不修改原小说。编辑器中未保存的改动不在此范围内。' }}</p>
      <p v-if="sourceRefreshNeeded" class="warning" role="status">作品可能已在其他窗口修改，旧结果已清除。重新检索或刷新即可读取最新正文。</p>
      <p v-if="choicesError" class="warning" role="status">{{ choicesError }} <button class="text-button" :disabled="busy" @click="loadChoices">重试小说列表</button></p>
      <div v-if="stats" class="stats" data-testid="memory-stats" aria-label="索引状态">
        <span><strong>{{ stats.chapters.length }}</strong> 章</span>
        <span><strong>{{ stats.chars.toLocaleString() }}</strong> 字符</span>
        <span><strong>{{ stats.chunks }}</strong> 原文块</span>
        <span><strong>{{ stats.clues }}</strong> 有效伏笔</span>
        <span>构建 {{ stats.buildMs.toFixed(1) }} ms</span>
      </div>
      <p v-if="stats?.staleClues" class="warning" data-testid="memory-stale-clues">{{ stats.staleClues }} 条伏笔的原文版本已失效，已从检索中排除。原文仍可按关键词检索。</p>
    </section>

    <div v-if="error" class="error-box" role="alert" data-testid="memory-error">
      <span>{{ error }}</span>
      <el-button size="small" :disabled="busy || dirty" @click="loadSource">重试加载</el-button>
    </div>

    <section class="lab-card" aria-label="检索设置">
      <details class="provider-settings" data-testid="memory-provider-settings">
        <summary>可选语义召回与重排 <span class="muted">默认关闭</span></summary>
        <p class="muted">设置与密钥仅保留在当前页面内存，离开或刷新页面即清除，不写入浏览器存储或小说备份。修改设置会清除当前结果和向量缓存。</p>
        <p class="warning">开启后，点击检索会将查询及已披露范围内的正文片段发送给所填服务，可能产生费用。服务须支持浏览器跨域请求（CORS）。后续章节不会发送。</p>
        <div class="provider-grid">
          <fieldset :disabled="busy">
            <legend>语义召回</legend>
            <label class="toggle-field"><input v-model="providers.embeddingEnabled" data-testid="memory-embedding-enabled" type="checkbox" />启用嵌入模型</label>
            <div v-if="providers.embeddingEnabled" class="provider-fields">
              <label class="field"><span>访问格式</span><select v-model="providers.embedding.protocol" data-testid="memory-embedding-protocol"><option value="jina">Jina</option><option value="openai-compatible">OpenAI 兼容</option></select></label>
              <label class="field"><span>嵌入 API 完整地址</span><input v-model="providers.embedding.endpoint" data-testid="memory-embedding-endpoint" type="url" autocomplete="off" spellcheck="false" /></label>
              <label class="field"><span>嵌入模型</span><input v-model="providers.embedding.model" data-testid="memory-embedding-model" autocomplete="off" spellcheck="false" /></label>
              <label class="field"><span>API 密钥</span><input v-model="providers.embedding.apiKey" data-testid="memory-embedding-key" type="password" autocomplete="off" spellcheck="false" placeholder="仅本页面使用" /></label>
              <label class="field"><span>输出维度（须与模型支持值一致）</span><input v-model.number="providers.embedding.dimensions" data-testid="memory-embedding-dimensions" type="number" min="1" max="4096" step="1" /></label>
            </div>
          </fieldset>
          <fieldset :disabled="busy">
            <legend>候选重排</legend>
            <label class="toggle-field"><input v-model="providers.rerankEnabled" data-testid="memory-rerank-enabled" type="checkbox" />启用重排模型</label>
            <div v-if="providers.rerankEnabled" class="provider-fields">
              <p class="muted provider-description">支持 Jina /rerank 请求格式，可独立用于关键词与伏笔结果。</p>
              <label class="field"><span>重排 API 完整地址</span><input v-model="providers.rerank.endpoint" data-testid="memory-rerank-endpoint" type="url" autocomplete="off" spellcheck="false" /></label>
              <label class="field"><span>重排模型</span><input v-model="providers.rerank.model" data-testid="memory-rerank-model" autocomplete="off" spellcheck="false" /></label>
              <label class="field"><span>API 密钥</span><input v-model="providers.rerank.apiKey" data-testid="memory-rerank-key" type="password" autocomplete="off" spellcheck="false" placeholder="仅本页面使用" /></label>
            </div>
          </fieldset>
        </div>
        <div class="control-row cache-actions">
          <el-button size="small" data-testid="memory-clear-cache" :disabled="busy" @click="clearCache">清除本页向量缓存</el-button>
          <span class="muted">地址或访问格式变更时会清空对应密钥，请重新填写。</span>
        </div>
      </details>
      <div class="control-row search-row">
        <label class="field query-field">
          <span>检索内容</span>
          <input v-model="query" data-testid="memory-query" type="search" placeholder="例如：钥匙、接应信号、玄衣客 真名" :disabled="busy" @input="invalidateResults" @keydown.enter.prevent="search" />
        </label>
        <label class="field cutoff-field">
          <span>已披露至（含本章）</span>
          <select v-model="cutoffId" data-testid="memory-cutoff" :disabled="busy || !project" @change="invalidateResults">
            <option v-if="project?.chapters.length && !cutoffId" disabled value="">请选择已披露截止章节</option>
            <option v-for="(chapter, index) in project?.chapters ?? []" :key="chapter.id" :value="chapter.id">{{ index + 1 }} · {{ chapter.title }}</option>
          </select>
        </label>
        <el-button type="primary" data-testid="memory-search" :disabled="!canSearch" :loading="busy && operation === 'search'" @click="search">检索</el-button>
        <el-button v-if="busy && operation === 'search'" data-testid="memory-cancel" @click="cancelSearch">取消检索</el-button>
      </div>
      <p class="muted">截止章节按正文排列顺序判断。后续章节不会进入候选结果或依据面板。</p>
      <p v-if="project?.chapters.length && !cutoffId" class="warning" data-testid="memory-cutoff-required" role="status">原截止章节已不存在，请重新选择已披露范围。系统不会自动开放后续章节。</p>
      <div v-if="isDemo" class="shortcuts" aria-label="三项验收快捷检索">
        <span class="muted">试一试</span>
        <el-button size="small" data-testid="memory-shortcut-old" :disabled="busy || dirty || !project" @click="runShortcut('钥匙', 'c10')">查旧章事实</el-button>
        <el-button size="small" data-testid="memory-shortcut-clue" :disabled="busy || dirty || !project" @click="runShortcut('接应信号', 'c40')">找回伏笔</el-button>
        <el-button size="small" data-testid="memory-shortcut-future" :disabled="busy || dirty || !project" @click="runShortcut('玄衣客 真名', 'c10')">检查未来身份</el-button>
      </div>
      <p v-if="providerNotice" class="muted" role="status">{{ providerNotice }}</p>
    </section>

    <div class="results-layout">
      <section class="lab-card results-card" aria-labelledby="results-title" data-testid="memory-results" aria-live="polite">
        <div class="section-heading">
          <h2 id="results-title">检索结果</h2>
          <span v-if="result" class="muted">{{ result.hits.length }} 条 · {{ result.searchMs.toFixed(1) }} ms</span>
        </div>
        <div v-if="result" class="retrieval-status" data-testid="memory-retrieval-status" role="status">
          <p>语义召回：{{ semanticStatus }} · 候选重排：{{ rerankStatus }}</p>
          <p class="muted">披露范围内 {{ result.diagnostics.eligiblePassages }} 个原文块 · 本次新嵌入 {{ result.diagnostics.embeddedPassages }} 个 · 复用缓存 {{ result.diagnostics.cachedPassages }} 个 · 已重排 {{ result.diagnostics.rerankedCandidates }} 条候选</p>
          <p v-for="(warning, index) in result.diagnostics.warnings" :key="index" class="warning" data-testid="memory-retrieval-warning">{{ warning }}</p>
        </div>
        <p v-if="busy" class="empty-state">{{ operation === 'search' ? '正在读取最新正文并检索…' : '正在构建本地索引…' }}</p>
        <p v-else-if="dirty" class="empty-state">示例有未保存修改。保存并重建后再检索，旧结果已清除。</p>
        <p v-else-if="!result" class="empty-state">输入内容并检索，或使用上方的验收示例。</p>
        <p v-else-if="!result.hits.length" class="empty-state" data-testid="memory-no-results">当前披露范围内没有匹配依据。可调整关键词或截止章节。</p>
        <button v-for="(hit, index) in result?.hits ?? []" :key="hit.id" class="result-item" :class="{ selected: selectedId === hit.id }" :data-testid="`memory-result-${index}`" :aria-pressed="selectedId === hit.id" @click="selectedId = hit.id">
          <span class="result-meta"><el-tag size="small" :type="hit.kind === 'clue' ? 'warning' : 'info'">{{ hit.kind === 'clue' ? '人工标记伏笔' : '原文片段' }}</el-tag><span>第 {{ hit.ordinal }} 章</span><code>{{ hit.revision.slice(0, 10) }}</code></span>
          <strong>{{ hit.chapterTitle }}</strong>
          <span v-if="hit.label" class="hit-label">{{ hit.label }}</span>
          <span class="quote">{{ hit.quote }}</span>
          <span class="muted hit-reason">{{ hit.reason }}</span>
        </button>
      </section>

      <aside class="lab-card evidence-card" aria-labelledby="evidence-title" data-testid="memory-evidence">
        <h2 id="evidence-title">依据面板</h2>
        <p v-if="!evidence" class="empty-state">选择一条结果，核对原文与版本。</p>
        <template v-else>
          <p class="evidence-heading">第 {{ evidence.hit.ordinal }} 章 · {{ evidence.chapter.title }}</p>
          <dl class="evidence-details">
            <dt>依据类型</dt><dd>{{ evidence.hit.kind === 'clue' ? '作者标记，引用来自原文' : '原文明示片段' }}</dd>
            <dt>匹配原因</dt><dd>{{ evidence.hit.reason }}</dd>
            <dt>原文位置</dt><dd>{{ evidence.hit.start }}–{{ evidence.hit.end }}（UTF-16，左闭右开）</dd>
            <dt>章节版本</dt><dd><code data-testid="memory-evidence-revision">{{ evidence.hit.revision }}</code></dd>
          </dl>
          <h3>精确引用</h3>
          <blockquote data-testid="memory-evidence-quote">{{ evidence.hit.quote }}</blockquote>
          <h3>所在章节原文</h3>
          <pre class="source-text" data-testid="memory-evidence-source"><span>{{ evidence.before }}</span><mark>{{ evidence.hit.quote }}</mark><span>{{ evidence.after }}</span></pre>
        </template>
      </aside>
    </div>

    <FactGraphPanel :project="project" :stats="stats" :through-chapter-id="cutoffId" :disabled="busy || dirty || !stats" :selected-evidence="evidence?.hit" @refresh-required="invalidateGraphSource" />

    <section v-if="isDemo" class="lab-card demo-editor" aria-labelledby="editor-title">
      <div class="section-heading">
        <h2 id="editor-title">示例素材编辑</h2>
        <el-button data-testid="memory-reset-demo" :disabled="busy" @click="resetDemo">重置示例</el-button>
      </div>
      <p class="muted">可查看和修改全部示例章。试着将第一章的“银钥匙”改为“铜钥匙”，保存后查询旧事实；修改带伏笔的原文会使其旧标记失效。</p>
      <template v-if="project">
        <label class="field">
          <span>编辑示例章节</span>
          <select v-model="editChapterId" data-testid="memory-edit-chapter" :disabled="busy">
            <option v-for="(chapter, index) in project.chapters" :key="chapter.id" :value="chapter.id">{{ index + 1 }} · {{ chapter.title }}{{ Object.hasOwn(drafts, chapter.id) ? '（已修改）' : '' }}</option>
          </select>
        </label>
        <label class="field editor-field"><span>示例章节正文</span><textarea v-model="editorText" data-testid="memory-chapter-editor" rows="7" :disabled="busy" /></label>
        <div class="control-row">
          <el-button type="primary" data-testid="memory-save-demo" :disabled="busy || !dirty" :loading="busy && operation === 'save'" @click="saveDemo">保存示例并重建</el-button>
          <el-button :disabled="busy || !dirty" @click="discardEdits">撤销未保存编辑</el-button>
          <span v-if="dirty" class="warning" role="status">{{ Object.keys(drafts).length }} 章待保存</span>
        </div>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import FactGraphPanel from '@/components/memory/FactGraphPanel.vue'
import { MemoryClient } from '@/services/memory/client'
import { createMemoryDemo, readMemoryDemo, readMemoryNovel, readMemoryNovelChoices, saveMemoryDemo } from '@/services/memory/labData'
import type { MemoryIndexStats, MemoryProjectInput, MemoryRemoteOptions, MemorySearchResult } from '@/types/memory'

const sourceId = ref('memory-demo')
const novelChoices = ref<{ id: string; title: string }[]>([])
const project = shallowRef<MemoryProjectInput | null>(null)
const stats = shallowRef<MemoryIndexStats | null>(null)
const result = shallowRef<MemorySearchResult | null>(null)
const selectedId = ref('')
const query = ref('钥匙')
const cutoffId = ref('c10')
const editChapterId = ref('c1')
const drafts = ref<Record<string, string>>({})
const busy = ref(false)
const operation = ref<'load' | 'search' | 'save'>('load')
const error = ref('')
const choicesError = ref('')
const sourceRefreshNeeded = ref(false)
const providerNotice = ref('')
// Intentionally route-scoped: neither configurations nor credentials are persisted.
const providers = reactive({
  embeddingEnabled: false,
  rerankEnabled: false,
  embedding: {
    protocol: 'jina' as 'jina' | 'openai-compatible',
    endpoint: 'https://api.jina.ai/v1/embeddings',
    model: 'jina-embeddings-v3',
    apiKey: '',
    dimensions: 512,
  },
  rerank: {
    endpoint: 'https://api.jina.ai/v1/rerank',
    model: 'jina-reranker-v2-base-multilingual',
    apiKey: '',
  },
})
const isDemo = computed(() => sourceId.value === 'memory-demo')
const dirty = computed(() => Object.keys(drafts.value).length > 0)
const canSearch = computed(() => Boolean(project.value && cutoffId.value && query.value.trim() && !busy.value && !dirty.value))
let client: MemoryClient | undefined
let generation = 0
let disposed = false
let disclosureSourceId: string | null = null

const semanticStatus = computed(() => ({ disabled: '未启用（本地检索）', used: '已参与混合检索', fallback: '不可用，已回退至本地检索' })[result.value?.diagnostics.semantic ?? 'disabled'])
const rerankStatus = computed(() => ({ disabled: '未启用', used: '已完成', fallback: '不可用，保留召回顺序', skipped: '无需重排，未调用服务' })[result.value?.diagnostics.rerank ?? 'disabled'])

function remoteOptions(): MemoryRemoteOptions {
  return {
    ...(providers.embeddingEnabled ? { embedding: { ...providers.embedding } } : {}),
    ...(providers.rerankEnabled ? { rerank: { ...providers.rerank } } : {}),
  }
}

function getClient() {
  client ??= new MemoryClient()
  return client
}

function clearResults() {
  result.value = null
  selectedId.value = ''
}

function invalidateResults() {
  generation += 1
  clearResults()
}

function resetRetrieval() {
  invalidateResults()
  client?.dispose()
  client = undefined
  stats.value = null
  busy.value = false
}

watch(() => [providers.embedding.endpoint, providers.embedding.protocol], () => {
  providers.embedding.apiKey = ''
}, { flush: 'sync' })
watch(() => providers.rerank.endpoint, () => {
  providers.rerank.apiKey = ''
}, { flush: 'sync' })
watch(providers, () => {
  resetRetrieval()
  error.value = ''
  providerNotice.value = '设置已更改，旧结果与向量缓存已清除。下次检索将使用新设置。'
}, { deep: true, flush: 'sync' })

function clearCache() {
  if (busy.value) return
  resetRetrieval()
  providerNotice.value = '本页向量缓存和检索结果已清除。下次检索将重新构建。'
}

function cancelSearch() {
  if (!busy.value || operation.value !== 'search') return
  resetRetrieval()
  busy.value = false
  providerNotice.value = '检索已取消，结果与本页向量缓存已清除。'
}

const editorText = computed({
  get: () => drafts.value[editChapterId.value] ?? project.value?.chapters.find(chapter => chapter.id === editChapterId.value)?.text ?? '',
  set: (text: string) => {
    const original = project.value?.chapters.find(chapter => chapter.id === editChapterId.value)
    if (!original) return
    if (text === original.text) delete drafts.value[original.id]
    else drafts.value[original.id] = text
    invalidateResults()
  },
})

// Validate the selected quote against the current snapshot before exposing the full source.
const evidence = computed(() => {
  const snapshot = project.value
  const searchResult = result.value
  const index = stats.value
  if (!snapshot || !searchResult || !index || searchResult.projectId !== snapshot.id || searchResult.fingerprint !== index.fingerprint) return null
  const hit = searchResult.hits.find(item => item.id === selectedId.value)
  if (!hit || searchResult.throughChapterId !== cutoffId.value) return null
  const chapterIndex = snapshot.chapters.findIndex(chapter => chapter.id === hit.chapterId)
  const cutoffIndex = snapshot.chapters.findIndex(chapter => chapter.id === cutoffId.value)
  const chapter = snapshot.chapters[chapterIndex]
  const manifest = index.chapters.find(item => item.id === hit.chapterId)
  if (!chapter || chapterIndex > cutoffIndex || hit.projectId !== snapshot.id || manifest?.revision !== hit.revision || chapter.text.slice(hit.start, hit.end) !== hit.quote) return null
  return { hit, chapter, before: chapter.text.slice(0, hit.start), after: chapter.text.slice(hit.end) }
})

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

function startOperation(kind: typeof operation.value) {
  const token = ++generation
  busy.value = true
  operation.value = kind
  error.value = ''
  providerNotice.value = ''
  clearResults()
  return token
}

function isCurrent(token: number) {
  return !disposed && token === generation
}

function finishOperation(token: number) {
  if (isCurrent(token)) busy.value = false
}

function acceptSnapshot(snapshot: MemoryProjectInput, index: MemoryIndexStats) {
  const initialDisclosure = disclosureSourceId !== snapshot.id
  disclosureSourceId = snapshot.id
  project.value = snapshot
  stats.value = index
  sourceRefreshNeeded.value = false
  // Only a newly selected source gets a default. Losing an established boundary
  // must not silently disclose later chapters, including on repeated refreshes.
  if (!snapshot.chapters.some(chapter => chapter.id === cutoffId.value)) cutoffId.value = initialDisclosure ? snapshot.chapters[Math.min(9, snapshot.chapters.length - 1)]?.id ?? '' : ''
  if (!snapshot.chapters.some(chapter => chapter.id === editChapterId.value)) editChapterId.value = snapshot.chapters[0]?.id ?? ''
}

async function readSource(id: string) {
  return id === 'memory-demo' ? readMemoryDemo() : readMemoryNovel(id)
}

async function loadChoices() {
  try {
    const choices = await readMemoryNovelChoices()
    if (disposed) return
    novelChoices.value = choices
    choicesError.value = ''
  } catch (cause) {
    if (!disposed) choicesError.value = `小说列表读取失败：${messageOf(cause)}`
  }
}

async function loadSource() {
  if (busy.value || dirty.value) return
  const token = startOperation('load')
  const id = sourceId.value
  stats.value = null
  try {
    const snapshot = await readSource(id)
    if (!isCurrent(token)) return
    const index = await getClient().sync(snapshot)
    if (!isCurrent(token)) return
    acceptSnapshot(snapshot, index)
  } catch (cause) {
    if (isCurrent(token)) error.value = `读取或构建失败：${messageOf(cause)}。可重试；已保存的数据不会被自动覆盖。`
  } finally {
    finishOperation(token)
  }
}

function changeSource() {
  resetRetrieval()
  disclosureSourceId = null
  project.value = null
  stats.value = null
  drafts.value = {}
  sourceRefreshNeeded.value = false
  cutoffId.value = sourceId.value === 'memory-demo' ? 'c10' : ''
  editChapterId.value = 'c1'
  void loadSource()
}

async function search() {
  if (!canSearch.value) return
  const token = startOperation('search')
  const id = sourceId.value
  const text = query.value.trim()
  const throughChapterId = cutoffId.value
  const options = remoteOptions()
  try {
    // Always refresh persisted source, including real novels, before searching.
    const snapshot = await readSource(id)
    if (!isCurrent(token)) return
    const index = await getClient().sync(snapshot)
    if (!isCurrent(token)) return
    acceptSnapshot(snapshot, index)
    if (!snapshot.chapters.some(chapter => chapter.id === throughChapterId)) throw new Error('截止章节已删除或变更，请重新选择披露范围后检索')
    const response = await getClient().search({ text, throughChapterId, limit: 12 }, options)
    if (!isCurrent(token)) return
    result.value = response
  } catch (cause) {
    if (isCurrent(token)) {
      stats.value = null
      error.value = `检索失败：${messageOf(cause)}`
    }
  } finally {
    finishOperation(token)
  }
}

async function runShortcut(text: string, throughChapterId: string) {
  if (busy.value || dirty.value || !project.value) return
  query.value = text
  cutoffId.value = throughChapterId
  invalidateResults()
  await search()
}

async function saveDemo() {
  if (!isDemo.value || !project.value || busy.value || !dirty.value) return
  const snapshot: MemoryProjectInput = {
    ...project.value,
    chapters: project.value.chapters.map(chapter => ({ ...chapter, text: drafts.value[chapter.id] ?? chapter.text })),
  }
  const token = startOperation('save')
  stats.value = null
  try {
    await saveMemoryDemo(snapshot)
    if (!isCurrent(token)) return
    // Saving succeeded even if building subsequently fails; allow a read-only retry.
    project.value = snapshot
    drafts.value = {}
    const index = await getClient().sync(snapshot)
    if (isCurrent(token)) acceptSnapshot(snapshot, index)
  } catch (cause) {
    if (isCurrent(token)) error.value = `保存或构建失败：${messageOf(cause)}`
  } finally {
    finishOperation(token)
  }
}

async function resetDemo() {
  if (!isDemo.value || busy.value) return
  const token = startOperation('save')
  stats.value = null
  try {
    const snapshot = await createMemoryDemo()
    if (!isCurrent(token)) return
    await saveMemoryDemo(snapshot)
    if (!isCurrent(token)) return
    project.value = snapshot
    drafts.value = {}
    cutoffId.value = 'c10'
    editChapterId.value = 'c1'
    const index = await getClient().sync(snapshot)
    if (isCurrent(token)) acceptSnapshot(snapshot, index)
  } catch (cause) {
    if (isCurrent(token)) error.value = `重置失败：${messageOf(cause)}`
  } finally {
    finishOperation(token)
  }
}

function discardEdits() {
  drafts.value = {}
  invalidateResults()
}

function invalidateExternalSource() {
  if (isDemo.value || disposed) return
  invalidateGraphSource()
}

function invalidateGraphSource() {
  if (disposed) return
  invalidateResults()
  stats.value = null
  busy.value = false
  sourceRefreshNeeded.value = true
  // Keep only the worker's completed baseline. A fresh persisted-source sync
  // is still required before any search can expose evidence again.
  client?.invalidateSource()
}

function onStorage(event: StorageEvent) {
  if (event.key === 'novels' || event.key === null) invalidateExternalSource()
}

onMounted(() => {
  window.addEventListener('focus', invalidateExternalSource)
  window.addEventListener('storage', onStorage)
  void loadChoices()
  void loadSource()
})

onUnmounted(() => {
  disposed = true
  generation += 1
  client?.dispose()
  window.removeEventListener('focus', invalidateExternalSource)
  window.removeEventListener('storage', onStorage)
})
</script>

<style scoped>
.memory-lab { max-width: 1360px; margin: 0 auto; padding: 24px; color: var(--el-text-color-primary); }
.lab-header, .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.lab-header { align-items: flex-start; margin-bottom: 20px; }
.eyebrow { color: var(--el-color-primary); font-size: 12px; letter-spacing: 0.08em; margin: 0 0 8px; }
h1 { font-size: 26px; margin: 0 0 10px; }
h2 { font-size: 17px; margin: 0; }
h3 { font-size: 14px; margin: 20px 0 10px; }
.muted { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7; }
.lab-header .muted, .source-note { margin-bottom: 0; }
.lab-card { background: var(--el-bg-color); border: 1px solid var(--el-border-color-light); border-radius: 12px; padding: 20px; margin-bottom: 18px; min-width: 0; }
.control-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.field { display: flex; flex-direction: column; gap: 8px; font-size: 13px; min-width: 0; }
.source-field { flex: 1; max-width: 520px; }
.query-field { flex: 1 1 280px; }
.cutoff-field { flex: 0 1 300px; }
input, select, textarea { color: var(--el-text-color-primary); background: var(--el-fill-color-blank); border: 1px solid var(--el-border-color); border-radius: 6px; padding: 9px 11px; font: inherit; box-sizing: border-box; width: 100%; }
input:focus, select:focus, textarea:focus { outline: 2px solid var(--el-color-primary-light-5); outline-offset: 1px; }
input:disabled, select:disabled, textarea:disabled { opacity: 0.65; }
.control-row > .el-button { height: 36px; margin-left: 0; }
.provider-settings { border-bottom: 1px solid var(--el-border-color-lighter); margin-bottom: 20px; padding-bottom: 18px; }
.provider-settings summary { cursor: pointer; font-size: 14px; font-weight: 600; }
.provider-settings summary .muted { font-weight: 400; margin-left: 8px; }
.provider-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.provider-grid fieldset { min-width: 0; margin: 0; padding: 16px; border: 1px solid var(--el-border-color-light); border-radius: 8px; }
.provider-grid legend { font-size: 13px; padding: 0 6px; }
.provider-fields { display: grid; gap: 14px; margin-top: 16px; }
.provider-description { margin: 0; }
.toggle-field { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.toggle-field input { width: 16px; height: 16px; margin: 0; accent-color: var(--el-color-primary); }
.cache-actions { margin-top: 16px; align-items: center; }
.retrieval-status { border-bottom: 1px solid var(--el-border-color-lighter); padding: 8px 0; font-size: 13px; line-height: 1.7; }
.retrieval-status p { margin: 8px 0; }
.stats { display: flex; gap: 10px 24px; flex-wrap: wrap; border-top: 1px solid var(--el-border-color-lighter); padding-top: 14px; margin-top: 16px; font-size: 13px; color: var(--el-text-color-secondary); }
.stats strong { color: var(--el-text-color-primary); }
.warning { color: var(--el-color-warning-dark-2); font-size: 13px; line-height: 1.7; }
.text-button { background: none; border: 0; color: var(--el-color-primary); cursor: pointer; font: inherit; }
.error-box { display: flex; align-items: center; justify-content: space-between; gap: 14px; background: var(--el-color-danger-light-9); color: var(--el-color-danger); border: 1px solid var(--el-color-danger-light-7); border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; font-size: 13px; overflow-wrap: anywhere; }
.shortcuts { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.shortcuts .el-button { margin-left: 0; }
.results-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.results-card, .evidence-card { min-height: 280px; }
.empty-state { color: var(--el-text-color-secondary); padding: 36px 8px; text-align: center; font-size: 14px; line-height: 1.8; }
.result-item { display: flex; width: 100%; flex-direction: column; gap: 9px; text-align: left; margin-top: 12px; padding: 15px; border: 1px solid var(--el-border-color-light); background: var(--el-fill-color-blank); border-radius: 8px; color: inherit; cursor: pointer; font: inherit; }
.result-item:hover, .result-item.selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.result-item:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.result-meta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; font-size: 12px; color: var(--el-text-color-secondary); }
.result-item strong { font-size: 14px; }
.hit-label { font-size: 13px; color: var(--el-text-color-regular); }
.quote { font-size: 14px; white-space: pre-wrap; line-height: 1.8; overflow-wrap: anywhere; }
.hit-reason { font-size: 12px; }
.evidence-heading { font-weight: 600; font-size: 14px; }
.evidence-details { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 10px 14px; font-size: 12px; line-height: 1.6; }
.evidence-details dt { color: var(--el-text-color-secondary); }
.evidence-details dd { margin: 0; overflow-wrap: anywhere; }
blockquote { margin: 0; border-left: 3px solid var(--el-color-primary); background: var(--el-fill-color-light); padding: 12px 15px; white-space: pre-wrap; line-height: 1.8; font-size: 14px; overflow-wrap: anywhere; }
.source-text { margin: 0; padding: 14px; background: var(--el-fill-color-light); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 480px; overflow-y: auto; font: inherit; font-size: 13px; line-height: 1.9; }
mark { background: var(--el-color-warning-light-7); color: var(--el-text-color-primary); }
.editor-field { margin: 16px 0; }
textarea { resize: vertical; line-height: 1.8; }
@media (max-width: 850px) { .results-layout { grid-template-columns: 1fr; gap: 0; } .provider-grid { grid-template-columns: 1fr; } .memory-lab { padding: 14px; } .lab-header { flex-wrap: wrap; } .lab-card { padding: 16px; } .cutoff-field { flex: 1 1 240px; } }
@media (max-width: 480px) {
  .memory-lab { padding: 0; }
  .lab-card { padding: 12px; }
  .source-field { flex-basis: 100%; }
  .control-row > .el-button, .shortcuts .el-button, input, select { min-height: 44px; }
  input, select, textarea { font-size: 16px; }
  .provider-grid fieldset { padding: 10px; }
  .error-box { flex-wrap: wrap; }
}
</style>
