<template>
  <section class="creative-pilot" data-testid="creative-pilot-panel" aria-label="Three-chapter creative pilot" :aria-busy="busy || loading">
    <h2>Creative Pilot v4 · 从创作简报到三章正文</h2>
    <p class="notice" data-testid="creative-pilot-boundary">任意简报 → 大纲 → 人设 → 细纲 → 全部三份章纲 → 三章正文。一份明确授权最多九次请求，一次只有一个请求，没有自动重试或修复。
      Structural acceptance only; live literary quality, semantic consistency and million-character acceptance: NOT_RUN.</p>
    <p data-testid="creative-pilot-retention">仅保存在本地 Campaign，不写入普通 Writer、事实库或备份。原始回复和派生规划分别保留至 Campaign 生命周期结束；过期不会删除记录、退款或消除未知请求。</p>
    <p data-testid="creative-pilot-default-host">默认 App 没有可调用的生产者。仅独立安装的受控测试 host 可调用 loopback SDK；没有真实端点、凭证、token 计费或花费授权。</p>
    <div class="actions">
      <button data-testid="creative-pilot-new-draft" :disabled="busy || loading || externalBusy" @click="newDraft">新建空白草稿 / New blank draft</button>
      <button data-testid="creative-pilot-refresh" :disabled="busy || loading || externalBusy || !selectedV4" @click="refresh">重新读取 / Inspect durable state</button>
      <button v-if="busy || loading" data-testid="creative-pilot-stop" @click="stop">停止本实例 / Stop locally</button>
    </div>
    <div v-if="ids.length" class="campaign-choices" aria-label="Select a campaign for inspection">
      <button v-for="id in ids" :key="id" :data-testid="`creative-pilot-select-${id}`" :disabled="externalBusy"
        :aria-pressed="campaignId === id" @click="$emit('select', id)">{{ id }}</button>
    </div>
    <p v-if="error" role="alert" data-testid="creative-pilot-error">{{ error }} · 操作未获确认；重新检查持久记录，不重放未知请求。</p>
    <p v-if="notice !== 'none'" role="status" data-testid="creative-pilot-notice">{{ noticeText }}</p>
    <fieldset :disabled="!canEdit">
      <legend>{{ draftMode ? '新创作简报 / New brief' : '候选简报编辑器 / Candidate brief editor · 修改须明确提交替换' }}</legend>
      <label>语言 / Language
        <select data-testid="creative-pilot-language" :value="language" :disabled="!canEdit || !draftMode" @change="editField('language', $event)">
          <option value="zh">中文</option><option value="en">English</option>
        </select>
      </label>
      <label for="creative-pilot-premise">Premise · 保留原始字符、空格与换行</label>
      <textarea id="creative-pilot-premise" data-testid="creative-pilot-premise" :value="premise" rows="5" spellcheck="false" maxlength="4096" @input="editField('premise', $event)" />
      <label for="creative-pilot-constraints">Constraints · JSON string array（0–8 项，例如 []；不是逐行拆分）</label>
      <textarea id="creative-pilot-constraints" data-testid="creative-pilot-constraints" :value="constraints" rows="4" spellcheck="false" maxlength="8192" @input="editField('constraints', $event)" />
      <p>简报与约束文字合计 ≤1,024 UTF-16 units / 4,096 UTF-8 bytes。固定三章，每章目标 512 canonical Unicode scalars，结构接纳范围 256–1,024；原始正文另限 2,048 UTF-16 / 8 KiB。字数不是质量证明。</p>
    </fieldset>
    <div v-if="draftMode" class="actions">
      <button data-testid="creative-pilot-prepare" :disabled="!idle" @click="prepare">Prepare · 保存简报，零调用</button>
      <p>Prepare 开始固定 15 分钟执行有效期；它不是 Start，不授予调用权限。未保存草稿没有该计时器。</p>
    </div>
    <template v-else-if="snapshot">
      <dl class="metadata" data-testid="creative-pilot-identity">
        <dt>Campaign / version</dt><dd>{{ snapshot.manifest.campaignId }} / v4</dd>
        <dt>Candidate / brief</dt><dd>{{ snapshot.candidate.hash }}<br>{{ snapshot.candidate.briefHash }}</dd>
        <dt>Head / epoch</dt><dd>{{ snapshot.head.sequence }} / {{ snapshot.head.executionEpoch }}</dd>
        <dt>Fixed execution expiry</dt><dd>{{ new Date(snapshot.manifest.expiresAt).toISOString() }} · {{ expired ? 'expired' : 'not renewed by Resume' }}</dd>
        <dt>Durable / effective status</dt><dd data-testid="creative-pilot-status" :data-status="status">{{ snapshot.checkpoint.status }} / {{ status }}</dd>
        <dt>Reason</dt><dd>{{ snapshot.checkpoint.reason ?? 'none' }}</dd>
      </dl>
      <section aria-label="Durable brief replacement">
        <h3>一次明确替换简报 / One explicit brief replacement</h3>
        <p>只有首次预留之前才可替换一次；会产生新候选并撤销旧预览，不延长有效期或补回九次额度。任何已花费、未派发或未知预留之后都拒绝替换。</p>
        <div class="actions"><button data-testid="creative-pilot-replace-preview" :disabled="!canReplace" @click="previewReplacement">核验替换预览 / Preview replacement</button></div>
        <div v-if="replacementPreview" data-testid="creative-pilot-replacement-preview">
          <p>{{ replacementPreview.bytes }} bytes / {{ replacementPreview.utf16 }} UTF-16 units · local draft digest {{ replacementPreview.digest }}</p>
          <pre>{{ replacementPreview.brief }}</pre>
          <button data-testid="creative-pilot-replace-commit" :disabled="!canReplace" @click="replace">明确提交当前简报替换 / Commit replacement</button>
        </div>
        <p v-if="snapshot.checkpoint.budget.attempts > 0" data-testid="creative-pilot-replacement-refused">replacement_after_reservation · 已有预留，不能把本次运行改名为新的九次运行。</p>
      </section>
      <div class="actions">
        <button data-testid="creative-pilot-dry-prepare" :disabled="!canDryPrepare" @click="dryPrepare">精确输入预览 / Dry prepare, zero calls</button>
      </div>
      <div v-if="preview" data-testid="creative-pilot-preview">
        <p data-testid="creative-pilot-readiness">{{ preview.readiness }} · 预览不授予调用权限，Start/Resume 会重新核验。</p>
        <dl class="metadata">
          <dt>Endpoint / model</dt><dd>{{ preview.adapter?.endpointIdentity ?? 'unconfigured' }}<br>{{ preview.adapter?.effectiveModelId ?? 'none' }}</dd>
          <dt>Configuration revision</dt><dd>{{ preview.adapter?.configurationRevision ?? 'none' }}</dd>
          <dt>Input digest</dt><dd>{{ preview.prepared.inputDigest }}</dd>
          <dt>Prepared wire</dt><dd>{{ preview.prepared.inputBytes }} bytes / {{ preview.prepared.inputUtf16 }} UTF-16 units</dd>
        </dl>
      </div>
      <div v-if="displayedInput" data-testid="creative-pilot-source-inventory">
        <h3>Exact disclosed input · {{ preview ? '当前预览' : '最后已保留请求' }}</h3>
        <p>未来计划属于作者意图，不是正文事实、角色知识或提早向读者披露的许可。当前正文请求包含完整全局规划、所选章纲和全部已接纳前章正文；其余章纲文本明确列为未提供。Hash 不是已提供的文本。</p>
        <pre>{{ displayedInput.scope }}</pre>
        <ul><li v-for="source in displayedInput.sourceRefs" :key="source.hash">{{ source.taskId }} r{{ source.revision }} · {{ source.hash }}</li></ul>
        <p>Full-plan root: {{ displayedInput.fullPlanRoot ?? 'not yet available' }}<br>Catalog digest: {{ displayedInput.catalogDigest }}</p>
        <details data-testid="creative-pilot-exact-input"><summary>本地精确 system / prompt（只读，不导出）</summary><pre>{{ displayedInput.wire.system }}</pre><pre>{{ displayedInput.wire.prompt }}</pre></details>
      </div>
      <label class="grant" data-testid="creative-pilot-consent">
        <input type="checkbox" :checked="consent" :disabled="!preview || busy || loading || externalBusy" @change="consent = ($event.target as HTMLInputElement).checked">
        我明确授权当前候选剩余的固定九任务范围：自动发送未来生成的规划和全部已接纳前章正文；结构有效的结果自动接纳到本地 Campaign。最多九次累计请求，无重试/修复。未来正文尚未产生，不假称已预览其文字。仅限所示受控离线 host。
      </label>
      <div class="actions">
        <button data-testid="creative-pilot-start" :disabled="!canStart" @click="start">Start · 一次授权推进九任务</button>
        <button data-testid="creative-pilot-resume" :disabled="!canResume" @click="resume">Resume · 显式继续，不重置额度</button>
        <button v-if="!busy && !loading" data-testid="creative-pilot-stop" :disabled="!snapshot" @click="stop">Stop locally · 只撤销本实例权限</button>
        <button data-testid="creative-pilot-cancel" :disabled="!canCancel" @click="cancel">Cancel · 持久取消</button>
      </div>
      <p>停止、离开页面或刷新都不会自动恢复。已写入 intent 的请求不可重放，且可能已经产生费用。暂停在 intent 之前的同一预留只能在原始剩余期限内继续；新 JavaScript 实例不产生新的 60 秒。</p>
      <p v-if="unknownCount" class="notice" data-testid="creative-pilot-unknown">{{ unknownCount }} 个请求存在 intent / unknown。禁止重新调用；W/U/P、尝试和 token 预留仍保留。没有“重试模型”按钮。</p>
      <section v-if="retainedRow || reservedRow" aria-label="Local resolution only">
        <p>下面的动作不会调用 SDK，也不会自动进入下一任务。接纳仍需精确来源及结构检查；关闭不发布是记录的权限撤销，不是假称正文语义错误。</p>
        <div class="actions">
          <button data-testid="creative-pilot-resolve-retained" :disabled="!canResolve" @click="resolve">Resolve retained · 仅本地核验并接纳</button>
          <button data-testid="creative-pilot-close-without-publication" :disabled="!canClose" @click="closeWithoutPublication">Close without publication · 不发布地结清已知结果</button>
        </div>
      </section>
      <section data-testid="creative-pilot-progress" aria-label="Observed generation progress" aria-live="polite">
        <h3>九任务进度 / Nine-task progress</h3>
        <p v-if="progress">{{ progress.kind }} · {{ progress.taskId ?? 'run' }}。这是当前操作的观察，不是跨页签持续授权。</p>
        <p data-testid="creative-pilot-counts">{{ acceptedTasks }} / 9 accepted tasks · {{ acceptedBodies }} / 3 bodies · {{ attempts }} / 9 reserved attempts · {{ bodyCharacters }} canonical body scalars</p>
        <ol><li v-for="task in taskRows" :key="task.taskId" :data-testid="`creative-pilot-task-${task.taskId}`" :data-status="task.observedStatus">
          {{ task.taskId }} · {{ task.kind }} · {{ task.observedStatus }} <span v-if="busy && task.observedStatus !== task.status">(live observation; last inspected {{ task.status }})</span>
        </li></ol>
      </section>
      <section data-testid="creative-pilot-budgets">
        <h3>已核验累计账本 / Last verified accounting</h3>
        <p v-if="busy">运行中的进度不会伪装成已重新核验的完整快照；下面是最后读取/完成时的持久值。</p>
        <dl class="metadata">
          <dt>W / U / P</dt><dd>{{ storage?.written }} / {{ storage?.outstanding }} / {{ storage?.recovery }} bytes · same limit {{ storage?.limit }}</dd>
          <dt>Released unused storage</dt><dd>{{ storage?.released }} bytes（不退调用、token 或时间预留）</dd>
          <dt>Input / response byte reservations</dt><dd>{{ snapshot.checkpoint.budget.inputBytes }} / {{ snapshot.checkpoint.budget.responseBytes }} bytes</dd>
          <dt>Output-token reservations</dt><dd>{{ snapshot.checkpoint.budget.outputTokens }} / 36,864 · 4,096 per call</dd>
          <dt>Input-token admission</dt><dd>not_enforced_offline_control · bytes 不是 tokens</dd>
          <dt>Conservative active reservation</dt><dd>{{ snapshot.checkpoint.budget.activeMs }} / 600,000 ms（不是跨重启 CPU 实测）</dd>
          <dt>Recovery slots</dt><dd>{{ snapshot.checkpoint.metadata.recoveryUsed }} / 3 · final cancel separately protected</dd>
          <dt>Observed synthetic usage</dt><dd>{{ observedUsage.input ?? 'unknown' }} input / {{ observedUsage.output ?? 'unknown' }} output / {{ observedUsage.reasoning ?? 'unknown' }} reasoning · {{ observedUsage.incomplete }} incomplete observations. Not a bill.</dd>
        </dl>
      </section>
      <section aria-label="Retained original responses">
        <h3>原始回复与结果 / Retained responses and outcomes</h3>
        <details v-for="row in requestRows" :key="row.requestHash" data-testid="creative-pilot-response" :data-request-hash="row.requestHash">
          <summary>{{ row.request?.taskId }} · {{ row.phase?.status }} · {{ row.phase?.resolution?.outcome ?? 'unresolved' }}</summary>
          <dl class="metadata"><dt>Request / phase</dt><dd>{{ row.requestHash }}<br>{{ row.phaseHash }}</dd><dt>Reason</dt><dd>{{ row.phase?.resolution?.reason ?? row.phase?.reason ?? 'none' }}</dd><dt>Actual HTTP body binding</dt><dd><pre>{{ row.phase?.dispatchWire ?? 'no durable intent' }}</pre></dd></dl>
          <template v-if="row.response">
            <p>Response {{ row.response.hash }} · finish {{ row.response.finishReason }} · reported model {{ row.response.reportedModel.status }} · content {{ row.response.contentEvidence }}</p>
            <p>Lossless visible text JSON string literal（不是 raw HTTP；保留空白与无效 surrogate 的转义）</p>
            <pre>{{ row.response.textJson }}</pre>
          </template>
          <p v-else>没有可信的完整持久回复。缺失不是空回复，也不是零用量。</p>
        </details>
      </section>
      <section aria-label="Accepted plans and bodies">
        <h3>结构接纳的规划与正文 / Unreviewed artifacts</h3>
        <details v-for="artifact in artifactRows" :key="artifact.hash" data-testid="creative-pilot-artifact" :data-task="artifact.taskId">
          <summary>{{ artifact.taskId }} · {{ artifact.kind }} · {{ artifact.canonical.scalars }} canonical scalars · not_reviewed</summary>
          <p data-testid="creative-pilot-artifact-metrics">Raw {{ artifact.raw.utf8Bytes }} UTF-8 bytes / {{ artifact.raw.utf16Units }} UTF-16 units / {{ artifact.raw.scalars }} scalars; canonical {{ artifact.canonical.utf8Bytes }} UTF-8 bytes / {{ artifact.canonical.utf16Units }} UTF-16 units / {{ artifact.canonical.scalars }} scalars.</p>
          <p>{{ artifact.hash }}<br>Raw response {{ artifact.responseHash }}<br>Compiler {{ artifact.compilerVersion }} · catalog {{ artifact.catalogRoot }}</p>
          <pre>{{ artifact.text }}</pre>
        </details>
      </section>
    </template>
    <p v-else-if="loading" role="status">正在完整核验 v4 历史、来源和账本；尚无可用于操作的快照。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, toRef, watch } from 'vue'
