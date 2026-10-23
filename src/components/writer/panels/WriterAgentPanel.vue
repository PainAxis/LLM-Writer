<template>
  <el-dialog
    :model-value="visible" title="连续性续写草稿 · 有界 Agent" width="min(760px, 94vw)"
    align-center :before-close="requestClose" :close-on-click-modal="true" :close-on-press-escape="true"
    @update:model-value="value => { if (!value) emit('close') }"
  >
    <section v-if="visible" class="writer-agent-panel" data-testid="writer-agent-panel" :data-phase="phase" aria-label="连续性续写草稿">
      <p class="muted">两次受限模型请求、一次本地原文检索，逐条核对后才发送依据。不是自动写书或通用工具循环；没有远程工具、图谱、语义扫描或自动重试。</p>
      <div class="fields">
        <label>本次创作方向（最多 1,000 字符）
          <textarea :value="brief" :disabled="controlsLocked" rows="3" maxlength="1000" data-testid="writer-agent-brief" @input="emit('update:brief', valueOf($event))" />
        </label>
        <label>明确选择已披露至（含本章）
          <select :value="cutoffId" :disabled="controlsLocked" data-testid="writer-agent-cutoff" @change="emit('update:cutoffId', valueOf($event))">
            <option disabled value="">请选择当前章节作为披露截止</option>
            <option v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">{{ chapter.ordinal }} · {{ chapter.title }}</option>
          </select>
        </label>
      </div>
      <p class="muted">手写方向由你自行确认是否含后续剧情。自动附带的正文只限本次预览的目标章结尾及随后明确勾选的已披露原文。</p>
      <p v-if="blocker && !controlsLocked" class="warning" data-testid="writer-agent-blocker">{{ blocker }}</p>
      <button v-if="!controlsLocked && phase !== 'awaiting_author' && phase !== 'applied'" :disabled="!canPreview" data-testid="writer-agent-preview-action" @click="emit('preview')">本地预览（不发送请求）</button>

      <section v-if="phase === 'previewed' && snapshot.preview" class="card" data-testid="writer-agent-preview">
        <h4>本次将发送的内容</h4>
        <p>服务商：{{ snapshot.preview.provider }} · 模型：{{ snapshot.preview.model }}</p>
        <p>目标章：{{ targetTitle }} · 披露截止：{{ snapshot.preview.throughChapterId }}</p>
        <p>方向：{{ snapshot.preview.brief }}</p>
        <p>结尾摘录位置 {{ snapshot.preview.tail.start }}–{{ snapshot.preview.tail.end }}（UTF-16）；不是整章覆盖。</p>
        <p class="digest" data-testid="writer-agent-tail-revision">章节版本：{{ snapshot.preview.tail.revision }}</p>
        <pre data-testid="writer-agent-tail">{{ snapshot.preview.tail.text }}</pre>
        <label class="check"><input :checked="granted" type="checkbox" data-testid="writer-agent-grant" @change="emit('update:granted', checked($event))" />
          仅授权本次：发送上述方向和结尾进行规划，并调用一次 writer_retrieve_disclosed_context 本地只读检索。检索片段仍须逐条选择后才能发送，本文不会自动追加。
        </label>
        <button :disabled="!granted" data-testid="writer-agent-start" @click="emit('start')">授权开始本次运行</button>
      </section>

      <section v-if="activePhase" role="status" aria-live="polite" data-testid="writer-agent-progress">
        <p>{{ phaseText }}</p>
        <button data-testid="writer-agent-stop" @click="emit('cancel')">停止本次运行</button>
      </section>
      <section v-if="snapshot.receipt && receiptPhase" class="card" data-testid="writer-agent-receipt">
        <p>本地工具：writer_retrieve_disclosed_context · {{ snapshot.receipt.status === 'ready' ? '已验证返回' : '没有候选' }}</p>
        <p>调用 {{ snapshot.receipt.callId }} · 候选 {{ snapshot.receipt.candidateCount }} 条</p>
        <p class="digest">查询摘要 {{ snapshot.receipt.queryDigest }} · 长度 {{ snapshot.receipt.queryLength }}</p>
      </section>

      <section v-if="evidencePhase && snapshot.evidence.length" class="card" data-testid="writer-agent-evidence">
        <h4>逐条核对原文</h4>
        <p class="muted">以下仅为当前原文候选，不代表已验证语义支持。默认全部未选；只把你勾选的原始片段用于第二次请求。</p>
        <article v-for="(hit, index) in snapshot.evidence" :key="hit.id" :data-testid="`writer-agent-hit-${index}`" :data-chapter-id="hit.chapterId" class="evidence">
          <label class="check"><input type="checkbox" :checked="selectedHitIds.includes(hit.id)" :disabled="phase !== 'awaiting_evidence'" :data-testid="`writer-agent-select-hit-${index}`" @change="selectHit(hit.id, checked($event))" />选择这条原文</label>
          <h5>第 {{ hit.ordinal }} 章 · {{ hit.chapterTitle }}</h5>
          <p>原文位置 {{ hit.start }}–{{ hit.end }} · {{ hit.kind === 'passage' ? '原文段落' : '线索原文' }}</p>
          <p class="digest" data-testid="writer-agent-source-revision">版本 {{ hit.revision }}</p>
          <blockquote data-testid="writer-agent-source-quote">{{ hit.quote }}</blockquote>
        </article>
        <p data-testid="writer-agent-selected-count">已选择 {{ selectedHitIds.length }} 条原文。</p>
        <p v-if="phase === 'selecting_evidence'" data-testid="writer-agent-approval-progress">正在核对所选原文与当前版本…</p>
        <button :disabled="phase !== 'awaiting_evidence' || !selectedHitIds.length" data-testid="writer-agent-approve" @click="emit('approve')">已核对，用所选原文生成草稿</button>
      </section>

      <section v-if="draftPhase && draftText" class="card" data-testid="writer-agent-draft">
        <h4>{{ phase === 'awaiting_author' ? '待作者审阅的草稿' : '本次追加草稿' }}</h4>
        <pre data-testid="writer-agent-draft-text">{{ draftText }}</pre>
        <div class="actions">
          <button data-testid="writer-agent-copy" @click="emit('copy')">复制草稿</button>
          <button v-if="phase === 'awaiting_author'" data-testid="writer-agent-discard" @click="emit('cancel')">丢弃草稿</button>
          <button v-if="phase === 'awaiting_author'" data-testid="writer-agent-apply" @click="emit('append')">追加到《{{ targetTitle }}》并保存（仅一次）</button>
        </div>
        <p v-if="phase === 'applying'" role="status" data-testid="writer-agent-apply-progress">正在校验追加条件，尚未修改正文；现在关闭或停止仍可取消。</p>
        <button v-if="phase === 'applying'" data-testid="writer-agent-cancel-apply" @click="emit('cancel')">取消追加前校验</button>
        <p v-if="phase === 'commit_pending'" role="status" data-testid="writer-agent-save-pending">正文已追加一次，保存仍在进行。超过 30 秒没有当前提交回执时会提示结果未知。关闭将等待真实结果；不会重复追加或重新发送。</p>
        <p v-if="phase === 'commit_unknown'" role="status" data-testid="writer-agent-save-unknown">{{ initialCommitted ? '追加已有保存回执，后续修改或确认仍在等待。' : '写入结果尚未确定，仍在等待真实保存结果；等待提示不是保存失败。' }}请保持本页等待，可以复制草稿；不能重试或再次追加。</p>
        <template v-if="phase === 'applied_unsaved'">
          <p class="warning" role="alert" data-testid="writer-agent-save-failure">{{ initialCommitted ? '追加已保存，但后续修改尚未保存。重试只保存现有正文，不会再次追加。' : '追加正文仍保留在本页，保存失败。重试仅保存现有正文，不会再次追加或调用模型。' }}</p>
          <button data-testid="writer-agent-retry-save" @click="emit('retry-save')">仅重试保存</button>
        </template>
        <p v-if="phase === 'applied'" role="status" data-testid="writer-agent-saved">本次追加已保存。</p>
      </section>
      <p v-if="localError || snapshot.error" class="warning" role="alert" data-testid="writer-agent-status">{{ localError || snapshot.error?.message }}</p>
      <details class="card" data-testid="writer-agent-limits">
        <summary>固定预算与边界</summary>
        <p>最多 2 次模型请求，每次预留 1,200 输出 token，合计 2,400；最多 1 次本地检索、6 条候选、6,000 字符依据。结尾摘录最多 2,000 UTF-16 单元，草稿最多 2,000 单元，期望短续写约 200–500 字。</p>
        <p>每次模型请求 30 秒、响应 65,536 字节；本地准备 90 秒；累计活跃处理 180 秒，未应用授权最多 20 分钟。单次输入最多 16,384 单元 / 65,536 字节。最多 2,500 个已披露章节 / 1,200 万归一化字符，超限不截断冒充完整。</p>
        <p>预算不是金额上限，也不保证所有模型的隐含思考费用。已发请求不能撤回；保存开始后不能由上述时限取消。读取可先水合已保存小说集合，不是全应用 CPU / 内存硬上限。</p>
        <p>草稿和授权仅在本页内存中，刷新可能丢失；需要保留时请复制。</p>
      </details>
      <section class="card" data-testid="writer-agent-audit" aria-label="脱敏运行记录">
        <p>模型预留 {{ snapshot.budget.modelReservations }} / 2 · 输出预留 {{ snapshot.budget.outputTokensReserved }} / 2,400 · 工具预留 {{ snapshot.budget.toolReservations }} / 1</p>
        <p v-for="usage in snapshot.usage" :key="usage.requestId">{{ usage.phase === 'plan' ? '规划' : '草稿' }}：{{ usage.status }}；来源：{{ usageSourceLabel(usage.usageSource) }}；输入 {{ tokenCount(usage.inputTokens) }} · 输出 {{ tokenCount(usage.outputTokens) }} · 合计 {{ tokenCount(usage.totalTokens) }}</p>
        <ol><li v-for="event in snapshot.audit" :key="event.sequence">{{ event.sequence }} · {{ event.kind }} · {{ event.elapsedMs }} ms</li></ol>
        <button data-testid="writer-agent-copy-audit" @click="emit('copy-audit')">复制脱敏运行记录（无正文或查询）</button>
      </section>
      <button data-testid="writer-agent-close" @click="emit('close')">{{ savePending ? '保存完成后关闭' : '关闭' }}</button>
    </section>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WriterAgentSnapshot, WriterAgentUsage } from '@/types/writerAgent'
