<template>
  <section class="producer-panel" data-testid="body-producer-panel" aria-label="Body proposal producer offline readiness" :aria-busy="busy || loading">
    <h2>Body Proposal Producer · 单窗口提案生产（离线就绪）</h2>
    <p class="notice" data-testid="body-producer-boundary">从当前已接纳正文准备一次有界请求；返回内容仍是不可信提案。当前没有真实端点、凭证或花费授权。
      No live-model quality claim, semantic verdict, canon writeback or autonomous novel acceptance.</p>
    <p data-testid="body-producer-retention">请求、回复与审阅只保留在本地 Campaign 的同一额度内。保留至此 Campaign 生命周期结束，不承诺按时物理删除；执行过期不等于删除，也不退款。</p>
    <div class="actions">
      <button data-testid="body-producer-refresh" :disabled="busy || loading" @click="refresh">重新读取 / Reload durable state</button>
      <button v-if="!snapshot" data-testid="body-producer-adopt" :disabled="!canAdopt" @click="adopt">明确采用 Campaign v3 · Enable locally</button>
      <button v-if="busy || loading" data-testid="body-producer-stop-local" @click="cancelLocal">停止本实例 / Stop locally</button>
    </div>
    <p v-if="!snapshot" data-testid="body-producer-adoption-scope">采用 v3 需要已完成的受支持 v2 Campaign 且没有未结清写作请求。采用会保留原始历史与累计预算，并阻止旧版写入；不会调用模型。</p>
    <p v-if="error" role="alert" data-testid="body-producer-error">操作未就绪或未确认 / {{ error }}。重新读取持久记录；不自动重试调用。</p>
    <p v-if="notice" role="status" data-testid="body-producer-notice">{{ noticeLabel }}</p>
    <section v-if="verification" class="notice" data-testid="body-producer-verification" aria-label="Ephemeral source verification progress" role="status" aria-live="polite">
      <h3>正在核验持久来源 / Verifying durable source</h3>
      <p data-testid="body-producer-verification-phase">{{ verification.progress?.purpose ?? 'discovering_source_version' }} · {{ verification.progress?.stage ?? 'starting' }}</p>
      <p v-if="verification.progress" data-testid="body-producer-verification-counts">
        Verified operations: {{ verification.progress.verifiedOperations }} / {{ verification.progress.totalOperations ?? 'not yet known' }} ·
        records: {{ verification.progress.verifiedRecords }} · retained transcript: {{ verification.progress.capturedEntries }} entries / {{ verification.progress.capturedBytes }} bytes.
      </p>
      <p data-testid="body-producer-verification-boundary">仅为本次临时核验进度，不是来源就绪、请求完成或语义通过。可停止或离开；重新打开会丢弃进度并重新核验。No partial source is ready; verification progress grants no dispatch authority.</p>
    </section>
    <template v-if="snapshot">
      <dl class="metadata" data-testid="body-producer-identity">
        <dt>Campaign / version</dt><dd>{{ snapshot.manifest.campaignId }} / v3</dd>
        <dt>Source epoch / candidate</dt><dd>{{ snapshot.checkpoint.sourceEpoch }} / {{ snapshot.checkpoint.candidateId }}</dd>
        <dt>Durable status / sequence</dt><dd>{{ snapshot.checkpoint.status }} / {{ snapshot.head.sequence }}</dd>
        <dt>Shared W / U / P</dt><dd data-testid="body-producer-storage">{{ storage.written }} / {{ storage.outstanding }} / {{ storage.recovery }} bytes · limit {{ storage.limit }}</dd>
        <dt>Cumulative attempts</dt><dd>{{ snapshot.checkpoint.budget.attempts }} / {{ snapshot.origin.manifest.budget.attempts }} · producer {{ requestRows.length }} / 8</dd>
        <dt>Unknown requests</dt><dd data-testid="body-producer-unknown-count">{{ unknownCount }}（继续占用预留，不可重放 / remain reserved, never replayed）</dd>
      </dl>
      <fieldset :disabled="busy || loading">
        <legend>当前正文来源 / Current accepted source</legend>
        <label>Chapter
          <select data-testid="body-producer-chapter" :value="chapterOrdinal" @change="changeChapter">
            <option v-for="row in chapterRows" :key="row.taskId" :value="row.ordinal">{{ row.ordinal }} · {{ row.status }}{{ row.eligible ? ' · current prefix' : '' }}</option>
          </select>
        </label>
        <p v-if="selectedChapter?.artifact" class="hash" data-testid="body-producer-source-ref">{{ selectedChapter.taskId }} · r{{ selectedChapter.artifact.revision }} · {{ selectedChapter.artifact.hash }}</p>
        <label for="body-producer-source-text">精确原文；可选中一段以设置原始 UTF-16 区间 / Exact original text</label>
        <textarea id="body-producer-source-text" data-testid="body-producer-source-text" :value="selectedText" rows="5" readonly spellcheck="false" @select="selectText" />
        <div class="inline-fields">
          <label>Start UTF-16 <input data-testid="body-producer-start" type="number" min="0" :value="startUtf16" @input="changeStart"></label>
          <label>End UTF-16 <input data-testid="body-producer-end" type="number" min="0" :value="endUtf16" @input="changeEnd"></label>
        </div>
        <p data-testid="body-producer-window-size">{{ endUtf16 - startUtf16 }} original UTF-16 units · maximum 4,096 · {{ windowValid ? 'range ready for fresh verification' : 'invalid or empty range' }}</p>
        <details><summary>Selected literal window · 仅本地</summary><pre data-testid="body-producer-window">{{ selectedWindow }}</pre></details>
      </fieldset>
      <details data-testid="body-producer-revision-section">
        <summary>明确修订本地已接纳正文 / Explicit local source revision</summary>
        <p>这是作者手动改动，不计为自主创作。新候选保留父修订，并使后续依赖正文失效；不会改写规划、普通 Writer 或图谱。</p>
        <label for="body-producer-revision-text">Replacement body · at most 64 KiB</label>
        <textarea id="body-producer-revision-text" data-testid="body-producer-revision-text" :value="revisionText" :disabled="!canRevise" rows="6" spellcheck="false" @input="editRevision" />
        <div class="actions"><button data-testid="body-producer-revision-preview" :disabled="!canRevise || revisionPreviewLoading" @click="previewRevision">核验修订预览 / Preview revision</button></div>
        <div v-if="revisionPreview" data-testid="body-producer-revision-ready">
          <p>{{ revisionPreview.bytes }} UTF-8 bytes / {{ revisionPreview.utf16 }} original UTF-16 units</p>
          <p class="hash">SHA-256 {{ revisionPreview.hash }}</p>
          <p data-testid="body-producer-revision-invalidations">Dependent chapters invalidated: {{ revisionPreview.invalidatedChapters.join(', ') || 'none' }}</p>
          <button data-testid="body-producer-revision-commit" :disabled="!canRevise" @click="commitRevision">明确接纳此修订 / Commit this manual revision</button>
        </div>
      </details>
      <fieldset :disabled="busy || loading">
        <legend>请求选择与披露 / Request and disclosure</legend>
        <label>Registered producer
          <select data-testid="body-producer-adapter" :value="producerId" @change="changeProducer">
            <option v-for="producer in producers" :key="producer.adapterId" :value="producer.adapterId">{{ producer.adapterId }} · {{ producer.mode }} · {{ producer.effectiveModelId }}</option>
          </select>
        </label>
        <p>只发送选定窗口和下面明确选择记录的完整前提闭包，不默认发送全局规划。规划可能包含作者专有或未来信息；不是正文真相、角色知识或读者披露许可。</p>
        <label>Optional planning records · zero selected by default
          <select data-testid="body-producer-planning" multiple size="6" :value="selectedPlanningKeys" @change="changePlanning">
            <option v-for="choice in planningChoices" :key="choice.key" :value="choice.key">{{ choice.label }}</option>
          </select>
        </label>
        <p>{{ selectedPlanningKeys.length }} selected seeds; preparation expands complete required closure or refuses overflow, never truncates it.</p>
        <button data-testid="body-producer-prepare" :disabled="!canPrepare" @click="prepare">准备精确请求（零派发）/ Prepare, zero dispatch</button>
      </fieldset>
      <div v-if="prepared" data-testid="body-producer-prepared">
        <h3>Exact prepared request · 精确待请求</h3>
        <dl class="metadata">
          <dt>Input digest</dt><dd class="hash" data-testid="body-producer-input-digest">{{ prepared.prepared.inputDigest }}</dd>
          <dt>Input size</dt><dd>{{ prepared.prepared.inputBytes }} UTF-8 bytes / {{ prepared.prepared.inputUtf16 }} UTF-16 units（不是精确 token 计量）</dd>
          <dt>Complete selected planning closure</dt><dd>{{ prepared.prepared.catalog.length }} records</dd>
          <dt>Configured model / endpoint identity</dt><dd>{{ prepared.producer.effectiveModelId }} / {{ prepared.producer.endpointIdentity }}</dd>
          <dt>Invocation grant</dt><dd data-testid="body-producer-grant">{{ prepared.invocationAllowed ? 'local controlled test host only' : 'not authorized; no live call permitted' }}</dd>
          <dt>Exact reservation</dt><dd data-testid="body-producer-reservation">{{ prepared.reservation.attempts }} attempt · {{ prepared.reservation.inputBytes }} input bytes · {{ prepared.reservation.inputUtf16 }} input UTF-16 · {{ prepared.reservation.outputTokens }} output tokens · {{ prepared.reservation.reasoningTokens }} reasoning-token allowance · {{ prepared.reservation.responseBytes }} response bytes · {{ prepared.reservation.activeMs }} active ms. Not a bill.</dd>
          <dt>Limits</dt><dd>1 HTTP attempt · 1,200 output-token ceiling · 30 s transport · no tools, retry or second window</dd>
        </dl>
        <details><summary>Exact local input and selected disclosure · 仅本地</summary><pre data-testid="body-producer-exact-input">{{ JSON.stringify(prepared.prepared, null, 2) }}</pre></details>
        <button data-testid="body-producer-invoke" :disabled="!canInvoke" @click="invoke">明确调用一次 / Invoke once</button>
      </div>
      <section data-testid="body-producer-requests" aria-label="Durable producer outcomes">
        <h3>Durable outcomes · 持久结果</h3>
        <p>响应完成、供应的文本范围、生产器声明的检查范围和语义审阅分别记录。空结果不代表没有事实；有效引文也不证明解释正确。</p>
        <p v-if="!requestRows.length">No producer requests reserved.</p>
        <ol v-else>
          <li v-for="row in requestRows" :key="row.id" :data-testid="`body-producer-request-${row.id}`">
            <span class="hash">{{ row.id }}</span> · {{ row.phase?.status ?? 'unavailable' }} · {{ row.phase?.resolution?.outcome ?? 'unresolved outcome' }}
            <strong v-if="row.unknown"> · UNKNOWN / 不可重放</strong><strong v-if="row.stale"> · STALE SOURCE</strong>
            <span v-if="row.refusalReason"> · {{ row.refusalReason }}</span>
            <p>Observed usage: {{ row.usage?.provenance ?? 'unavailable' }} · input {{ row.usage?.inputTokens ?? 'unknown' }} / output {{ row.usage?.outputTokens ?? 'unknown' }} / reasoning {{ row.usage?.reasoningTokens ?? 'unknown' }} tokens. Missing usage is not zero.</p>
            <button v-if="row.canRecover" :disabled="busy || loading" :data-testid="`body-producer-recover-${row.id}`" @click="recover(row.id)">{{ row.phase?.responseHash ? '重核已保留结果 / Revalidate retained result' : '核对持久状态 / Reconcile durable state' }}（不派发 / no dispatch）</button>
          </li>
        </ol>
      </section>
      <section v-if="currentReview" data-testid="body-producer-review" aria-label="Read-only producer proposal review">
        <h3>Read-only proposal review · 只读提案审阅</h3>
        <p class="notice" data-testid="body-producer-semantic-boundary">Semantic review: not_reviewed. Relation completeness: not_assessed. Supported-shape proposals and unresolved observations are not canon, character knowledge or a no-drift verdict.</p>
        <p>完整处置清单、来源引文、未映射主体/主题、容量缺口与生产器来源均保留在下方，不隐藏不支持项。没有“写入事实库”或“修改 Writer”操作。</p>
        <dl class="metadata" data-testid="body-producer-review-counts">
          <dt>Completed response items / compiled claims</dt><dd>{{ currentReview.result.responseItemCount }} / {{ currentReview.result.compiledClaimCount }}</dd>
          <dt>Unresolved observations / saturation</dt><dd>{{ currentReview.result.unresolvedObservationCount }} / {{ currentReview.result.saturated }}</dd>
          <dt>Requested and supplied interval</dt><dd>{{ currentReview.result.requestInterval.startUtf16 }}–{{ currentReview.result.requestInterval.endUtf16 }} original UTF-16 units</dd>
          <dt>Packet supplied / declared examined</dt><dd>{{ currentReview.result.packet.coverage.supplied.coveredUtf16Units }} / {{ currentReview.result.packet.coverage.examinedDeclaration.declaredUtf16Units }} · unauthenticated declaration</dd>
          <dt>Inventory digest</dt><dd class="hash">{{ currentReview.result.inventoryDigest }}</dd>
        </dl>
        <h4>Supported-shape proposals · 仍未审阅</h4>
        <p v-if="!currentReview.result.packet.claims.length" data-testid="body-producer-empty-response">No compiled claims. This does not establish absence of facts or drift.</p>
        <ol data-testid="body-producer-claims"><li v-for="claim in currentReview.result.packet.claims" :key="claim.id">
          <strong>{{ claim.kind }}</strong>: {{ claim.statement }}
          <blockquote v-for="span in reviewSpans(claim.anchorIds)" :key="span.id">[{{ span.startUtf16 }}, {{ span.endUtf16 }}) {{ span.quote }}</blockquote>
        </li></ol>
        <h4>Unresolved inventory · 不隐藏未支持项</h4>
        <ol data-testid="body-producer-unresolved"><li v-for="item in currentReview.result.inventory.unresolved" :key="item.id">
          <strong>{{ item.reason }}</strong>: {{ item.explanation }}
          <blockquote v-for="span in reviewSpans(item.anchorIds)" :key="span.id">[{{ span.startUtf16 }}, {{ span.endUtf16 }}) {{ span.quote }}</blockquote>
        </li></ol>
        <details><summary>Exact local packet and complete disposition inventory</summary><pre data-testid="body-producer-review-packet">{{ JSON.stringify(currentReview.result, null, 2) }}</pre></details>
      </section>
      <div class="actions"><button data-testid="body-producer-cancel-campaign" :disabled="busy || loading || snapshot.checkpoint.status !== 'active'" @click="cancelCampaign">明确取消此 v3 Campaign / Cancel this campaign</button></div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'
