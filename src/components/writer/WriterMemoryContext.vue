<template>
  <section class="writer-memory" data-testid="writer-memory-panel" aria-label="写作记忆依据">
    <label class="toggle">
      <input :checked="enabled" :disabled="disabled" type="checkbox" data-testid="writer-memory-enabled" @change="emit('update:enabled', checked($event))" />
      <strong>使用记忆检索依据</strong>
      <span class="muted">默认关闭</span>
    </label>
    <p class="muted">为本次章节正文生成、续写或润色检索已保存原文；核对依据后再开始生成。该设置不会替你生成或修改正文。</p>
    <template v-if="enabled">
      <div class="search-fields">
        <label class="field"><span>要查找的事实或伏笔</span><input :value="query" :disabled="disabled || busy" type="search" maxlength="500" placeholder="例如：铜铃、接应信号、旧日约定" data-testid="writer-memory-query" @input="emit('update:query', valueOf($event))" @keydown.enter.prevent="canSearch && emit('search')" /></label>
        <label class="field"><span>已披露至（含本章）</span><select :value="cutoffId" :disabled="disabled || busy" data-testid="writer-memory-cutoff" @change="emit('update:cutoffId', valueOf($event))"><option value="" disabled>请选择披露截止章节</option><option v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">{{ chapter.ordinal }} · {{ chapter.title }}</option></select></label>
      </div>
      <p class="muted">仅检索所选截止章节之前的已保存内容。改稿、切章、改变查询或披露范围后，须重新检索和核对。模型推断会保留推断标识。</p>
      <p class="muted">披露范围约束本次检索依据。你填写的写作要求、大纲及手选素材仍按原流程使用，请自行确认其中是否包含后续剧情。</p>
      <details class="providers" data-testid="writer-memory-providers">
        <summary>可选语义召回与重排（默认关闭）</summary>
        <p class="muted">设置与密钥仅保留在当前写作页面内存，刷新或离开后清除，不写入小说或备份。更改服务地址或访问格式会清除对应密钥。</p>
        <p class="warning">开启后，点击“检索并预览”会把查询和已披露范围内的正文片段发给所填服务，可能产生费用。服务须支持浏览器跨域请求。后续章节不会发送。</p>
        <div class="provider-grid">
          <fieldset :disabled="disabled || busy">
            <legend>语义召回</legend>
            <label class="toggle"><input :checked="providers.embeddingEnabled" type="checkbox" data-testid="writer-memory-embedding-enabled" @change="updateProviders({ embeddingEnabled: checked($event) })" />启用嵌入模型</label>
            <div v-if="providers.embeddingEnabled" class="provider-fields">
              <label class="field"><span>访问格式</span><select :value="providers.embedding.protocol" data-testid="writer-memory-embedding-protocol" @change="updateEmbedding({ protocol: valueOf($event) as MemoryEmbeddingConfig['protocol'] })"><option value="jina">Jina</option><option value="openai-compatible">OpenAI 兼容</option></select></label>
              <label class="field"><span>嵌入 API 完整地址</span><input :value="providers.embedding.endpoint" type="url" autocomplete="off" spellcheck="false" data-testid="writer-memory-embedding-endpoint" @input="updateEmbedding({ endpoint: valueOf($event) })" /></label>
              <label class="field"><span>嵌入模型</span><input :value="providers.embedding.model" autocomplete="off" spellcheck="false" data-testid="writer-memory-embedding-model" @input="updateEmbedding({ model: valueOf($event) })" /></label>
              <label class="field"><span>API 密钥</span><input :value="providers.embedding.apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="仅当前写作页面使用" data-testid="writer-memory-embedding-key" @input="updateEmbedding({ apiKey: valueOf($event) })" /></label>
              <label class="field"><span>输出维度（须与模型支持值一致）</span><input :value="providers.embedding.dimensions" type="number" min="1" max="4096" step="1" data-testid="writer-memory-embedding-dimensions" @input="updateEmbedding({ dimensions: Number(valueOf($event)) })" /></label>
            </div>
          </fieldset>
          <fieldset :disabled="disabled || busy">
            <legend>候选重排</legend>
            <label class="toggle"><input :checked="providers.rerankEnabled" type="checkbox" data-testid="writer-memory-rerank-enabled" @change="updateProviders({ rerankEnabled: checked($event) })" />启用重排模型</label>
            <div v-if="providers.rerankEnabled" class="provider-fields">
              <p class="muted">支持 Jina /rerank 请求格式，可独立用于本地召回结果。</p>
              <label class="field"><span>重排 API 完整地址</span><input :value="providers.rerank.endpoint" type="url" autocomplete="off" spellcheck="false" data-testid="writer-memory-rerank-endpoint" @input="updateRerank({ endpoint: valueOf($event) })" /></label>
              <label class="field"><span>重排模型</span><input :value="providers.rerank.model" autocomplete="off" spellcheck="false" data-testid="writer-memory-rerank-model" @input="updateRerank({ model: valueOf($event) })" /></label>
              <label class="field"><span>API 密钥</span><input :value="providers.rerank.apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="仅当前写作页面使用" data-testid="writer-memory-rerank-key" @input="updateRerank({ apiKey: valueOf($event) })" /></label>
            </div>
          </fieldset>
        </div>
      </details>
      <div class="actions">
        <button :disabled="!canSearch" data-testid="writer-memory-search" @click="emit('search')">{{ busy ? '正在检索…' : '检索并预览' }}</button>
        <button v-if="busy" data-testid="writer-memory-cancel" @click="emit('cancel')">取消检索</button>
      </div>
      <p v-if="error" class="error" role="alert" data-testid="writer-memory-error">{{ error }}</p>
      <p v-if="notice" class="muted" role="status" data-testid="writer-memory-notice">{{ notice }}</p>
      <div v-if="result" class="preview" data-testid="writer-memory-result">
        <h4>本次将使用的依据</h4>
        <p class="muted">{{ result.hits.length }} 条原文依据 · {{ result.relations.length }} 条事实关系<span v-if="result.prompt"> · 上下文 {{ result.prompt.length.toLocaleString() }} 字符</span></p>
        <div v-if="result.diagnostics" class="diagnostics" data-testid="writer-memory-diagnostics">
          <p>语义召回：{{ semanticStatus }}；候选重排：{{ rerankStatus }}</p>
          <p v-for="(warning, index) in result.diagnostics.warnings" :key="index" class="warning">{{ warning }}</p>
        </div>
        <p v-if="!hasEvidence" class="warning" data-testid="writer-memory-empty">未找到可用依据。请调整查询和披露范围；没有依据时不会批准记忆上下文。</p>
        <div class="evidence-grid">
          <article v-for="(hit, index) in result.hits" :key="hit.id" class="evidence" :data-testid="`writer-memory-hit-${index}`">
            <h5>第 {{ hit.ordinal }} 章 · {{ hit.chapterTitle }}</h5>
            <p class="provenance" data-testid="writer-memory-provenance">{{ hit.kind === 'clue' ? '作者标记伏笔 · 引用来自原文' : '原文明示片段' }}</p>
            <p v-if="hit.label" class="muted">{{ hit.label }}</p>
            <dl><dt>章节版本</dt><dd><code data-testid="writer-memory-revision">{{ hit.revision }}</code></dd><dt>原文位置</dt><dd>{{ hit.start }}–{{ hit.end }}</dd><dt>匹配原因</dt><dd>{{ hit.reason }}</dd></dl>
            <blockquote data-testid="writer-memory-quote">{{ hit.quote }}</blockquote>
          </article>
          <article v-for="(relation, index) in result.relations" :key="relation.id" class="evidence" :data-testid="`writer-memory-relation-${index}`">
            <h5>{{ relation.source.label }} → {{ relation.target.label }}</h5>
            <p>{{ relation.predicate }}</p>
            <p class="provenance" data-testid="writer-memory-provenance">{{ relation.authorConfirmed ? '作者确认 · ' : '' }}{{ relation.origin === 'explicit' ? '原文明示' : '模型推断' }} · {{ relation.createdBy === 'model' ? '模型提议' : '作者录入' }}</p>
            <p v-if="relation.origin === 'inferred'" class="warning">以下原文是推断依据，不代表原文直接陈述了该关系。</p>
            <div v-for="(anchor, anchorIndex) in relation.evidence" :key="`${anchor.chapterId}:${anchor.start}:${anchorIndex}`" class="anchor">
              <h5>第 {{ anchor.ordinal }} 章 · {{ anchor.chapterTitle }}</h5>
              <dl><dt>章节版本</dt><dd><code data-testid="writer-memory-revision">{{ anchor.sourceRevision }}</code></dd><dt>原文位置</dt><dd>{{ anchor.start }}–{{ anchor.end }}</dd></dl>
              <blockquote data-testid="writer-memory-quote">{{ anchor.quote }}</blockquote>
            </div>
          </article>
        </div>
        <div class="approval">
          <button :disabled="disabled || busy || !hasEvidence || approved" data-testid="writer-memory-approve" @click="emit('approve')">{{ approved ? '本次依据已核对' : '已核对，将以上依据用于本次生成' }}</button>
          <p v-if="approved" class="success" role="status" data-testid="writer-memory-approved">依据已就绪。开始生成前会再次校验正文版本和披露范围；失效时不会发送旧依据。</p>
          <p v-else class="muted">请核对原文、章节版本和推断标识。启用记忆时，须完成本次核对后才能生成。</p>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MemoryEmbeddingConfig, MemoryRerankConfig } from '@/types/memory'