import type { WriterAgentUiPhase } from '@/composables/useWriterAgent'
const props = defineProps<{
  visible: boolean; phase: WriterAgentUiPhase; snapshot: WriterAgentSnapshot
  brief: string; cutoffId: string; granted: boolean; selectedHitIds: string[]
  chapters: { id: string; title: string; ordinal: number }[]; targetTitle: string
  canPreview: boolean; blocker: string; draftText: string; localError: string; initialCommitted: boolean
}>()
const emit = defineEmits<{
  'update:brief': [value: string]; 'update:cutoffId': [value: string]; 'update:granted': [value: boolean]
  selection: [ids: string[]]; preview: []; start: []; approve: []; cancel: []; append: []
  'retry-save': []; copy: []; 'copy-audit': []; close: []
}>()
const activePhase = computed(() => ['previewing', 'planning', 'executing_retrieval_tool', 'selecting_evidence', 'drafting'].includes(props.phase))
const evidencePhase = computed(() => ['awaiting_evidence', 'selecting_evidence'].includes(props.phase))
const receiptPhase = computed(() => ['executing_retrieval_tool', 'awaiting_evidence', 'selecting_evidence', 'drafting', 'awaiting_author'].includes(props.phase))
const draftPhase = computed(() => ['awaiting_author', 'applying', 'commit_pending', 'commit_unknown', 'applied_unsaved', 'applied'].includes(props.phase))
const savePending = computed(() => ['commit_pending', 'commit_unknown', 'applied_unsaved'].includes(props.phase))
const controlsLocked = computed(() => activePhase.value || evidencePhase.value || draftPhase.value)
const phaseLabels: Partial<Record<WriterAgentUiPhase, string>> = { previewing: '正在读取已保存原文并准备本地预览…', planning: '正在请求严格的单工具计划…', executing_retrieval_tool: '正在执行本次授权的本地检索…', selecting_evidence: '正在校验作者选择…', drafting: '正在根据所选原文生成短续写…' }
const phaseText = computed(() => phaseLabels[props.phase] ?? '正在处理…')
const usageSourceLabel = (source: WriterAgentUsage['usageSource']) => ({ reported: '服务商报告', estimated: '估计（不作为实际用量）', unavailable: '未提供', unknown: '未知' }[source])
const tokenCount = (count: number | null) => count === null ? '未知' : String(count)
const valueOf = (event: Event) => (event.target as HTMLInputElement).value
const checked = (event: Event) => (event.target as HTMLInputElement).checked
const selectHit = (id: string, value: boolean) => emit('selection', value ? [...props.selectedHitIds, id] : props.selectedHitIds.filter(item => item !== id))
// Element Plus owns focus trap/restore and routes X, Escape and overlay here.
// Never call done(): only the controller can close after a post-append save.
const requestClose = () => emit('close')
</script>