import type { CampaignInspection } from '@/types/writerCampaign'
import type { BodyProducerEngine } from '@/types/bodyProducer'
import { decodeStorageBytes } from '@/services/writerCampaign/protocol'
import { useBodyProducer } from '@/composables/useBodyProducer'
const props = defineProps<{ campaignId: string; legacySnapshot?: CampaignInspection | null; engine?: BodyProducerEngine }>()
const emit = defineEmits<{ version: [version: 3 | null] }>()
const ui = useBodyProducer({ engine: props.engine, legacySnapshot: () => props.legacySnapshot ?? null, onVersion: version => emit('version', version) })
const { snapshot, loading, busy, error, notice, producers, producerId, canAdopt, adopt, chapterRows, selectedChapter, selectedText,
  chapterOrdinal, startUtf16, endUtf16, selectedWindow, windowValid, planningChoices, selectedPlanningKeys, prepared, currentReview,
  revisionText, revisionPreview, revisionPreviewLoading, canRevise, canPrepare, canInvoke, requestRows, unknownCount, verification,
  refresh, setChapter, setWindow, setProducer, setPlanning, setRevisionText, previewRevision, commitRevision, prepare, invoke, recover, cancelLocal, cancelCampaign } = ui
const storage = computed(() => {
  const value = snapshot.value
  return { written: value ? decodeStorageBytes(value.checkpoint.storage.writtenBytes) : 0,
    outstanding: value ? decodeStorageBytes(value.checkpoint.storage.outstandingBytes) : 0,
    recovery: value ? decodeStorageBytes(value.checkpoint.storage.recoveryRemainingBytes) : 0,
    limit: value ? decodeStorageBytes(value.origin.manifest.storage.limitBytes) : 0 }
})
const noticeLabel = computed(() => ({ review_ready: '已保留并完成来源核验；语义仍未审阅 / Retained, source-validated only.',
  response_refused: '已保留的回复未通过核验；没有部分成功清单 / Retained response refused.',
  outcome_unknown: '结果未知，预留保留；不能重放 / Unknown outcome; reservation retained.',
  local_cancelled_outcome_unconfirmed: '本实例已停止；持久结果尚未重读。已保存的 intent 仍可能调用，不能承诺零成本。',
  persisted_source_unavailable: '先前已确认的 v3 来源现不可读取，结果未知；不能退回旧版视图或重置额度。',
}[notice.value] ?? notice.value))
const reviewSpans = (ids: string[]) => currentReview.value?.result.packet.spans.filter(span => ids.includes(span.id)) ?? []
const field = (event: Event) => event.target as HTMLInputElement
function changeChapter(event: Event) { setChapter(Number(field(event).value)) }
function changeStart(event: Event) { setWindow(Number(field(event).value), endUtf16.value) }
function changeEnd(event: Event) { setWindow(startUtf16.value, Number(field(event).value)) }
function changeProducer(event: Event) { setProducer(field(event).value) }
function changePlanning(event: Event) { setPlanning([...((event.target as HTMLSelectElement).selectedOptions)].map(option => option.value)) }
function selectText(event: Event) { const target = event.target as HTMLTextAreaElement; if (target.selectionStart < target.selectionEnd) setWindow(target.selectionStart, target.selectionEnd) }
function editRevision(event: Event) { const target = event.target as HTMLTextAreaElement; if (!setRevisionText(target.value)) target.value = revisionText.value }
watch(() => props.campaignId, id => { void ui.select(id) }, { immediate: true })
onUnmounted(ui.dispose)
defineExpose({ refresh })
</script>