import type { WriterMemoryChapterChoice, WriterMemoryPreview, WriterMemoryProviders } from '@/composables/writerMemoryUi'

const props = defineProps<{
  enabled: boolean
  query: string
  cutoffId: string
  chapters: WriterMemoryChapterChoice[]
  busy: boolean
  error?: string
  notice?: string
  result: WriterMemoryPreview | null
  approved: boolean
  disabled?: boolean
  providers: WriterMemoryProviders
}>()
const emit = defineEmits<{
  'update:enabled': [value: boolean]
  'update:query': [value: string]
  'update:cutoffId': [value: string]
  'update:providers': [value: WriterMemoryProviders]
  search: []
  cancel: []
  approve: []
}>()
const canSearch = computed(() => props.enabled && !props.disabled && !props.busy && !!props.query.trim() && props.chapters.some(chapter => chapter.id === props.cutoffId))
const hasEvidence = computed(() => !!props.result && (props.result.hits.length > 0 || props.result.relations.length > 0))
const semanticStatus = computed(() => ({ disabled: '未启用（本地检索）', used: '已参与混合检索', fallback: '不可用，已回退至本地检索' })[props.result?.diagnostics?.semantic ?? 'disabled'])
const rerankStatus = computed(() => ({ disabled: '未启用', used: '已完成', fallback: '不可用，保留召回顺序', skipped: '无需重排，未调用服务' })[props.result?.diagnostics?.rerank ?? 'disabled'])
function valueOf(event: Event) { return (event.target as HTMLInputElement | HTMLSelectElement).value }
function checked(event: Event) { return (event.target as HTMLInputElement).checked }
function updateProviders(patch: Partial<WriterMemoryProviders>) { emit('update:providers', { ...props.providers, ...patch }) }
function updateEmbedding(patch: Partial<MemoryEmbeddingConfig>) {
  const changedEndpoint = (patch.endpoint !== undefined && patch.endpoint !== props.providers.embedding.endpoint) || (patch.protocol !== undefined && patch.protocol !== props.providers.embedding.protocol)
  updateProviders({ embedding: { ...props.providers.embedding, ...patch, ...(changedEndpoint ? { apiKey: '' } : {}) } })
}
function updateRerank(patch: Partial<MemoryRerankConfig>) {
  const changedEndpoint = patch.endpoint !== undefined && patch.endpoint !== props.providers.rerank.endpoint
  updateProviders({ rerank: { ...props.providers.rerank, ...patch, ...(changedEndpoint ? { apiKey: '' } : {}) } })
}
</script>

