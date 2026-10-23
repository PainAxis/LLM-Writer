import { reactive, watch, type WatchSource } from 'vue'
import { useApiConfig } from '@/services/apiConfig'
import { NovelScanError, prepareNovelCandidateScan } from '@/services/memory/novelScan'
import { createCommittedMemorySourceGuard, withMemoryAbort } from '@/services/memory/semanticScanUi'
import { readFactGraph, saveFactGraph } from '@/services/memory/factGraphStore'
import { createFactPlotLink, resolveFactAnchors, selectFactGraph, selectFactPlotLinks, validateFactGraphDocument } from '@/services/memory/factGraph'
import { NOVEL_SCAN_DEFAULT_ALLOCATION, NOVEL_SCAN_LIMITS } from '@/types/memoryNovelScan'
import type { FactAnchor, FactGraphDocument, FactPlotLink, FactRelation } from '@/types/factGraph'
import type { MemoryIndexStats, MemoryProjectInput } from '@/types/memory'
import type { NovelScanAllocation, NovelScanCandidate, NovelScanChapterCoverage, NovelScanDecision, NovelScanIdentity, NovelScanInput, NovelScanLedger, NovelScanPage, NovelScanPreview, PreparedNovelScan } from '@/types/memoryNovelScan'

export interface NovelScanSource { project: MemoryProjectInput; stats: MemoryIndexStats; throughChapterId: string }
export interface NovelScanHistory { campaignId: string; stoppedAt: number; reason: string; ledger: NovelScanLedger; inFlightAtStop: boolean }
export interface NovelScanUiState {
  enabled: boolean; busy: boolean; preparing: boolean; preview: NovelScanPreview | null; page: NovelScanPage | null
  allocation: NovelScanAllocation; add: NovelScanAllocation; cueCapacity: number; newCueCapacity: number
  coverage: NovelScanChapterCoverage[]; coverageOffset: number; error: string; notice: string
  savedCount: number; savedInvalid: boolean; candidatePage: number
  history: NovelScanHistory[]; historyCount: number; historyUsed: NovelScanAllocation; historySourceChars: number
  sourceView: { before: string; quote: string; after: string; revision: string } | null
  setEnabled(value: boolean): void; changeAllocation(key: keyof NovelScanAllocation, value: number): void
  setAdd(key: keyof NovelScanAllocation, value: number): void; setCueCapacity(value: number): void; setNewCueCapacity(value: number): void
  setCandidatePage(value: number): void; closeSource(): void
  verify(): Promise<void>; prepare(): Promise<boolean>; startA(): Promise<boolean>; startB(): Promise<boolean>; pause(): Promise<boolean>
  resume(): Promise<boolean>; retry(): Promise<boolean>; skip(): Promise<boolean>; finishPartial(): Promise<boolean>
  grant(): Promise<boolean>; extendCues(): Promise<boolean>; skipIndexRemainder(): Promise<boolean>
  nextSegment(): Promise<boolean>; save(candidateId: string): Promise<boolean>; ignore(candidateId: string): Promise<boolean>
  viewSource(candidateId: string, anchor: FactAnchor): Promise<boolean>; showCoverage(offset: number): void; cancel(): void
}
export interface NovelScanUiOptions {
  current(): NovelScanSource | null
  canPrepare(): boolean
  readProject(id: string): Promise<MemoryProjectInput>
  onInvalidSource?(): void
  configuration?: WatchSource<unknown>
  preparePlan?(input: NovelScanInput): Promise<PreparedNovelScan>
  readGraph?(id: string): Promise<FactGraphDocument>
  saveGraph?(document: FactGraphDocument, expectedRevision: string | null): Promise<FactGraphDocument>
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const isReview = (page: NovelScanPage | null) => page?.state === 'reviewing_partial' || page?.state === 'reviewing_complete_for_contract'
const isRunning = (page: NovelScanPage | null) => page?.state === 'running_a' || page?.state === 'running_b'
const zeroAllocation = (): NovelScanAllocation => ({ attempts: 0, activeMs: 0, inputChars: 0, inputBytes: 0, outputTokens: 0, responseBytes: 0 })

/** Private route lease: explicit starts, bounded engine advances, fresh CAS review, no persistence. */
export function useNovelCandidateScan(options: NovelScanUiOptions) {
  let epoch = 0
  let campaignVersion = 0
  let disposed = false
  let abort: AbortController | null = null
  let plan: PreparedNovelScan | null = null
  let captured: NovelScanSource | null = null
  let sourceOwner: NovelScanSource | null = null
  let expectedGraphRevision: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let readyTimer: ReturnType<typeof setTimeout> | undefined
  let auditing = false
  const eventOwner = crypto.randomUUID()
  const readGraph = options.readGraph ?? readFactGraph
  const saveGraph = options.saveGraph ?? saveFactGraph
  const state: NovelScanUiState = reactive<NovelScanUiState>({
    enabled: false, busy: false, preparing: false, preview: null, page: null,
    allocation: { ...NOVEL_SCAN_DEFAULT_ALLOCATION }, add: zeroAllocation(), cueCapacity: NOVEL_SCAN_LIMITS.cues, newCueCapacity: NOVEL_SCAN_LIMITS.maxCues,
    coverage: [], coverageOffset: 0, error: '', notice: '', savedCount: 0, savedInvalid: false, candidatePage: 0, sourceView: null,
    history: [], historyCount: 0, historyUsed: zeroAllocation(), historySourceChars: 0,
    setEnabled(value) { if (disposed || state.enabled === value) return; state.enabled = value; invalidate(value ? '' : '已关闭扫描，未保存候选已清除。', true, 'disabled') },
    changeAllocation(key, value) { if (!state.busy) { state.allocation[key] = value; invalidate('预算已更改，请重新预览。', true, 'allocation_changed') } },
    setAdd(key, value) { state.add[key] = value }, setCueCapacity(value) { if (!state.busy) { state.cueCapacity = value; invalidate('线索容量已更改，请重新预览。', true, 'cue_capacity_changed') } },
    setNewCueCapacity(value) { state.newCueCapacity = value }, setCandidatePage(value) { state.candidatePage = value }, closeSource() { state.sourceView = null },
    verify: auditCurrent, prepare, startA: () => execute(current => current.startA(handle())), startB: () => execute(current => current.startB(handle())),
    pause, resume: () => decision({ type: 'continue' }), retry: () => failedDecision('retry'), skip: () => failedDecision('skip'),
    finishPartial: () => decision({ type: 'finish-partial' }), grant, extendCues: () => decision({ type: 'extend-cue-capacity', newCapacity: state.newCueCapacity }),
    skipIndexRemainder: () => decision({ type: 'skip-index-remainder' }), nextSegment, save, ignore: id => decision({ type: 'ignore', candidateId: id }),
    viewSource, showCoverage, cancel: () => invalidate('扫描已取消，未保存候选已清除。已保存的作者标注仍保留。', false, 'cancelled'),
  })
  function invalidate(message = '来源、披露、配置或图谱已变化，请重新预览。', savedInvalid = true, reason = 'invalidated') {
    epoch++; clearTimeout(timer); timer = undefined; clearTimeout(readyTimer); readyTimer = undefined
    const stopped = plan; const inFlightAtStop = isRunning(state.page); const previous = stopped?.snapshot()
    if (reason === 'invalidated' && previous?.reason && ['expired', 'invalidated'].includes(previous.state)) reason = previous.reason
    abort?.abort(); abort = null; stopped?.cancel()
    if (stopped) {
      // Freeze numbers only at the stop boundary. Late provider/CAS results never mutate history.
      const page = stopped.snapshot(); const ledger = clone(page.progress.ledger)
      if (!state.history.some(item => item.campaignId === page.campaignId)) {
        state.history.unshift({ campaignId: page.campaignId, stoppedAt: Date.now(), reason, ledger, inFlightAtStop })
        state.history = state.history.slice(0, 8); state.historyCount++
        for (const key of Object.keys(state.historyUsed) as Array<keyof NovelScanAllocation>) state.historyUsed[key] += ledger.used[key]
        state.historySourceChars += ledger.attemptedSourceChars
      }
    }
    plan = null
    captured = null; sourceOwner = null; expectedGraphRevision = null
    state.busy = false; state.preparing = false; state.preview = null; state.page = null; state.coverage = []; state.sourceView = null
    state.error = ''; state.notice = message; state.candidatePage = 0
    if (savedInvalid && state.savedCount) state.savedInvalid = true
  }
  function owner(token: number, signal: AbortSignal) {
    const current = options.current()
    if (disposed || token !== epoch || signal.aborted || !state.enabled || !options.canPrepare() || !sourceOwner
      || !current || current.project !== sourceOwner.project || current.stats !== sourceOwner.stats || current.throughChapterId !== sourceOwner.throughChapterId) throw new DOMException('扫描已取消或来源已变化', 'AbortError')
  }
  function handle(): NovelScanIdentity { if (!state.page) throw new Error('没有当前扫描'); return { campaignId: state.page.campaignId, segmentId: state.page.segmentId, generation: state.page.generation } }
  function publish(page: NovelScanPage) {
    state.page = clone(page)
    clearTimeout(readyTimer); readyTimer = undefined
    if ((page.state === 'ready_a' || page.state === 'ready_b') && plan) {
      const token = epoch
      readyTimer = setTimeout(() => { if (token === epoch) invalidate('预览已过期，请重新准备扫描计划。', true, 'expired') }, Math.max(0, plan.preview.readyExpiresAt - Date.now()))
    }
    if (['cancelled', 'expired', 'invalidated', 'closed'].includes(page.state)) {
      const reason = page.reason
      if (page.state === 'closed') invalidate('本次 campaign 已结束。已保存的作者标注仍保留。', false, 'closed')
      else if (page.state === 'cancelled') invalidate('扫描已取消，未保存候选已清除。已保存作者标注仍保留。', false, 'cancelled')
      else invalidate(reason === 'graph_changed' ? '图谱已在其他位置修改，未保存候选已清除。' : '扫描已失效，未保存候选和预览已清除。', true, reason ?? page.state)
      return
    }
    state.candidatePage = Math.min(state.candidatePage, Math.max(0, Math.ceil((page.candidates?.length ?? 0) / 20) - 1))
    showCoverage(state.coverageOffset)
  }
  function showCoverage(offset: number) {
    if (!plan) return
    state.coverageOffset = Math.max(0, offset)
    state.coverage = clone(plan.chapterCoverage(state.coverageOffset, 50))
  }
  async function buildInput(token: number, signal: AbortSignal, next = false): Promise<NovelScanInput> {
    const current = options.current()
    if (!current) throw new Error('source_changed')
    sourceOwner = current
    const snapshot = clone(current)
    captured = snapshot
    const assertOwner = () => owner(token, signal)
    const sourceGuard = createCommittedMemorySourceGuard(snapshot.project, () => options.readProject(snapshot.project.id), assertOwner, signal)
    await sourceGuard(); assertOwner()
    const graph = await withMemoryAbort(readGraph(snapshot.project.id), signal); assertOwner()
    await sourceGuard(); assertOwner()
    if (next && graph.revision !== (expectedGraphRevision ?? '')) throw new Error('graph_changed')
    expectedGraphRevision = graph.revision || null
    const fresh = async (expected: string | null, operationSignal: AbortSignal = signal) => {
      const assertOperation = () => { assertOwner(); if (operationSignal.aborted) throw new DOMException('本次核验已结束', 'AbortError') }
      const operationGuard = createCommittedMemorySourceGuard(snapshot.project, () => options.readProject(snapshot.project.id), assertOperation, operationSignal)
      assertOperation()
      await operationGuard(); assertOperation()
      const currentGraph = await withMemoryAbort(readGraph(snapshot.project.id), operationSignal); assertOperation()
      if ((currentGraph.revision || null) !== expected) throw new Error('graph_changed')
      await operationGuard(); assertOperation()
    }
    return { ...snapshot, graphRevision: expectedGraphRevision, allocation: clone(state.allocation), cueCapacity: state.cueCapacity, signal, assertOwner, assertFresh: fresh }
  }
  async function prepare() {
    if (disposed || !state.enabled || state.busy || !options.canPrepare()) return false
    invalidate('', false, 'new_campaign')
    campaignVersion++
    const token = epoch; const controller = new AbortController(); abort = controller
    state.preparing = true; state.busy = true; state.savedCount = 0; state.savedInvalid = false
    const deadline = setTimeout(() => controller.abort(), NOVEL_SCAN_LIMITS.prepareMs)
    try {
      const input = await withMemoryAbort(buildInput(token, controller.signal), controller.signal)
      const pending = (options.preparePlan ?? prepareNovelCandidateScan)(input)
      void pending.then(value => { if (disposed || token !== epoch || controller.signal.aborted) value.cancel() }, () => undefined)
      const value = await withMemoryAbort(pending, controller.signal); owner(token, controller.signal)
      plan = value; state.preview = clone(value.preview); publish(value.snapshot())
      timer = setTimeout(() => { if (token === epoch) invalidate('扫描会话已过期，请重新预览。', true, 'expired') }, Math.max(0, value.preview.expiresAt - Date.now()))
      return true
    } catch { if (!disposed && token === epoch) { invalidate(''); state.error = '无法准备扫描。请核对已保存正文、披露截止章、模型设置及图谱读取状态；已有数据不会被覆盖。' }; return false }
    finally { clearTimeout(deadline); if (token === epoch) { state.preparing = false; state.busy = false } }
  }
  async function execute(action: (current: PreparedNovelScan) => Promise<NovelScanPage>, drain = true) {
    const current = plan; const controller = abort
    if (disposed || state.busy || !current || !controller || !state.enabled || !options.canPrepare()) return false
    const token = epoch
    state.busy = true; state.error = ''; state.sourceView = null
    try {
      owner(token, controller.signal)
      const pending = action(current)
      owner(token, controller.signal); publish(current.snapshot())
      const firstPage = await withMemoryAbort(pending, controller.signal)
      owner(token, controller.signal); publish(firstPage); owner(token, controller.signal)
      while (drain && isRunning(state.page)) {
        // Yield to Cancel/navigation between bounded pages. No unattended restart after pause.
        await new Promise<void>(done => setTimeout(done, 0)); owner(token, controller.signal)
        const nextPage = await withMemoryAbort(current.advance(handle()), controller.signal)
        owner(token, controller.signal); publish(nextPage); owner(token, controller.signal)
      }
      return true
    } catch (cause) {
      if (!disposed && token === epoch) {
        if (cause instanceof NovelScanError && ['invalid_input', 'invalid_decision'].includes(cause.reason)) { publish(current.snapshot()); state.error = '所填追加额度或操作无效，原账本未重置。请核对全部六维上限后重试。' }
        else { invalidate(''); state.error = '本次操作未能通过来源或会话校验，未保存候选已清除。请重新预览。' }
      }
      return false
    }
    finally { if (token === epoch) state.busy = false }
  }
  function decision(value: NovelScanDecision) { return execute(current => current.decide(handle(), value)) }
  async function pause() {
    const current = plan; const controller = abort; const token = epoch
    if (!current || !controller || !isRunning(state.page)) return false
    try { const page = await withMemoryAbort(current.decide(handle(), { type: 'pause' }), controller.signal); owner(token, controller.signal); publish(page); return true }
    catch { return false }
  }
  function failedDecision(type: 'retry' | 'skip'): Promise<boolean> { const id: string | undefined = state.page?.failedJobId; return id ? decision({ type, failedJobId: id }) : Promise.resolve(false) }
  function grant() { if (!state.page) return Promise.resolve(false); return decision({ type: 'extend', grant: { ...handle(), grantId: crypto.randomUUID(), add: clone(state.add) } }) }
  function nextSegment() {
    return execute(async current => {
      const token = epoch; const signal = abort!.signal
      const deadline = setTimeout(() => { if (token === epoch) invalidate('新批次来源核验超时，旧会话已清除；请刷新后重新预览。', true, 'guard_timeout') }, NOVEL_SCAN_LIMITS.guardMs)
      try { const page = await withMemoryAbort(current.nextSegment(handle(), engineSignal => buildInput(token, engineSignal, true)), signal); owner(token, signal); state.preview = clone(current.preview); return page }
      finally { clearTimeout(deadline) }
    }, false)
  }
  function provenance(candidate: NovelScanCandidate) { return { campaignId: candidate.campaignId, segmentId: candidate.segmentId, jobId: candidate.jobId, candidateId: candidate.id } }
  function relationOf(candidate: Extract<NovelScanCandidate, { kind: 'relationship' }>): FactRelation {
    return { id: crypto.randomUUID(), projectId: candidate.projectId, source: clone(candidate.source), target: clone(candidate.target), predicate: candidate.predicate,
      origin: candidate.origin, createdBy: 'model', authorConfirmed: false, evidence: clone(candidate.evidence), provenance: provenance(candidate), semanticValidation: 'protocol-and-current-sources' }
  }
  function plotOf(candidate: Extract<NovelScanCandidate, { kind: 'foreshadowing' }>): FactPlotLink {
    return createFactPlotLink({ projectId: candidate.projectId, mode: candidate.mode, title: candidate.title, explanation: candidate.explanation, origin: candidate.origin,
      premises: clone(candidate.premises), provenance: provenance(candidate) })
  }
  function relationKey(value: FactRelation) { return JSON.stringify([value.source, value.target, value.predicate, value.origin, value.evidence]) }
  function plotKey(value: FactPlotLink) { return JSON.stringify([value.mode, value.title, value.explanation, value.origin, value.premises]) }
  async function save(candidateId: string) {
    const current = plan; const controller = abort
    if (!current || !controller || state.busy || !isReview(state.page) || !captured) return false
    const token = epoch; const snapshot = captured; const identity = handle(); const saveCampaignVersion = campaignVersion
    state.busy = true; state.error = ''; state.notice = ''; state.sourceView = null
    let committed: FactGraphDocument | null = null
    let saveStarted = false
    let commitReported = false
    const reportLateCommit = (value: FactGraphDocument) => {
      if (commitReported) return
      commitReported = true
      graphChanged(value, token)
      if (!disposed && options.current()?.project.id === value.projectId) {
        if (campaignVersion === saveCampaignVersion) { state.savedCount++; state.savedInvalid = true }
        state.notice = campaignVersion === saveCampaignVersion ? '标注已保存，但会话或来源随后失效；作者数据已保留，未自动删除。' : '先前批次的保存现已完成。图谱版本已变化，新扫描已失效；请刷新核对，未自动删除作者数据。'
      }
    }
    const deadline = setTimeout(() => controller.abort(), NOVEL_SCAN_LIMITS.guardMs)
    try {
      const candidate = await withMemoryAbort(current.reviewCandidate(identity, candidateId), controller.signal); owner(token, controller.signal)
      if (!candidate) { publish(current.snapshot()); return false }
      const before = await withMemoryAbort(readGraph(snapshot.project.id), controller.signal); owner(token, controller.signal)
      if ((before.revision || null) !== expectedGraphRevision) throw new Error('graph_changed')
      const checked = await withMemoryAbort(current.audit(identity), controller.signal)
      owner(token, controller.signal); publish(checked)
      if (!isReview(state.page)) return false
      let next: FactGraphDocument
      let duplicate = false
      if (candidate.kind === 'relationship') {
        const relation = relationOf(candidate)
        if (selectFactGraph(snapshot.project, snapshot.stats, { ...before, relations: [relation] }, snapshot.throughChapterId).relations.length !== 1) throw new Error('source_changed')
        duplicate = before.relations.some(item => relationKey(item) === relationKey(relation))
        next = { ...before, relations: [...before.relations, relation] }
      } else {
        const link = plotOf(candidate)
        if (selectFactPlotLinks(snapshot.project, snapshot.stats, { ...before, plotLinks: [link] }, snapshot.throughChapterId).plotLinks.length !== 1) throw new Error('source_changed')
        duplicate = before.plotLinks.some(item => plotKey(item) === plotKey(link))
        next = { ...before, plotLinks: [...before.plotLinks, link] }
      }
      if (duplicate) { const ignored = await withMemoryAbort(current.decide(identity, { type: 'ignore', candidateId }), controller.signal); owner(token, controller.signal); publish(ignored); state.notice = '图谱已有相同类型、内容与全部原文依据的条目，未重复写入。'; return true }
      saveStarted = true
      const saving = saveGraph(validateFactGraphDocument(next), before.revision || null)
      // A committed save is author data even if navigation/cancel wins the UI race.
      void saving.then(value => { if (disposed || token !== epoch || controller.signal.aborted) reportLateCommit(value) }, () => undefined)
      committed = await withMemoryAbort(saving, controller.signal)
      if (disposed || token !== epoch || controller.signal.aborted) { reportLateCommit(committed); return false }
      owner(token, controller.signal)
      state.savedCount++; commitReported = true
      expectedGraphRevision = committed.revision
      // Only the actual CAS return value advances this known own-save baseline.
      const accepted = await withMemoryAbort(current.notifyAccepted(identity, candidateId, before.revision || null, committed.revision), controller.signal)
      owner(token, controller.signal); publish(accepted)
      if (token !== epoch || controller.signal.aborted) {
        if (!disposed) { state.savedInvalid = true; state.notice = '标注已保存，但保存后的来源或会话已失效。已有作者数据仍保留，不会自动删除。' }
        graphChanged(committed, token)
        return false
      }
      owner(token, controller.signal)
      state.notice = '已保存，尚未经作者确认。请在对应标注列表中另行确认。'
      graphChanged(committed, token)
      return true
    } catch {
      if (!disposed && token === epoch) {
        invalidate('', !!committed)
        state.error = committed ? '标注已保存，但保存后的来源或会话已失效。作者数据已保留，未自动删除。' : saveStarted ? '保存结果尚未确认。请勿重复保存；刷新图谱核对结果。未保存候选已清除，已有作者数据不会自动删除。' : '保存前校验失败，未保存候选已清除。原有作者数据不会被覆盖。'
      }
      if (committed) { if (!commitReported) reportLateCommit(committed); else graphChanged(committed, token) }
      return false
    } finally { clearTimeout(deadline); if (token === epoch) state.busy = false }
  }
  function graphChanged(value: FactGraphDocument, ownershipEpoch: number) { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('memory-fact-graph-changed', { detail: { projectId: value.projectId, revision: value.revision, owner: `${eventOwner}:${ownershipEpoch}` } })) }
  async function viewSource(candidateId: string, anchor: FactAnchor) {
    const current = plan; const controller = abort
    if (!current || !controller || state.busy || !captured || !isReview(state.page)) return false
    const token = epoch; const snapshot = captured
    state.busy = true
    try {
      const candidate = await withMemoryAbort(current.reviewCandidate(handle(), candidateId), controller.signal); owner(token, controller.signal)
      if (!candidate) { publish(current.snapshot()); return false }
      const evidence = candidate.kind === 'relationship' ? candidate.evidence : candidate.premises.flatMap(item => item.evidence)
      if (!evidence.some(item => JSON.stringify(item) === JSON.stringify(anchor)) || !resolveFactAnchors(snapshot.project, snapshot.stats, snapshot.throughChapterId, [anchor])) throw new Error('source_changed')
      const chapter = snapshot.project.chapters.find(item => item.id === anchor.chapterId)!
      state.sourceView = { before: chapter.text.slice(0, anchor.start), quote: anchor.quote, after: chapter.text.slice(anchor.end), revision: anchor.sourceRevision }
      return true
    } catch { if (token === epoch) invalidate(); return false }
    finally { if (token === epoch) state.busy = false }
  }
  async function auditCurrent() {
    if (disposed || auditing || state.busy || !plan || !abort) return
    auditing = true; state.busy = true; state.sourceView = null
    const current = plan; const token = epoch; const signal = abort.signal; const baseline = expectedGraphRevision; const identity = handle()
    try {
      const page = await withMemoryAbort(current.audit(identity), signal)
      owner(token, signal)
      if (baseline !== expectedGraphRevision) return
      publish(page)
      if (token === epoch) state.notice = '本地重新核验已结束，没有发送模型请求。后续操作仍须再次核验。'
    } catch { if (token === epoch && !disposed) { invalidate(); options.onInvalidSource?.() } }
    finally { auditing = false; if (token === epoch) state.busy = false }
  }
  const stopConfiguration = watch(options.configuration ?? useApiConfig().activeConfig, () => invalidate(undefined, true, 'configuration_changed'), { deep: true, flush: 'sync' })
  const stopSource = watch(() => { const source = options.current(); return [source?.project, source?.stats, source?.throughChapterId, options.canPrepare()] }, () => invalidate(undefined, true, 'source_or_disclosure_changed'), { flush: 'sync' })
  function onExternal() { if (plan || state.preparing) invalidate(undefined, true, 'external_change') }
  function onVisibility() { if (document.visibilityState === 'visible') onExternal() }
  function onGraph(event: Event) { const detail = (event as CustomEvent<{ projectId?: string; owner?: string }>).detail; if (detail?.owner !== `${eventOwner}:${epoch}` && detail?.projectId === captured?.project.id) invalidate('图谱已在其他位置修改，未保存候选已清除。', true, 'graph_changed') }
  if (typeof window !== 'undefined') { window.addEventListener('storage', onExternal); window.addEventListener('focus', onExternal); window.addEventListener('memory-fact-graph-changed', onGraph); document.addEventListener('visibilitychange', onVisibility) }
  return { state, invalidate, auditCurrent, dispose() { disposed = true; invalidate('', true, 'route_left'); stopConfiguration(); stopSource(); if (typeof window !== 'undefined') { window.removeEventListener('storage', onExternal); window.removeEventListener('focus', onExternal); window.removeEventListener('memory-fact-graph-changed', onGraph); document.removeEventListener('visibilitychange', onVisibility) } } }
}