<style scoped>
.writer-agent-panel { max-height: 72vh; overflow-y: auto; overflow-wrap: anywhere; padding: 0 4px 12px; }
.fields, .fields label { display: grid; gap: 8px; }
.fields { gap: 12px; }
textarea, select { box-sizing: border-box; width: 100%; color: var(--el-text-color-primary); background: var(--el-bg-color); border: 1px solid var(--el-border-color); border-radius: 5px; padding: 8px; font: inherit; }
textarea { resize: vertical; min-height: 72px; }
.card { border: 1px solid var(--el-border-color); border-radius: 8px; padding: 12px; margin: 12px 0; }
.card h4, .evidence h5 { margin: 0 0 8px; }
pre, blockquote { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; margin: 8px 0; background: var(--el-fill-color-light); padding: 10px; border-radius: 4px; }
.evidence + .evidence { border-top: 1px solid var(--el-border-color); margin-top: 12px; padding-top: 12px; }
.muted, .digest { color: var(--el-text-color-secondary); font-size: 12px; }
.warning { color: var(--el-color-warning-dark-2); }
.check { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 10px; }
.check input { margin-top: 3px; flex-shrink: 0; }
button { cursor: pointer; color: var(--el-color-primary); border: 1px solid var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); border-radius: 5px; padding: 8px 12px; min-height: 36px; white-space: normal; }
button:disabled { cursor: not-allowed; opacity: .55; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
@media (max-width: 480px) { .writer-agent-panel { max-height: 68vh; } .card { padding: 9px; } .actions button { width: 100%; } }
</style>