<style scoped>
.writer-memory { min-width: 0; margin: 0 0 16px; padding: 16px; border: 1px solid var(--el-border-color-light); border-radius: 8px; background: var(--el-bg-color); color: var(--el-text-color-primary); font-size: 13px; }
p { line-height: 1.7; margin: 10px 0; overflow-wrap: anywhere; }
h4 { margin: 0 0 12px; font-size: 15px; } h5 { margin: 0 0 8px; font-size: 14px; overflow-wrap: anywhere; }
.muted { color: var(--el-text-color-secondary); }.warning { color: var(--el-color-warning-dark-2); }.success { color: var(--el-color-success-dark-2); }.error { padding: 10px; border-radius: 6px; color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.toggle { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 32px; cursor: pointer; }.toggle input { width: 18px; height: 18px; margin: 0; accent-color: var(--el-color-primary); }
.search-fields, .provider-grid, .evidence-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
input:not([type="checkbox"]), select { width: 100%; min-width: 0; box-sizing: border-box; padding: 9px 10px; border: 1px solid var(--el-border-color); border-radius: 6px; font: inherit; color: var(--el-text-color-primary); background: var(--el-fill-color-blank); }
button { padding: 9px 12px; border: 1px solid var(--el-border-color); border-radius: 6px; background: var(--el-fill-color-blank); color: var(--el-text-color-primary); font: inherit; cursor: pointer; white-space: normal; overflow-wrap: anywhere; }
button:hover:enabled { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); } button:disabled { opacity: 0.6; cursor: not-allowed; } button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.providers { margin: 16px 0; padding-block: 12px; border-top: 1px solid var(--el-border-color-lighter); border-bottom: 1px solid var(--el-border-color-lighter); } summary { cursor: pointer; line-height: 1.8; } fieldset { min-width: 0; margin: 0; padding: 12px; border: 1px solid var(--el-border-color-light); border-radius: 6px; } legend { padding: 0 6px; }.provider-fields { display: grid; gap: 12px; margin-top: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }.preview { margin-top: 18px; }.diagnostics { font-size: 12px; }
.evidence { min-width: 0; padding: 12px; border: 1px solid var(--el-border-color-light); border-radius: 8px; }.provenance { color: var(--el-color-primary); }.anchor { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--el-border-color-lighter); }
dl { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 7px 10px; line-height: 1.7; font-size: 12px; } dt { color: var(--el-text-color-secondary); } dd { margin: 0; overflow-wrap: anywhere; }
blockquote { margin: 10px 0 0; padding: 10px 12px; border-left: 3px solid var(--el-color-primary); background: var(--el-fill-color-light); white-space: pre-wrap; line-height: 1.8; overflow-wrap: anywhere; }.approval { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--el-border-color-light); }
@media (max-width: 760px) { .search-fields, .provider-grid, .evidence-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 480px) { .writer-memory { padding: 12px; } button, input:not([type="checkbox"]), select, .toggle { min-height: 44px; } input:not([type="checkbox"]), select { font-size: 16px; } .evidence { padding: 10px; } .approval button { width: 100%; } }
</style>