<style scoped>
.producer-panel { margin-top: 32px; border-top: 2px solid var(--el-border-color, #c7cdd5); padding-top: 12px; }
.notice { border-left: 4px solid #bd8122; background: var(--el-color-warning-light-9, #fff7e8); padding: 12px 16px; }
.actions, .inline-fields { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
fieldset, details { margin: 18px 0; padding: 14px; border: 1px solid var(--el-border-color, #c7cdd5); border-radius: 6px; }
label { display: block; margin: 12px 0; } select, input, textarea, button { font: inherit; color: inherit; }
select, input, textarea { display: block; margin-top: 6px; padding: 7px; border: 1px solid var(--el-border-color, #bdc4ce); border-radius: 5px; background: var(--el-bg-color, white); }
textarea, select[multiple] { width: 100%; box-sizing: border-box; } textarea { resize: vertical; }
button { padding: 8px 12px; background: var(--el-bg-color, white); border: 1px solid var(--el-border-color, #bdc4ce); border-radius: 5px; cursor: pointer; }
button:disabled { opacity: .55; cursor: not-allowed; } .metadata { display: grid; grid-template-columns: minmax(180px, 1fr) 3fr; gap: 8px 16px; }
dt { font-weight: 600; } dd { margin: 0; overflow-wrap: anywhere; } .hash, pre { overflow-wrap: anywhere; }
pre { white-space: pre-wrap; font: inherit; } summary { cursor: pointer; } li { margin-bottom: 10px; } [role="alert"] { color: var(--el-color-danger, #9b2323); }
@media (max-width: 600px) { .metadata { grid-template-columns: 1fr; } dd { margin-bottom: 8px; } .actions button { width: 100%; } }
</style>
