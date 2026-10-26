<template>
  <main class="campaign-lab" data-testid="campaign-lab" :aria-busy="busy || loading">
    <a href="#/" class="back-link">← 返回 LLM-Writer</a>
    <h1>Campaign Lab</h1>
    <p class="notice" data-testid="campaign-boundary"><strong>离线持久化验证，非自主小说</strong><br>
      只有固定的小型合成案例。Campaign 执行不读取 API 配置、不调用真实模型、不导入旧小说或追加 Writer 正文。创建、重开与恢复都不会自动执行任务。</p>
    <p data-testid="campaign-planning-boundary">可选 Planning Contract v1 验证四阶段规划与精确修订上下文；规划意图不是已成立的正文事实。Offline fixture only · semantic consistency / autonomous generation / whole-work audit: NOT RUN.</p>
    <p data-testid="campaign-local-only">Campaign 数据仅在此浏览器本地，普通 Writer 备份与恢复不包含它。清除浏览器数据会丢失 Campaign；本页没有上传、同步或完整导出。</p>
    <div class="actions">
      <button data-testid="campaign-create-zh" :disabled="busy || loading" @click="create('zh')">创建中文小案例</button>
      <button data-testid="campaign-create-en" :disabled="busy || loading" @click="create('en')">创建英文小案例</button>
      <button data-testid="campaign-create-planning-zh" :disabled="busy || loading || !planningAvailable" @click="createPlanning('zh')">创建中文规划案例（3 章）</button>
      <button data-testid="campaign-create-planning-en" :disabled="busy || loading || !planningAvailable" @click="createPlanning('en')">Create English planning fixture (3 chapters)</button>
      <button data-testid="campaign-create-body-evidence-zh" :disabled="busy || loading || !bodyEvidenceAvailable" @click="createBodyEvidence('zh')">创建中文正文证据案例（3 章）</button>
      <button data-testid="campaign-create-body-evidence-en" :disabled="busy || loading || !bodyEvidenceAvailable" @click="createBodyEvidence('en')">Create English body-evidence fixture (3 chapters)</button>
      <button data-testid="campaign-refresh" :disabled="busy || loading" @click="refresh">重新读取持久状态</button>
    </div>
    <p v-if="error" role="alert" data-testid="campaign-error">{{ error }}</p>
    <section aria-label="本地 Campaign" data-testid="campaign-list">
      <h2>本地 Campaign</h2>
      <p v-if="!ids.length">{{ loading ? '正在读取…' : '尚无 Campaign。不会自动创建或执行。' }}</p>
      <ul v-else class="campaign-list">
        <li v-for="id in ids" :key="id"><button :data-testid="`campaign-select-${id}`" :disabled="busy || loading" :aria-pressed="selectedId === id" @click="select(id)">{{ id }}</button></li>
      </ul>
    </section>
    <section v-if="snapshot" aria-label="持久化检查" data-testid="campaign-inspection">
      <h2>持久化检查</h2>
      <p v-if="readOnly" class="notice" data-testid="campaign-read-only">旧版 Campaign v1 仅可检查，不能执行、恢复、取消或迁移。原始数据保持不变；旧预留不解释为可回收空间。</p>
      <dl class="metadata">
        <dt>Campaign</dt><dd data-testid="campaign-id">{{ snapshot.manifest.campaignId }}</dd>
        <dt>语言 / 模式</dt><dd>{{ snapshot.manifest.language }} / offline_fixture</dd>
        <dt>Fixture profile</dt><dd data-testid="campaign-profile">{{ snapshot.manifest.fixtureVersion }}</dd>
        <dt>执行状态</dt><dd data-testid="campaign-status" :data-status="status">{{ status === 'completed' ? 'fixture_complete' : status }}</dd>
        <dt>任务完成</dt><dd data-testid="campaign-task-progress">{{ completedTasks }} / {{ taskRows.length }}（不是长篇验收）</dd>
        <dt>正文目标进度</dt><dd data-testid="campaign-target-progress">{{ snapshot.checkpoint.bodyCharacters }} / {{ snapshot.manifest.bodyTarget.characters }} Unicode scalar characters</dd>
        <dt>长篇验收</dt><dd data-testid="campaign-acceptance">longformAcceptance: NOT_RUN</dd>
        <dt>语义连续性</dt><dd>not_reviewed；未验证题材、剧情、人设或伏笔无漂移</dd>
        <dt>Head / epoch</dt><dd data-testid="campaign-head">{{ snapshot.head.sequence }} / {{ snapshot.head.executionEpoch }}</dd>
        <dt>Manifest hash</dt><dd>{{ snapshot.manifest.hash }}</dd>
        <dt>Checkpoint hash</dt><dd>{{ snapshot.checkpoint.hash }}</dd>
        <dt>原因</dt><dd data-testid="campaign-reason">{{ snapshot.checkpoint.reason ?? '无' }}</dd>
      </dl>
      <p v-if="locallyStopped" data-testid="campaign-persistent-outcome" :data-outcome="persistentOutcome" role="status">
        本实例已停止。{{ persistentOutcome === 'confirmed' ? '持久状态已确认。' : persistentOutcome === 'pending' ? '正在确认持久状态…' : '持久状态未确认；不要假定其他页签已经停止。' }}
      </p>
      <div class="actions">
        <button data-testid="campaign-step" :disabled="!canStep" @click="step">执行一步，到安全 checkpoint</button>
        <button v-if="canSaveOnly" data-testid="campaign-save-only" :disabled="!canSaveOnly" @click="saveOnly">仅保存已保留结果（不调用模型）</button>
        <button data-testid="campaign-pause" :disabled="!canStop" @click="pause">暂停</button>
        <button data-testid="campaign-resume" :disabled="!canResume" @click="resume">恢复就绪（不执行）</button>
        <button data-testid="campaign-cancel" :disabled="!canStop" @click="cancel">取消</button>
      </div>
      <p>一次只处理一个任务，没有后台循环。关闭页面只停止本实例，不等于已持久化全局取消。取消之前已持久化的 dispatch intent 仍可能调用；取消不承诺零请求或零费用。</p>
      <p v-if="unresolved || inactiveUnknownRequests" class="notice" data-testid="campaign-unknown">请求结果未知，禁止重放模型调用。未解决的存储义务与模型预算继续保留；替换候选、暂停或取消都不会释放它们。本页没有“重试模型”按钮。</p>
      <section v-if="planningProfile" data-testid="campaign-planning-preview" aria-label="规划上下文只读预览" :aria-busy="previewLoading">
        <h3>Planning Contract v1 · 规划上下文只读预览</h3>
        <p>先接纳大纲、人设、细纲与全部章纲，才能预览。选择章节只在本地编译 planning_preview；不预留请求、不派发、不保存正文，也不授予后续执行权限。正文 fixture 仍由上方“一步”按钮按依赖顺序单独处理。</p>
        <div class="actions" aria-label="选择预览章节">
          <button v-for="chapter in chapterRows" :key="chapter.taskId" :data-testid="`campaign-preview-chapter-${chapter.ordinal}`"
            :disabled="!canPreview" :aria-pressed="selectedChapter === chapter.ordinal" @click="previewChapter(chapter.ordinal)">
            Chapter {{ chapter.ordinal }} · {{ chapter.status }}
          </button>
        </div>
        <p v-if="previewLoading" role="status" data-testid="campaign-preview-loading">正在重新核验来源并编译本地预览…</p>
        <p v-else-if="!planningPreview" data-testid="campaign-preview-empty">请选择章节重新读取；已有预览会在读取状态、执行、暂停、取消或切换 Campaign 时清除。</p>
        <p v-else-if="planningPreview.status === 'refused'" role="status" data-testid="campaign-preview-refusal">预览拒绝 / refused: {{ planningPreview.refusalCode }}。没有新请求或正文保存；先检查任务状态与来源。</p>
        <template v-else>
          <p class="notice" data-testid="campaign-preview-scope">仅规划意图，不是正文事实库。完整全局规划＋所选章纲；未包含其他章纲文本。Planning intent is not established prose truth; declared-reference coverage is not semantic completeness.</p>
          <dl class="metadata">
            <dt>Selected chapter</dt><dd data-testid="campaign-preview-selected">{{ planningPreview.selectedChapter.ordinal }} · {{ planningPreview.selectedChapter.outlineTaskId }} / {{ planningPreview.selectedChapter.bodyTaskId }}</dd>
            <dt>Next eligible body task</dt><dd data-testid="campaign-preview-next-body">{{ planningPreview.nextEligibleBodyTaskId ?? 'none' }}（不代表所选章可越序执行）</dd>
            <dt>Purpose</dt><dd>planning_preview（不是 body_fixture_dispatch）</dd>
            <dt>Canon-base root</dt><dd data-testid="campaign-preview-canon-root">{{ planningPreview.canonBaseRoot }}</dd>
            <dt>Full-plan root</dt><dd data-testid="campaign-preview-plan-root">{{ planningPreview.fullPlanRoot }}</dd>
            <dt>Input digest</dt><dd data-testid="campaign-preview-digest">{{ planningPreview.inputDigest }}</dd>
            <dt>Exact input size</dt><dd data-testid="campaign-preview-size">{{ planningPreview.inputBytes }} UTF-8 bytes / {{ planningPreview.inputUtf16 }} UTF-16 units（不是 provider tokens）</dd>
            <dt>Coverage / scope</dt><dd><pre data-testid="campaign-preview-scope-details">{{ planningPreview.scope }}</pre></dd>
          </dl>
          <h4>Exact source revisions</h4>
          <ul data-testid="campaign-preview-sources"><li v-for="source in planningPreview.sourceRefs" :key="source.hash">{{ source.taskId }} · r{{ source.revision }} · <span class="hash">{{ source.hash }}</span></li></ul>
          <details data-testid="campaign-preview-packet">
            <summary>本地精确 packet（只读；不上传，不导出报告）</summary>
            <pre>{{ planningPreview.input }}</pre>
          </details>
          <p>后续正文步骤将重新验证资格并编译不同的派发 packet；本预览不会复用为请求。远期规划与已隐藏材料的分区只验证声明，不保证模型不会泄露内容。</p>
        </template>
      </section>
      <section v-if="planningProfile" data-testid="campaign-body-evidence" aria-label="Body evidence and coverage read-only preview" :aria-busy="bodyPreviewLoading || bodyDraftLoading">
        <h3>Body Evidence &amp; Coverage v1 · 正文证据与覆盖（只读）</h3>
        <p class="notice" data-testid="campaign-body-semantic-boundary">核验的是已接纳正文的精确来源、原始 UTF-16 引用与声明的前提，不是语义真伪。Proposals are not established facts. Semantic extraction / adjudication / autonomous generation / whole-work audit: NOT RUN.</p>
        <p>仅本地作者预览；不预留、不派发、不保存、不修改 Writer，也不授予读者、角色或外部模型披露权限。固定示例的来源标签和“已检查”范围都是未认证声明，不是独立审阅凭证。</p>
        <div class="actions" aria-label="选择固定示例的已接纳正文前缀">
          <button v-for="prefix in bodyPrefixRows" :key="prefix.taskId" :data-testid="`campaign-body-prefix-${prefix.ordinal}`"
            :disabled="busy || loading" :aria-pressed="bodyPrefix === prefix.ordinal" @click="selectBodyPrefix(prefix.ordinal)">Example prefix 1–{{ prefix.ordinal }}</button>
        </div>
        <p v-if="!bodyPrefixRows.length">尚无连续已接纳正文前缀。先按上方“一步”完成全部规划并接纳正文；此区域不会执行任务。</p>
        <div class="actions">
          <button data-testid="campaign-body-load-example" :disabled="!canLoadBodyDraft" @click="loadBodyEvidenceExample">Load fixed proposal example · 加载固定提案示例</button>
          <button data-testid="campaign-body-validate" :disabled="!canPreviewBody" @click="previewBody">Validate local proposals · 核验本地提案</button>
        </div>
        <p v-if="bodyDraftLoading" role="status" data-testid="campaign-body-draft-loading">正在从本页已读取的精确修订构造固定示例；不会提取语义或调用模型…</p>
        <p v-if="bodyDraftRefusal" role="status" data-testid="campaign-body-draft-refusal">Draft refused: {{ bodyDraftRefusal }}。没有截断、自动修复或保存。</p>
        <label class="body-proposal-label" for="campaign-body-proposal-input">Canonical proposal JSON · 可编辑的未信任本地输入（最多 64 KiB；不持久保存）</label>
        <textarea id="campaign-body-proposal-input" data-testid="campaign-body-proposal-input" :value="bodyDraft" :disabled="busy || loading"
          rows="10" spellcheck="false" @input="editBodyProposal" />
        <p>可编辑任何受支持的封闭提案；核验总是重新读取仓库。前缀选择用于加载示例，手动 JSON 的实际前缀会在结果中单独显示。更改输入、切换预览或重新读取会立即撤销旧结果。</p>
        <p v-if="bodyPreviewLoading" role="status" data-testid="campaign-body-preview-loading">正在重新核验正文来源、引用、前提与覆盖范围…</p>
        <p v-else-if="!bodyPreview" data-testid="campaign-body-preview-empty">尚无核验结果。加载示例或输入规范 JSON，再显式核验；本页不会自动提取或检查小说语义。</p>
        <p v-else-if="bodyPreview.status === 'refused'" role="status" data-testid="campaign-body-preview-refusal">Body evidence refused: {{ bodyPreview.refusalCode }}。无部分就绪结果；没有新请求、保存或语义裁决。</p>
        <div v-else data-testid="campaign-body-preview-ready">
          <p class="notice">Source anchors and declared premises verified only. Semantic review NOT RUN. Producer provenance is an unauthenticated declaration; a complete supplied or declared-examined union is not complete extraction.</p>
          <dl class="metadata">
            <dt>Actual body prefix</dt><dd data-testid="campaign-body-preview-prefix" :data-prefix="bodyPreview.throughChapterOrdinal">1–{{ bodyPreview.throughChapterOrdinal }} / {{ bodyPreview.coverage.availablePrefix.plannedChapterCount }} planned chapters</dd>
            <dt>Purpose / exposure</dt><dd>local_author_continuity_preview / local_author_only（不是 dispatch）</dd>
            <dt>Body prefix root</dt><dd data-testid="campaign-body-preview-root">{{ bodyPreview.bodyPrefixRoot }}</dd>
            <dt>Canon / full-plan roots</dt><dd>{{ bodyPreview.canonBaseRoot }}<br>{{ bodyPreview.fullPlanRoot }}</dd>
            <dt>Packet digest</dt><dd data-testid="campaign-body-preview-digest">{{ bodyPreview.packetDigest }}</dd>
            <dt>Exact packet size</dt><dd data-testid="campaign-body-preview-size">{{ bodyPreview.packetBytes }} UTF-8 bytes / {{ bodyPreview.packetUtf16 }} UTF-16 units（不是 token）</dd>
            <dt>Observed head</dt><dd>{{ bodyPreview.sourceHead.sequence }} / epoch {{ bodyPreview.sourceHead.executionEpoch }} / {{ bodyPreview.sourceHead.rawHeadHash }}</dd>
            <dt>Source identity</dt><dd><pre>{{ bodyPreview.sourceIdentity }}</pre></dd>
            <dt>Available / supplied</dt><dd>{{ bodyPreview.coverage.availablePrefix.totalUtf16Units }} available original UTF-16 units / {{ bodyPreview.coverage.supplied.coveredUtf16Units }} supplied · {{ bodyPreview.coverage.supplied.status }}</dd>
            <dt>Declared examined</dt><dd>{{ bodyPreview.coverage.examinedDeclaration.declaredUtf16Units }} / {{ bodyPreview.coverage.availablePrefix.totalUtf16Units }} original UTF-16 units · {{ bodyPreview.coverage.examinedDeclaration.status }} · {{ bodyPreview.coverage.examinedDeclaration.verification }}</dd>
            <dt>Semantic review</dt><dd>NOT RUN / not_reviewed · relation completeness not_assessed</dd>
            <dt>Proposed claim kinds</dt><dd><pre>{{ bodyClaimCounts }}</pre></dd>
            <dt>Exact coverage / gaps</dt><dd><pre data-testid="campaign-body-preview-coverage">{{ bodyPreview.coverage }}</pre></dd>
          </dl>
          <template v-if="bodyPacket">
            <h4>Exact stored body revisions · 不等于已提供全文</h4>
            <ul data-testid="campaign-body-preview-sources"><li v-for="source in bodyPacket.bodySources" :key="source.artifact.hash">Chapter {{ source.chapterOrdinal }} · {{ source.artifact.taskId }} r{{ source.artifact.revision }} · {{ source.artifact.hash }} · {{ source.rawUtf16Units }} original UTF-16 units</li></ul>
            <p>Planning records supplied / omitted: {{ bodyPacket.planning.suppliedRecordCount }} / {{ bodyPacket.planning.omittedRecordCount }}. Omitted chapter-outline texts: {{ bodyPacket.planning.chapterOutlinesOmitted }}; omitted scenes: {{ bodyPacket.planning.chapterOutlineScenesOmitted }}. Roots do not supply omitted text.</p>
          </template>
          <details data-testid="campaign-body-preview-packet"><summary>Exact local packet / citations（只读；不上传、不保存）</summary><pre>{{ bodyPreview.packetText }}</pre></details>
          <p>这是核验时的观察，不是持续跨页签授权。来源后来变化时必须重新读取并核验；不得把此 packet 用作请求、事实库或语义通过凭据。</p>
        </div>
      </section>
      <h3>任务依赖与状态</h3>
      <ol data-testid="campaign-tasks"><li v-for="task in taskRows" :key="task.taskId">{{ task.kind }} · r{{ task.revision }} · {{ task.status }}</li></ol>
      <section data-testid="campaign-budgets" aria-label="累计预算与观测用量">
        <h3>累计预算与观测用量</h3>
        <p>预留不是账单；未知成本不记为零。预算跨重开保留，不因暂停或取消退款。</p>
        <dl class="metadata">
          <dt>请求预留</dt><dd>{{ snapshot.checkpoint.budget.attempts }} / {{ snapshot.manifest.budget.attempts }}</dd>
          <dt>输出 token 预留</dt><dd>{{ snapshot.checkpoint.budget.outputTokens }} / {{ snapshot.manifest.budget.outputTokens }}</dd>
          <dt>输入 UTF-8 bytes 预留</dt><dd>{{ snapshot.checkpoint.budget.inputBytes }} / {{ snapshot.manifest.budget.inputBytes }}</dd>
          <template v-if="storageSummary">
            <dt>累计实际序列化写入 W</dt><dd data-testid="campaign-storage-written">{{ storageSummary.written }} / {{ storageSummary.limit }} bytes（非实时占用或浏览器物理空间保证）</dd>
            <dt>未解决存储义务 U</dt><dd data-testid="campaign-storage-outstanding">{{ storageSummary.outstanding }} bytes · {{ storageSummary.openAllocations }} 个未结清分配</dd>
            <dt>剩余恢复保护池 P</dt><dd data-testid="campaign-storage-recovery">{{ storageSummary.recoveryRemaining }} bytes（包含最终取消保护）</dd>
            <dt>已接纳结果释放的未用额度</dt><dd data-testid="campaign-storage-released">{{ storageSummary.released }} bytes（不删除历史写入，不退模型预算或费用）</dd>
            <dt>非活动未知请求</dt><dd data-testid="campaign-inactive-unknown">{{ inactiveUnknownRequests }}（旧候选失效仍保留义务，不可附加到新候选）</dd>
          </template>
          <template v-else-if="legacyStorageSummary">
            <dt>v1 累计序列化写入</dt><dd data-testid="campaign-legacy-written">{{ legacyStorageSummary.written }} / {{ legacyStorageSummary.limit }} bytes</dd>
            <dt>v1 永久存储预留</dt><dd data-testid="campaign-legacy-reserved">{{ legacyStorageSummary.reserved }} bytes（不是 v2 未解决义务，不可释放）</dd>
          </template>
          <dt>观测 usage（fixture）</dt><dd>{{ observedUsage.input ?? '未知' }} input / {{ observedUsage.output ?? '未知' }} output（已知部分）；{{ observedUsage.unknown }} 个请求缺少完整观测</dd>
          <dt>未知请求 / 成本</dt><dd>{{ unknownRequests }} / 未估价；不是已观测真实模型费用</dd>
        </dl>
      </section>
      <section data-testid="campaign-artifacts" aria-label="不可变 artifact 只读检查">
        <h3>不可变 artifact（只读）</h3>
        <p v-if="!artifactRows.length">尚无已接纳 artifact。</p>
        <details v-for="artifact in artifactRows" :key="artifact.hash" :data-testid="`campaign-artifact-${artifact.taskId}`">
          <summary>{{ artifact.kind }} · r{{ artifact.revision }} · {{ artifact.canonical.scalars }} characters · not_reviewed</summary>
          <p class="hash">{{ artifact.hash }}</p>
          <pre>{{ artifact.text }}</pre>
        </details>
      </section>
      <section data-testid="campaign-receipts" aria-label="最新持久 receipt">
        <h3>最新持久 receipt</h3>
        <dl class="metadata"><dt>操作</dt><dd>{{ snapshot.receipt.kind }}</dd><dt>Operation ID</dt><dd>{{ snapshot.receipt.operationId }}</dd><dt>Sequence / epoch</dt><dd>{{ snapshot.receipt.sequence }} / {{ snapshot.receipt.executionEpoch }}</dd><dt>Receipt hash</dt><dd>{{ snapshot.receipt.hash }}</dd><dt>本次 artifact 数</dt><dd>{{ snapshot.receipt.artifactHashes.length }}</dd></dl>
      </section>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useWriterCampaign } from '@/composables/useWriterCampaign'