import { useCreativePilotLab } from '@/composables/useCreativePilotLab'

const props = withDefaults(defineProps<{ campaignId: string; selectedV4: boolean; ids?: string[]; externalBusy?: boolean }>(), { ids: () => [], externalBusy: false })
const emit = defineEmits<{ created: [id: string]; select: [id: string]; version: [version: 4 | null]; busy: [value: boolean] }>()
const lab = useCreativePilotLab({ campaignId: toRef(props, 'campaignId'), selectedV4: toRef(props, 'selectedV4'), externalBusy: toRef(props, 'externalBusy'),
  onCreated: id => emit('created', id), onVersion: version => emit('version', version) })
const { snapshot, preview, progress, language, premise, constraints, draftMode, busy, loading, error, notice, consent, replacementPreview,
  idle, expired, attempts, acceptedTasks, acceptedBodies, bodyCharacters, requestRows, unknownCount, retainedRow, reservedRow,
  taskRows, artifactRows, displayedInput, storage, observedUsage, canReplace, canEdit, canDryPrepare, canStart, canResume,
  canResolve, canClose, canCancel, status, edit, newDraft, refresh, prepare, dryPrepare, previewReplacement,
  start, resume, replace, resolve, closeWithoutPublication, cancel, stop } = lab
const noticeText = computed(() => ({ none: '', prepared: '已持久准备；尚未授权或调用。', replaced: '已接纳新的简报候选；旧预览与权限已撤销。',
  stopped: '本实例权限已撤销。持久结果尚需重新读取确认；停止不保证零调用或零费用。', unconfirmed: '当前动作或持久结果未确认；请重新读取，不重新调用未知请求。',
  inspected: '已重新核验持久状态；检查不会授予执行权限。', resolved: '已执行本地结清；没有 SDK 调用或自动下一步。', cancelled: '持久取消已确认；未知请求义务仍保留。' })[notice.value])
