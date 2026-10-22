<template>
  <section class="novel-scan" data-testid="novel-scan-panel" aria-labelledby="novel-scan-title" :data-state="state.page?.state ?? (state.preparing ? 'preparing' : 'idle')" :data-phase="state.page?.phase ?? 'none'">
    <h2 id="novel-scan-title">全披露正文候选扫描</h2>
    <label class="toggle"><input type="checkbox" data-testid="novel-scan-enabled" :checked="state.enabled" @change="state.setEnabled(($event.target as HTMLInputElement).checked)" />按需启用（默认关闭）</label>
    <p class="muted">A 逐窗处理截止章内全部已保存原文；B 单独启动，核对有限的相邻、共享原文词与别名桥连接。没有共同线索的远距语义、未提取线索及超过三个线索的组合可能遗漏。不保证发现所有关系、伏笔或回收。</p>
    <section v-if="state.history.length" data-testid="novel-scan-history" class="summary">
      <h3>本路由会话的已结束 campaign 成本</h3>
      <p>已结束 {{ state.historyCount }} 次，累计 {{ state.historyUsed.attempts }} 次请求尝试、{{ Math.ceil(state.historyUsed.activeMs).toLocaleString() }} 毫秒处理时间、{{ state.historySourceChars.toLocaleString() }} 原文发送字符。仅保留最近 8 次明细，不保存原文、模型内容或凭据，离开路由即清除。</p>
      <p class="warning">重新预览是新 campaign 的新授权，不是续批，不会撤销此前成本。原 campaign 未结束时请用“新批继续”保留累计预算。下列为停止时已计入的成本，不是服务商账单。</p>
      <article v-for="entry in state.history" :key="entry.campaignId" data-testid="novel-scan-history-entry" :data-campaign-id="entry.campaignId" :data-stop-reason="entry.reason" class="chapter">
        <p>campaign {{ entry.campaignId }} · 停止原因 {{ historyReason[entry.reason] ?? entry.reason }}</p>
        <p v-for="field in allocationFields" :key="field.key">{{ field.label }}：{{ Math.ceil(entry.ledger.used[field.key]).toLocaleString() }} / 累计授权 {{ entry.ledger.authorized[field.key].toLocaleString() }}</p>
        <p>引擎准备 {{ Math.ceil(entry.ledger.preparationMs).toLocaleString() }} 毫秒；本地审阅核验 {{ Math.ceil(entry.ledger.reviewMs).toLocaleString() }} 毫秒（不占扫描额度）。</p>
        <p>尝试发送原文 {{ entry.ledger.attemptedSourceChars.toLocaleString() }} 字符，观察到响应 {{ entry.ledger.observedResponseBytes.toLocaleString() }} bytes。{{ entry.inFlightAtStop ? '停止时正在处理任务；取消不能撤回已派发请求。' : '' }}</p>
      </article>
    </section>
    <template v-if="state.enabled">
      <p class="warning">只发送已披露原文，不发送已有图谱、人物档案或后续章。扫描不改正文、不自动确认，不自动选择或批准 Writer 依据。暂停和失败重试仍使用同一 campaign 累计预算。静置时不后台扫描全书；预览与候选是上次核验快照，未捕获的外部变化会在下一次操作前重新核验。</p>
      <fieldset v-if="!state.preview" :disabled="state.busy">
        <legend>初始累计授权（先预览，不发请求）</legend>
        <div class="fields"><label v-for="field in allocationFields" :key="field.key" class="field"><span>{{ field.label }}</span><input :data-testid="`novel-scan-max-${field.id}`" type="number" min="1" :max="hard[field.key]" step="1" :value="state.allocation[field.key]" @input="state.changeAllocation(field.key, Number(($event.target as HTMLInputElement).value))" /></label><label class="field"><span>本批线索池容量</span><input :value="state.cueCapacity" @input="state.setCueCapacity(Number(($event.target as HTMLInputElement).value))" data-testid="novel-scan-cue-capacity" type="number" min="4" :max="limits.maxCues" step="1" /></label></div>
        <button data-testid="novel-scan-prepare" :disabled="!available || state.busy" @click="state.prepare()">预览全披露扫描计划（零请求）</button>
      </fieldset>
      <p v-if="!available" class="warning" data-testid="novel-scan-unavailable">请先保存并同步正文，选择有效的披露截止章。读取失败或未保存修改时不能准备扫描。</p>
      <section v-if="state.preview" data-testid="novel-scan-preview" class="summary">
        <h3>请求前预览</h3>
        <p>作品 {{ state.preview.projectId }} · 截止章 {{ state.preview.throughChapterId }}（包含该章）· {{ state.preview.chapterCount }} 章 · {{ state.preview.eligibleChars.toLocaleString() }} UTF-16 字符 · {{ state.preview.windows }} 个正文主窗口。</p>
        <p>按实际 JSON 输入预算分窗；每个主窗口覆盖精确原文区间，最多 {{ limits.primaryAtoms }} 个主原子及邻接上下文。UI 不截取或改写原文，空章保留为单独记录。</p>
        <p data-testid="novel-scan-destination">目的地：{{ state.preview.providerLabel }} · {{ state.preview.modelId }} · {{ state.preview.endpointLabel }}</p>
        <p>每次只尝试一次，最多 {{ limits.providerMs / 1000 }} 秒、{{ limits.outputTokens }} 输出 tokens、{{ limits.responseBytes.toLocaleString() }} decoded bytes。输入含固定指令及 JSON，最多 {{ limits.inputChars.toLocaleString() }} 字符 / {{ limits.inputBytes.toLocaleString() }} UTF-8 bytes。</p>
        <p>campaign {{ state.preview.campaignId }} · segment {{ state.preview.segmentId }}。预览最长 5 分钟；整个 campaign 最长 1 小时。切换来源、披露、模型配置或外部图谱修订会清除未保存候选。</p>
      </section>
      <section v-if="state.page" class="summary" aria-live="polite">
        <h3>{{ statusLabel }}</h3>
        <p v-if="state.page.reason" data-testid="novel-scan-reason">{{ reasonText[state.page.reason] ?? state.page.reason }}</p>
        <p data-testid="novel-scan-source-coverage" :data-eligible-chars="progress!.eligibleChars" :data-processed-chars="progress!.processedChars" :data-coverage="progress!.sourceCoverage">正文覆盖：{{ progress!.processedChars.toLocaleString() }} / {{ progress!.eligibleChars.toLocaleString() }} 字符；待处理 {{ progress!.remainingChars.toLocaleString() }}、跳过 {{ progress!.skippedChars.toLocaleString() }}、失败 {{ progress!.failedChars.toLocaleString() }}。{{ progress!.sourceCoverage === 'complete' ? '全部主原文窗口已处理；不等于所有语义已提取。' : '正文范围尚未全部处理。' }}</p>
        <progress :value="progress!.processedChars" :max="progress!.eligibleChars || 1" aria-label="正文主窗口覆盖进度" />
        <p data-testid="novel-scan-connection-coverage" :data-coverage="progress!.connectionCoverage">连接覆盖：已处理 {{ progress!.jobsProcessed }} / {{ progress!.planningComplete ? '' : '已知下界 ' }}{{ progress!.jobsPlanned }} 个任务；跳过 {{ progress!.jobsSkipped }}、失败 {{ progress!.jobsFailed }}。{{ progress!.connectionCoverage === 'complete_for_contract' ? '按本次连接规则完成，不代表发现全书所有语义关系。' : '连接范围尚未完成。' }}</p>
        <p>单点 {{ progress!.routeCounts.singleton }} · 相邻 {{ progress!.routeCounts.adjacent }} · 远距共享词 {{ progress!.routeCounts.shared_key }} · 三点桥接 {{ progress!.routeCounts.bridge }}。保留跨批有界出处 {{ progress!.indexCueCount }} 条，本批线索 {{ progress!.segmentCueCount }} 条。</p>
        <p v-if="progress!.representationLimited || progress!.crossSegmentGap" class="warning" data-testid="novel-scan-limited">{{ progress!.representationLimited ? '模型表示受限，未提取的线索不会自动补问。' : '' }}{{ progress!.crossSegmentGap ? '存在跨批连接缺口。' : '' }}</p>
        <div data-testid="novel-scan-miss-ledger"><p v-for="(miss, index) in progress!.misses" :key="index" class="warning">遗漏账本：范围 {{ miss.scope }} · 原因 {{ miss.reason }} · {{ miss.lowerBound ? '已知下界' : '已知数量' }} {{ miss.knownCount }}<span v-if="miss.source"> · 章 {{ miss.source.chapterId }} · {{ miss.source.start }}–{{ miss.source.end }}（UTF-16）· 窗口 {{ miss.source.firstWindow }}–{{ miss.source.lastWindow }} · 修订 {{ miss.source.revision }}</span><span v-if="miss.job"> · 路由 {{ miss.job.route }} · 任务 {{ miss.job.id }} · 原子 {{ miss.job.atomIds.join('、') }}</span><span v-if="miss.segmentId"> · segment {{ miss.segmentId }}</span></p></div>
        <div data-testid="novel-scan-ledger" :data-attempts="progress!.ledger.used.attempts" :data-authorized-attempts="progress!.ledger.authorized.attempts"><p v-for="field in allocationFields" :key="field.key">{{ field.label }}：已用 {{ Math.ceil(progress!.ledger.used[field.key]).toLocaleString() }} / 累计授权 {{ progress!.ledger.authorized[field.key].toLocaleString() }}</p><p class="muted">原文累计发送尝试 {{ progress!.ledger.attemptedSourceChars.toLocaleString() }} 字符（含上下文、重试及 B 重读）；实际收到 {{ progress!.ledger.observedResponseBytes.toLocaleString() }} bytes。扫描处理时间包含引擎内规划、校验、请求与解析，不含作者暂停决策。引擎准备 {{ Math.ceil(progress!.ledger.preparationMs).toLocaleString() }} 毫秒、本地审阅核验 {{ Math.ceil(progress!.ledger.reviewMs).toLocaleString() }} 毫秒另列，不占扫描额度。UI 展示与图谱读写另计，不含在引擎计时内。这不是金额上限。</p></div>
        <details><summary>逐章覆盖与修订（每页 50 章）</summary><article v-for="chapter in state.coverage" :key="chapter.chapterId" class="chapter" data-testid="novel-scan-chapter-coverage"><p>{{ chapter.title }} · {{ chapter.chapterId }} · {{ chapter.empty ? '空章' : `${chapter.processedChars}/${chapter.eligibleChars} 字符已处理` }} · 剩余 {{ chapter.remainingChars }} · 跳过 {{ chapter.skippedChars }} · 失败 {{ chapter.failedChars }}</p><p class="revision">{{ chapter.revision }}</p></article><div class="actions"><button :disabled="state.coverageOffset === 0" @click="state.showCoverage(state.coverageOffset - 50)">上一页章节</button><button :disabled="state.coverage.length < 50" @click="state.showCoverage(state.coverageOffset + 50)">下一页章节</button></div></details>
        <fieldset v-if="state.page.state === 'paused'" :disabled="state.busy">
          <legend>明确追加授权（不会重置已用额度）</legend>
          <div class="fields"><label v-for="field in allocationFields" :key="field.key" class="field"><span>追加{{ field.label }}</span><input :value="state.add[field.key]" @input="state.setAdd(field.key, Number(($event.target as HTMLInputElement).value))" :data-testid="`novel-scan-add-${field.id}`" type="number" min="0" :max="hard[field.key] - progress!.ledger.authorized[field.key]" step="1" /></label></div>
          <button data-testid="novel-scan-grant" @click="state.grant()">明确追加累计预算</button>
          <template v-if="state.page.reason === 'cue_capacity'"><label class="field"><span>增加本批线索池至（最多 {{ limits.maxCues }}）</span><input :value="state.newCueCapacity" @input="state.setNewCueCapacity(Number(($event.target as HTMLInputElement).value))" data-testid="novel-scan-new-cue-capacity" type="number" min="4" :max="limits.maxCues" /></label><button data-testid="novel-scan-extend-cues" @click="state.extendCues()">明确增加线索容量</button></template>
        </fieldset>
        <div class="actions">
          <button v-if="!running" data-testid="novel-scan-verify" :disabled="state.busy" @click="state.verify()">本地重新核验（零模型请求）</button>
          <button v-if="state.page.state === 'ready_a'" data-testid="novel-scan-start-a" :disabled="state.busy" @click="state.startA()">开始 A：扫描原文</button>
          <button v-if="state.page.state === 'ready_b'" data-testid="novel-scan-start-b" :disabled="state.busy" @click="state.startB()">开始 B：候选连接</button>
          <button v-if="running" data-testid="novel-scan-pause" @click="state.pause()">完成当前请求后暂停</button>
          <template v-if="state.page.state === 'paused'">
            <button v-if="!state.page.failedJobId && !['index_capacity', 'planning_capacity', 'review_capacity'].includes(state.page.reason ?? '')" data-testid="novel-scan-resume" :disabled="state.busy" @click="state.resume()">在剩余预算内继续</button>
            <button v-if="state.page.failedJobId" data-testid="novel-scan-retry" :disabled="state.busy" @click="state.retry()">明确重试失败任务</button>
            <button v-if="state.page.failedJobId" data-testid="novel-scan-skip" :disabled="state.busy" @click="state.skip()">跳过失败任务并记入遗漏</button>
            <button v-if="state.page.reason === 'index_capacity'" data-testid="novel-scan-skip-index" :disabled="state.busy" @click="state.skipIndexRemainder()">明确跳过剩余出处并记入遗漏</button>
          </template>
          <button v-if="!reviewing && !running && state.page.state !== 'ready_a'" data-testid="novel-scan-finish-partial" :disabled="state.busy" @click="state.finishPartial()">{{ state.page.phase === 'collect' ? '结束本批 A 并预览 B 连接' : '停止本批并审阅已完成候选' }}</button>
          <button v-if="reviewing && !state.page.candidates?.length && canContinueSegment" data-testid="novel-scan-next-segment" :disabled="state.busy" @click="state.nextSegment()">新批继续未处理 A / B（沿用累计预算）</button>
        </div>
        <p v-if="reviewing && progress!.misses.some(miss => miss.reason === 'planning_capacity')" class="warning">连接规划已达到本 campaign 的硬上限，不能通过新批或追加预算绕过；未枚举任务保留在遗漏账本。</p>
        <p v-if="state.page.state === 'ready_b'" class="warning" data-testid="novel-scan-b-plan">A 不会自动启动 B。跨批累计至少 {{ progress!.minimumConnectionCalls }} 个连接请求，已处理 {{ progress!.jobsProcessed }} 个；其他路由惰性枚举，这不是剩余或总任务数。当前可连接线索 {{ progress!.indexCueCount }} 条，已知连接任务{{ progress!.planningComplete ? '' : '下界' }} {{ progress!.jobsPlanned }}；路由未全部枚举时，不将下界冒充精确总数。</p>
      </section>
      <button v-if="state.busy || state.preview || state.page" data-testid="novel-scan-cancel" @click="state.cancel()">取消并清除未保存候选</button>
      <p v-if="state.error" role="alert" class="error" data-testid="novel-scan-error">{{ state.error }}</p>
      <p v-if="state.notice" role="status" class="muted" data-testid="novel-scan-notice">{{ state.notice }}</p>
      <p v-if="state.savedCount" role="status" data-testid="novel-scan-saved-status" :data-invalid="String(state.savedInvalid)">已保存 {{ state.savedCount }} 条，默认尚未经作者确认。{{ state.savedInvalid ? '保存后的来源或会话已失效，旧引用已隐藏；作者数据仍保留，不会自动删除。' : '确认是独立动作，请在关系或伏笔列表中核对后操作。' }}</p>
      <section v-if="reviewing" data-testid="novel-scan-review">
        <h3>逐条审阅（远程扫描已停止）</h3><p class="warning">{{ state.page!.state === 'reviewing_partial' ? '这是部分扫描结果。' : '按本次连接规则结束。' }}协议与引用位置通过校验，不代表语义判断正确。每条须独立保存或忽略，保存默认未确认。</p>
        <p v-if="!state.page!.candidates?.length" class="muted">本批没有待审阅候选。空结果不证明原文没有关系或伏笔。</p>
        <template v-for="kind in (['relationship', 'foreshadowing'] as const)" :key="kind"><h4 v-if="cards.some(item => item.candidate.kind === kind)">{{ kind === 'relationship' ? '关系候选' : '伏笔 / 可能回收候选' }}</h4>
          <article v-for="({ candidate, index }) in cards.filter(item => item.candidate.kind === kind)" :key="candidate.id" class="candidate" :data-testid="`novel-scan-candidate-${index}`" :data-kind="candidate.kind">
            <template v-if="candidate.kind === 'relationship'"><h4>{{ candidate.source.label }} → {{ candidate.target.label }}</h4><p>{{ candidate.predicate }}</p><p>{{ candidate.origin === 'explicit' ? '原文明示（模型标注，待核对）' : '模型推断' }}</p></template>
            <template v-else><h4>{{ candidate.title }}</h4><p>{{ candidate.mode === 'possible_recovery' ? '可能回收' : '伏笔候选，不代表尚未回收' }} · 模型推断</p><p data-testid="novel-scan-explanation">{{ candidate.explanation }}</p></template>
            <p class="muted">模型提议 · 尚未经作者确认 · 全部前提的上次核验快照如下，保存前将重新核验</p>
            <section v-for="(premise, group) in premises(candidate)" :key="group" class="premise" data-testid="novel-scan-premise" :data-role="premise.role"><h5>{{ roleLabels[premise.role] }}</h5><article v-for="(anchor, anchorIndex) in premise.evidence" :key="anchorIndex"><p>章节 {{ anchor.chapterId }} · {{ anchor.start }}–{{ anchor.end }}（UTF-16）</p><p class="revision" data-testid="novel-scan-revision">{{ anchor.sourceRevision }}</p><blockquote data-testid="novel-scan-quote">{{ anchor.quote }}</blockquote><button data-testid="novel-scan-view-source" :disabled="state.busy" @click="state.viewSource(candidate.id, anchor)">查看当前原文</button></article></section>
            <div class="actions"><button :data-testid="`novel-scan-save-${index}`" :disabled="state.busy" @click="state.save(candidate.id)">保存此提议（未确认）</button><button :data-testid="`novel-scan-ignore-${index}`" :disabled="state.busy" @click="state.ignore(candidate.id)">忽略此提议</button></div>
          </article>
        </template>
        <div v-if="(state.page!.candidates?.length ?? 0) > 20" class="actions"><button :disabled="state.candidatePage === 0" @click="state.setCandidatePage(state.candidatePage - 1)">上一页候选</button><span>第 {{ state.candidatePage + 1 }} 页</span><button :disabled="(state.candidatePage + 1) * 20 >= (state.page!.candidates?.length ?? 0)" @click="state.setCandidatePage(state.candidatePage + 1)">下一页候选</button></div>
      </section>
      <aside v-if="state.sourceView" data-testid="novel-scan-source" class="summary"><div class="actions"><h3>最近核验的原文快照</h3><button @click="state.closeSource()">关闭原文</button></div><p class="revision">{{ state.sourceView.revision }}</p><pre>{{ state.sourceView.before }}<mark>{{ state.sourceView.quote }}</mark>{{ state.sourceView.after }}</pre></aside>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { NOVEL_SCAN_HARD_ALLOCATION as hard, NOVEL_SCAN_LIMITS as limits } from '@/types/memoryNovelScan'