const { ids, selectedId, snapshot, busy, loading, error, status, locallyStopped, persistentOutcome,
  canStep, canResume, canStop, canSaveOnly, unresolved, taskRows, artifactRows, completedTasks, unknownRequests, inactiveUnknownRequests, readOnly, storageSummary, legacyStorageSummary,
  planningAvailable, planningProfile, chapterRows, selectedChapter, planningPreview, previewLoading, canPreview, previewChapter,
  bodyEvidenceAvailable, bodyPrefixRows, bodyPrefix, bodyDraft, bodyPreview, bodyPacket, bodyClaimCounts, bodyPreviewLoading, bodyDraftLoading, bodyDraftRefusal,
  canLoadBodyDraft, canPreviewBody, setBodyDraft, selectBodyPrefix, loadBodyEvidenceExample, previewBody, createBodyEvidence,
  observedUsage, refresh, select, create, createPlanning, step, saveOnly, pause, resume, cancel, dispose } = useWriterCampaign()
function editBodyProposal(event: Event) {
  const field = event.target as HTMLTextAreaElement
  if (!setBodyDraft(field.value)) field.value = bodyDraft.value
}
onMounted(() => { void refresh() })
onUnmounted(dispose)
</script>

<style scoped>
.campaign-lab { max-width: 1080px; margin: 0 auto; padding: 28px 20px 64px; color: var(--el-text-color-primary, #202732); line-height: 1.6; }
.back-link { color: var(--el-color-primary, #2160aa); }
h1 { margin-bottom: 12px; } h2 { margin-top: 30px; } h3 { margin-top: 24px; }
.notice { border-left: 4px solid #bd8122; background: var(--el-color-warning-light-9, #fff7e8); padding: 12px 16px; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0; }
button { border: 1px solid var(--el-border-color, #bdc4ce); border-radius: 6px; padding: 9px 13px; background: var(--el-bg-color, white); color: inherit; font: inherit; cursor: pointer; }
.body-proposal-label { display: block; font-weight: 600; margin: 12px 0 6px; }
textarea { box-sizing: border-box; width: 100%; resize: vertical; padding: 10px; color: inherit; background: var(--el-bg-color, white); border: 1px solid var(--el-border-color, #bdc4ce); border-radius: 6px; font-family: monospace; }
textarea:focus-visible { outline: 3px solid #2876c9; outline-offset: 3px; }
button:disabled { opacity: .5; cursor: not-allowed; } button:focus-visible, a:focus-visible, summary:focus-visible { outline: 3px solid #2876c9; outline-offset: 3px; }
button[aria-pressed="true"] { border-color: #2876c9; background: var(--el-color-primary-light-9, #ecf5ff); }
.campaign-list { padding-left: 20px; } .campaign-list li { margin: 8px 0; } .campaign-list button { word-break: break-all; text-align: left; }
.metadata { display: grid; grid-template-columns: minmax(130px, 190px) minmax(0, 1fr); gap: 8px 18px; }
dt { font-weight: 600; } dd { margin: 0; overflow-wrap: anywhere; }
details { padding: 12px; margin: 10px 0; border: 1px solid var(--el-border-color, #d4d9df); border-radius: 6px; }
summary { cursor: pointer; } pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; } .hash { overflow-wrap: anywhere; }
[role="alert"] { color: var(--el-color-danger, #9b2323); }
@media (max-width: 600px) { .campaign-lab { padding: 20px 14px 48px; } .metadata { grid-template-columns: 1fr; gap: 2px; } dd { margin-bottom: 10px; } .actions button { width: 100%; } }
</style>