function editField(field: 'language' | 'premise' | 'constraints', event: Event) {
  const input = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  if (!edit(field, input.value)) input.value = field === 'language' ? language.value : field === 'premise' ? premise.value : constraints.value
}
watch([busy, loading], ([active, reading]) => emit('busy', active || reading), { flush: 'sync' })
onUnmounted(() => { lab.dispose(); emit('busy', false) })
defineExpose({ refresh, stop })
</script>

<style scoped>
.creative-pilot { border: 2px solid var(--el-border-color, #bbc8d4); border-radius: 10px; padding: 20px; margin: 28px 0; line-height: 1.6; }
.notice { border-left: 4px solid #356e9a; background: var(--el-color-primary-light-9, #edf5fc); padding: 12px 16px; }
fieldset { border: 1px solid var(--el-border-color, #bdc4ce); border-radius: 6px; padding: 16px; margin: 16px 0; }
label { display: block; margin: 10px 0; font-weight: 600; }
textarea { box-sizing: border-box; width: 100%; resize: vertical; padding: 10px; font: inherit; color: inherit; background: var(--el-bg-color, white); border: 1px solid var(--el-border-color, #bdc4ce); border-radius: 6px; }
select { font: inherit; padding: 6px; margin-left: 8px; }
.actions, .campaign-choices { display: flex; flex-wrap: wrap; gap: 10px; margin: 14px 0; }
button { border: 1px solid var(--el-border-color, #bdc4ce); border-radius: 6px; padding: 9px 13px; background: var(--el-bg-color, white); color: inherit; font: inherit; cursor: pointer; overflow-wrap: anywhere; }
button:disabled { opacity: .5; cursor: not-allowed; }
button[aria-pressed="true"] { border-color: #2876c9; }
button:focus-visible, select:focus-visible, textarea:focus-visible, input:focus-visible, summary:focus-visible { outline: 3px solid #2876c9; outline-offset: 3px; }
.metadata { display: grid; grid-template-columns: minmax(140px, 230px) minmax(0, 1fr); gap: 8px 18px; }
dt { font-weight: 600; } dd { margin: 0; overflow-wrap: anywhere; }
details { border: 1px solid var(--el-border-color, #bdc4ce); border-radius: 6px; padding: 12px; margin: 12px 0; }
summary { cursor: pointer; } pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; } [role="alert"] { color: var(--el-color-danger, #9b2323); }
.grant { padding: 12px; border: 1px solid var(--el-border-color, #bdc4ce); font-weight: normal; }
@media (max-width: 600px) { .creative-pilot { padding: 14px; } .metadata { grid-template-columns: 1fr; gap: 2px; } dd { margin-bottom: 10px; } .actions button { width: 100%; } }
</style>