import type { NovelScanAllocation, NovelScanCandidate } from '@/types/memoryNovelScan'
import type { NovelScanUiState } from '@/composables/useNovelCandidateScan'
const props = defineProps<{ state: NovelScanUiState; available: boolean }>()
const progress = computed(() => props.state.page?.progress)
const running = computed(() => ['running_a', 'running_b'].includes(props.state.page?.state ?? ''))
const reviewing = computed(() => ['reviewing_partial', 'reviewing_complete_for_contract'].includes(props.state.page?.state ?? ''))
const canContinueSegment = computed(() => !!progress.value && (progress.value.remainingChars > 0 || !progress.value.planningComplete) && !progress.value.misses.some(miss => miss.reason === 'planning_capacity'))
const statusLabel = computed(() => ({ ready_a: 'A 阶段待作者开始', running_a: 'A：正文窗口扫描中', ready_b: 'B 阶段待作者单独开始', running_b: 'B：有限候选连接中', paused: '扫描已暂停', reviewing_partial: '本批已停止，部分结果待审阅', reviewing_complete_for_contract: '本批按连接规则结束，候选待审阅', cancelled: '已取消', invalidated: '已失效', expired: '已过期', closed: '已关闭' })[props.state.page?.state ?? 'ready_a'])
const allocationFields: { key: keyof NovelScanAllocation; label: string; id: string }[] = [
  { key: 'attempts', label: '请求尝试次数', id: 'attempts' }, { key: 'activeMs', label: '处理时间（毫秒）', id: 'active-ms' },
  { key: 'inputChars', label: '累计输入 UTF-16 字符', id: 'input-chars' }, { key: 'inputBytes', label: '累计输入 UTF-8 bytes', id: 'input-bytes' },
  { key: 'outputTokens', label: '累计输出 token 额度', id: 'output-tokens' }, { key: 'responseBytes', label: '累计响应 byte 额度', id: 'response-bytes' },
]
const historyReason: Record<string, string> = { cancelled: '作者取消', disabled: '关闭扫描', expired: '会话或预览过期', closed: '正常结束', new_campaign: '开始新的授权', source_or_disclosure_changed: '来源或披露变化', source_changed: '来源变化', configuration_changed: '模型配置变化', graph_changed: '外部图谱变化', guard_timeout: '核验超时', invalidated: '校验失效', external_change: '外部变化或返回页面', allocation_changed: '更改初始预算', cue_capacity_changed: '更改初始容量', route_left: '离开路由' }
const roleLabels = { support: '关系支持前提', setup: '铺垫前提', recovery: '回收前提', context: '上下文前提' }
const reasonText: Record<string, string> = { user: '作者暂停，可继续、部分结束或取消。', budget: '累计预算不足，请明确追加，或停止本批审阅、取消。', provider: '服务请求失败，请明确重试、跳过或结束。', invalid_response: '响应未通过协议校验，不计为成功覆盖。', response_capacity: '响应容量达到限制。', cue_capacity: '本批线索池已满，可增加容量或转入有限连接。', index_capacity: '跨批出处索引达到硬上限，继续前须明确决定遗漏范围。', review_capacity: '审阅候选池已满，请停止本批、逐条审阅后以新批继续剩余连接。', planning_capacity: '连接规划达到硬上限，未枚举部分不能算已完成。', context_overflow: '任务全部前提无法装入请求，未裁掉前提。', output_incomplete: '输出不完整，本任务不计为成功。' }
const cards = computed(() => (props.state.page?.candidates ?? []).map((candidate, index) => ({ candidate, index })).slice(props.state.candidatePage * 20, (props.state.candidatePage + 1) * 20))
function premises(candidate: NovelScanCandidate) { return candidate.kind === 'relationship' ? [{ role: 'support' as const, evidence: candidate.evidence }] : candidate.premises }
</script>
<style scoped>
.novel-scan { padding: 20px; border: 1px solid var(--el-border-color-light); border-radius: 12px; margin-bottom: 18px; background: var(--el-bg-color); min-width: 0; } h2 { font-size: 18px; margin: 0 0 16px; } h3 { font-size: 16px; } h4 { font-size: 14px; } h5 { font-size: 13px; } p { line-height: 1.8; overflow-wrap: anywhere; font-size: 13px; } .muted { color: var(--el-text-color-secondary); } .warning { color: var(--el-color-warning-dark-2); } .error { color: var(--el-color-danger); } .toggle { display: flex; gap: 8px; align-items: center; } fieldset, .summary, .candidate { border: 1px solid var(--el-border-color); border-radius: 8px; padding: 16px; margin: 16px 0; min-width: 0; } legend { font-size: 13px; } .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 14px; } .field { display: flex; flex-direction: column; gap: 8px; font-size: 13px; min-width: 0; } input[type=number] { width: 100%; box-sizing: border-box; } button, input[type=number] { border: 1px solid var(--el-border-color); border-radius: 6px; padding: 9px 12px; background: var(--el-fill-color-blank); color: inherit; font: inherit; font-size: 13px; } button { cursor: pointer; } button:disabled { opacity: .55; cursor: not-allowed; } .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; align-items: center; } .revision { overflow-wrap: anywhere; font-size: 12px; } .premise, .chapter { border-top: 1px solid var(--el-border-color-light); padding-top: 10px; margin-top: 12px; } blockquote { margin: 8px 0; padding: 12px; border-left: 3px solid var(--el-color-primary); background: var(--el-fill-color-light); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; } progress { width: 100%; } pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 480px; overflow-y: auto; font: inherit; line-height: 1.8; } mark { color: inherit; background: var(--el-color-warning-light-7); } @media(max-width:480px) { .novel-scan, fieldset, .summary, .candidate { padding: 12px; } .fields { grid-template-columns: minmax(0, 1fr); } button, input[type=number] { min-height: 44px; } }
</style>
