import { watch } from 'vue'
import type { ApiConfig } from '../../types/api'
import type { FactAnchor } from '../../types/factGraph'
import type { MemoryIndexStats, MemoryProjectInput } from '../../types/memory'
import {
  NOVEL_SCAN_LIMITS as L, type NovelScanCandidate, type NovelScanChapterCoverage, type NovelScanDecision,
  type NovelScanGenerationRequest, type NovelScanGenerator, type NovelScanIdentity, type NovelScanInput,
  type NovelScanPage, type NovelScanPhase, type NovelScanPreview, type NovelScanProgress, type NovelScanReason,
  type NovelScanState, type PreparedNovelScan,
} from '../../types/memoryNovelScan'
import { useApiConfig } from '../apiConfig'
import { getPreset } from '../aiProviders'
import { chapterRevision } from './revision'
import { NovelScanBudget } from './novelScanBudget'
import {
  createNovelConnectionPlanner, novelAnchor, planNovelWindows, type NovelConnectionJob,
  type NovelIndexedCue, type NovelSourcePlan, type NovelSourceWindow,
} from './novelScanPlan'
import {
  buildNovelPrompt, NovelScanError, novelBytes, novelClone, novelFail,
  parseNovelCandidateResponse, parseNovelCueResponse,
} from './novelScanProtocol'
export { NOVEL_SCAN_LIMITS, NOVEL_SCAN_DEFAULT_ALLOCATION, NOVEL_SCAN_HARD_ALLOCATION } from '../../types/memoryNovelScan'
export { NovelScanError, buildNovelPrompt, parseNovelCandidateResponse, parseNovelCueResponse } from './novelScanProtocol'

function signature(config: ApiConfig) { return JSON.stringify({ ...config, customHeaders: Object.entries(config.customHeaders ?? {}).sort(([a], [b]) => a.localeCompare(b)) }) }
function configLabels(config: ApiConfig) {
  const preset = getPreset(config.provider)
  const safe = (value: string) => value.length <= 200 && (!config.apiKey || !value.includes(config.apiKey))
  const modelId = safe(config.selectedModel) && /^[\w./:-]+$/.test(config.selectedModel) ? config.selectedModel : '当前所选模型'
  const origin = (value: string) => { try { const url = new URL(value); return safe(url.origin) ? url.origin : '自定义地址（见设置）' } catch { return '自定义地址（见设置）' } }
  return { providerLabel: preset.label, modelId, endpointLabel: `${origin(preset.editableBaseURL ? config.baseURL : preset.baseURL)}${config.proxyUrl ? `，经代理 ${origin(config.proxyUrl)}` : ''}` }
}
/** Real production bounded adapter; never calls ordinary tools/history/streaming/retry paths. */
export async function generateNovelScan(request: NovelScanGenerationRequest): Promise<string> {
  const { default: api } = await import('../api')
  if (request.signal.aborted) novelFail('cancelled')
  return api.generateText(request.prompt, {
    system: request.system, signal: request.signal, beforeRequest: request.beforeRequest,
    maxTokens: request.maxOutputTokens, temperature: 0.1, type: 'memory-support',
    requestLimits: { maxAttempts: 1, maxResponseBytes: L.responseBytes, timeoutMs: request.timeoutMs, omitUsageContent: true },
  })
}
function transportReason(error: unknown): NovelScanReason {
  if (error instanceof NovelScanError) return error.reason
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'output_incomplete') return 'output_incomplete'
    if (error.code === 'response_too_large') return 'response_capacity'
    if (error.code === 'cancelled') return 'cancelled'
  }
  return 'provider'
}
function capture(input: NovelScanInput) {
  if (!input || !input.project || !Array.isArray(input.project.chapters) || !input.stats
    || typeof input.assertOwner !== 'function' || typeof input.assertFresh !== 'function'
    || typeof input.throughChapterId !== 'string' || typeof input.project.id !== 'string' || !input.project.id.length || input.project.id.length > 256 || typeof input.project.title !== 'string'
    || !(input.graphRevision === null || (typeof input.graphRevision === 'string' && input.graphRevision.length <= 128))
    || !/^[a-f0-9]{64}$/.test(input.stats.fingerprint)) novelFail('invalid_input')
  const project: MemoryProjectInput = { id: input.project.id, title: input.project.title, clues: [], chapters: input.project.chapters.map(chapter => {
    if (typeof chapter.id !== 'string' || !chapter.id.length || chapter.id.length > 256 || typeof chapter.title !== 'string' || typeof chapter.text !== 'string') novelFail('invalid_input')
    return { id: chapter.id, title: chapter.title, text: chapter.text }
  }) }
  if (new Set(project.chapters.map(chapter => chapter.id)).size !== project.chapters.length) novelFail('invalid_input')
  const stats: MemoryIndexStats = { ...input.stats, chapters: input.stats.chapters.map(item => ({ ...item })), sync: { ...input.stats.sync } }
  return { project, stats, throughChapterId: input.throughChapterId, graphRevision: input.graphRevision,
    assertOwner: input.assertOwner, assertFresh: input.assertFresh, signal: input.signal }
}
const reviewing = (state: NovelScanState) => state === 'reviewing_partial' || state === 'reviewing_complete_for_contract'
const terminal = (state: NovelScanState) => ['cancelled', 'expired', 'invalidated', 'closed'].includes(state)
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** Local preparation. Every provider page is bounded and requires explicit start/continuation. */
export async function prepareNovelCandidateScan(input: NovelScanInput): Promise<PreparedNovelScan> {
  const preparingStarted = performance.now()
  let saved = capture(input)
  const active = useApiConfig().activeConfig, config = novelClone(active.value), configSignature = signature(config)
  const labels = configLabels(config), budget = new NovelScanBudget(input.allocation)
  let cueCapacity = input.cueCapacity ?? L.cues
  if (!Number.isSafeInteger(cueCapacity) || cueCapacity < 4 || cueCapacity > L.maxCues) novelFail('invalid_input')
  let configurationChanged = false
  let onConfigurationChange = () => {}
  const stopConfig = watch(active, () => { configurationChanged = true; onConfigurationChange() }, { deep: true, flush: 'sync' })
  const controller = new AbortController()
  const identity: NovelScanIdentity = { campaignId: crypto.randomUUID(), segmentId: crypto.randomUUID(), generation: 1 }
  const createdAt = Date.now(), expiresAt = createdAt + L.campaignMs
  let readyExpiresAt = createdAt + L.readyMs, state: NovelScanState = 'ready_a', phase: NovelScanPhase = 'collect'
  let reason: NovelScanReason | undefined, preparing = true, reviewMode = false, disposed = false
  let graphRevision = saved.graphRevision, plan!: NovelSourcePlan
  let windowCursor = 0, segmentCueCount = 0, indexBytes = 0, proposalBytes = 0
  let representationLimited = false, crossSegmentGap = false, pauseRequested = false
  let published = false, plannerComplete = false, plannerDirty = true, collectionEnded = false, connectAuthorized = false
  let proposals: NovelScanCandidate[] = [], cues: NovelIndexedCue[] = []
  const cueKeys = new Set<string>(), singletonKeys = new Set<string>(), plannedJobs = new Set<string>(), completedJobs = new Set<string>()
  const skippedJobs = new Set<string>(), failedJobs = new Set<string>()
  const failureReasons = new Map<string, NovelScanReason>()
  const routeCounts = { singleton: 0, adjacent: 0, shared_key: 0, bridge: 0 }
  let windowStates: Uint8Array, windowSegments: string[], failedJobId: string | undefined, pendingJob: NovelConnectionJob | null = null
  let planner: Generator<NovelConnectionJob | null> | null = null, generator: NovelScanGenerator = generateNovelScan
  let inFlight: Promise<NovelScanPage> | null = null, inFlightKind: 'page' | 'local' | null = null, sourceGuardEpoch = 0, sourceChecksInFlight = 0
  let segment = 1
  const extraMisses: NovelScanProgress['misses'] = []
  const overflowMisses = { source: 0, connection: 0, representation: 0 }
  let planningCapacityMiss: NovelScanProgress['misses'][number] | undefined
  const jobMisses = new Map<string, NovelScanProgress['misses'][number]>()
  const recordMiss = (miss: NovelScanProgress['misses'][number]) => { if (extraMisses.length < 128) extraMisses.push(miss); else overflowMisses[miss.scope] += miss.knownCount }
  const recordJobMiss = (job: NovelConnectionJob, why: string) => {
    if (jobMisses.has(job.id) || jobMisses.size < 128) jobMisses.set(job.id, { scope: 'connection', reason: why, knownCount: 1, lowerBound: false,
      segmentId: identity.segmentId, job: { id: job.id, route: job.route, atomIds: [...job.atoms] } })
  }
  const unlinkSignals: Array<() => void> = []
  const dispose = () => { if (!disposed) { disposed = true; stopConfig(); for (const unlink of unlinkSignals) unlink() } }
  const clear = () => { proposals = []; proposalBytes = 0; published = false }
  const invalidate = (why: NovelScanReason) => {
    if (!terminal(state)) { state = why === 'cancelled' ? 'cancelled' : why === 'expired' ? 'expired' : 'invalidated'; reason = why }
    clear(); cues = []; cueKeys.clear(); planner = null; pendingJob = null; controller.abort(); dispose()
  }
  onConfigurationChange = () => invalidate('configuration_changed')
  const linkSignal = (signal?: AbortSignal) => {
    if (!signal) return
    const abort = () => invalidate('cancelled')
    if (signal.aborted) abort()
    else { signal.addEventListener('abort', abort, { once: true }); unlinkSignals.push(() => signal.removeEventListener('abort', abort)) }
  }
  linkSignal(saved.signal)
  const assertCurrent = () => {
    if (controller.signal.aborted || terminal(state)) novelFail(reason ?? 'cancelled')
    if (Date.now() >= expiresAt || (preparing && performance.now() - preparingStarted >= L.prepareMs)) novelFail(preparing ? 'guard_timeout' : 'expired')
    if (configurationChanged || signature(active.value) !== configSignature) novelFail('configuration_changed')
    try { saved.assertOwner() } catch { novelFail('owner_changed') }
    if (controller.signal.aborted) novelFail('cancelled')
    if (!preparing && !reviewMode) budget.check()
  }
  const handle = (value: NovelScanIdentity) => {
    if (!value || value.campaignId !== identity.campaignId || value.segmentId !== identity.segmentId || value.generation !== identity.generation) novelFail('stale_handle')
  }
  const bounded = <T>(operation: () => Promise<T>, milliseconds: number, timeout: NovelScanReason): Promise<T> => {
    assertCurrent()
    const activeRemaining = preparing || reviewMode ? Infinity : budget.remainingMs()
    const wallRemaining = expiresAt - Date.now(), prepareRemaining = preparing ? L.prepareMs - (performance.now() - preparingStarted) : Infinity
    const allowance = Math.min(milliseconds, wallRemaining, prepareRemaining, activeRemaining)
    const timeoutReason: NovelScanReason = wallRemaining <= allowance ? 'expired'
      : prepareRemaining <= allowance ? 'guard_timeout' : activeRemaining <= allowance ? 'budget' : timeout
    const deadline = performance.now() + allowance
    if (allowance <= 0) return Promise.reject(new NovelScanError(timeoutReason))
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown, value?: T) => { if (settled) return; settled = true; clearTimeout(timer); controller.signal.removeEventListener('abort', cancelled); if (error) reject(error); else resolve(value as T) }
      const cancelled = () => finish(new NovelScanError(reason ?? 'cancelled'))
      const timer = setTimeout(() => finish(new NovelScanError(timeoutReason)), allowance)
      controller.signal.addEventListener('abort', cancelled, { once: true })
      Promise.resolve().then(() => {
        assertCurrent()
        if (performance.now() >= deadline) novelFail(timeoutReason)
        return operation()
      }).then(value => {
        try { assertCurrent(); if (performance.now() >= deadline) novelFail(timeoutReason); finish(undefined, value) } catch (error) { finish(error) }
      }, error => finish(error))
    })
  }
  const guard = async (anchors: readonly FactAnchor[] = [], all = false) => {
    const started = performance.now(), epoch = ++sourceGuardEpoch
    const activeRemaining = preparing || reviewMode ? Infinity : budget.remainingMs()
    const guardDeadline = started + Math.min(L.guardMs, activeRemaining)
    const operation = new AbortController(), abortOperation = () => operation.abort()
    controller.signal.addEventListener('abort', abortOperation, { once: true })
    sourceChecksInFlight++
    try {
      await bounded(async () => {
        const check = () => { assertCurrent(); if (epoch !== sourceGuardEpoch) novelFail('guard_timeout'); if (performance.now() >= guardDeadline) novelFail(activeRemaining <= L.guardMs ? 'budget' : 'guard_timeout') }
        check()
        try { await saved.assertFresh(graphRevision, operation.signal) } catch (error) {
          if (error instanceof NovelScanError && error.reason === 'graph_changed') throw error
          novelFail('source_changed')
        }
        check()
        const chapters = all ? saved.project.chapters.slice(0, saved.project.chapters.findIndex(chapter => chapter.id === saved.throughChapterId) + 1)
          : [...new Set(anchors.map(anchor => anchor.chapterId))].map(id => saved.project.chapters.find(chapter => chapter.id === id)!)
        for (const chapter of chapters) {
          check()
          if (!chapter) novelFail('source_changed')
          const manifest = saved.stats.chapters.find(item => item.id === chapter.id)
          const revision = await chapterRevision(chapter)
          check()
          if (!manifest || revision !== manifest.revision) novelFail('source_changed')
        }
        for (const anchor of anchors) {
          check()
          const chapter = saved.project.chapters.find(item => item.id === anchor.chapterId)
          const manifest = saved.stats.chapters.find(item => item.id === anchor.chapterId)
          if (!chapter || manifest?.revision !== anchor.sourceRevision || chapter.text.slice(anchor.start, anchor.end) !== anchor.quote) novelFail('source_changed')
        }
        try { await saved.assertFresh(graphRevision, operation.signal) } catch (error) {
          if (error instanceof NovelScanError && error.reason === 'graph_changed') throw error
          novelFail('source_changed')
        }
        check()
      }, L.guardMs, 'guard_timeout')
    } finally {
      controller.signal.removeEventListener('abort', abortOperation); operation.abort()
      sourceChecksInFlight--; sourceGuardEpoch++
      if (!preparing && !reviewMode) budget.ledger.guardMs += Math.max(0, performance.now() - started)
    }
  }
  const missLedger = (): NovelScanProgress['misses'] => {
    const missed: NovelScanProgress['misses'] = []
    const overflow = { ...overflowMisses }
    const append = (entry: NovelScanProgress['misses'][number]) => { if (missed.length < 128) missed.push(entry); else overflow[entry.scope] += entry.knownCount }
    if (planningCapacityMiss) append(novelClone(planningCapacityMiss))
    if (crossSegmentGap) append({ scope: 'connection', reason: 'explicit_index_remainder_skip', knownCount: 1, lowerBound: true, segmentId: identity.segmentId })
    if (windowStates) for (let index = 0; index < plan.windows.length; index++) {
      const status = windowStates[index]
      if (status === 1) continue
      const window = plan.windows[index]!, first = plan.atoms[window.primary[0]!]!, last = plan.atoms[window.primary.at(-1)!]!
      const why = status === 2 ? 'skipped_windows' : status === 3 ? 'failed_windows' : 'unprocessed_windows'
      const segmentId = windowSegments[index] || identity.segmentId, previous = missed.at(-1)
      if (previous?.source && previous.reason === why && previous.segmentId === segmentId && previous.source.chapterId === first.chapterId && previous.source.end === first.start) {
        previous.source.end = last.end; previous.source.lastWindow = index; previous.knownCount++
      } else append({ scope: 'source', reason: why, knownCount: 1, lowerBound: false, segmentId,
        source: { chapterId: first.chapterId, revision: first.sourceRevision, start: first.start, end: last.end, firstWindow: index, lastWindow: index } })
    }
    for (const entry of jobMisses.values()) append(novelClone(entry))
    overflow.connection += Math.max(0, skippedJobs.size + failedJobs.size - jobMisses.size)
    for (const entry of extraMisses) append(novelClone(entry))
    for (const scope of ['source', 'connection', 'representation'] as const) if (overflow[scope]) missed.push({ scope, reason: 'range_ledger_overflow', knownCount: overflow[scope], lowerBound: true })
    return missed
  }
  const chapterCoverage = (offset = 0, limit = 50): NovelScanChapterCoverage[] => {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) novelFail('invalid_input')
    const chapters = saved.project.chapters.slice(0, plan.cutoff + 1).map((chapter, ordinal) => ({
      chapterId: chapter.id, title: chapter.title, revision: saved.stats.chapters[ordinal]!.revision,
      eligibleChars: chapter.text.length, processedChars: 0, remainingChars: chapter.text.length, skippedChars: 0, failedChars: 0, empty: chapter.text.length === 0,
    }))
    for (let index = 0; index < plan.windows.length; index++) {
      const status = windowStates[index]!
      if (!status) continue
      for (const atomId of plan.windows[index]!.primary) {
        const atom = plan.atoms[atomId]!, item = chapters[atom.ordinal]!, length = atom.end - atom.start
        if (status === 1) { item.processedChars += length; item.remainingChars -= length }
        else if (status === 2) { item.skippedChars += length; item.remainingChars -= length }
        else if (status === 3) item.failedChars += length
      }
    }
    return chapters.slice(offset, offset + limit)
  }
  const progress = (): NovelScanProgress => {
    budget.charge()
    let processedChars = 0, skippedChars = 0, failedChars = 0, processedWindows = 0, skippedWindows = 0, failedWindows = 0
    for (let index = 0; index < plan.windows.length; index++) {
      const status = windowStates[index], chars = plan.windows[index]!.primary.reduce((sum, id) => sum + plan.atoms[id]!.quote.length, 0)
      if (status === 1) { processedChars += chars; processedWindows++ }
      if (status === 2) { skippedChars += chars; skippedWindows++ }
      if (status === 3) { failedChars += chars; failedWindows++ }
    }
    const sourceComplete = processedWindows === plan.windows.length
    return { eligibleChars: plan.eligibleChars, processedChars, remainingChars: plan.eligibleChars - processedChars - skippedChars, skippedChars, failedChars,
      eligibleWindows: plan.windows.length, processedWindows, skippedWindows, failedWindows,
      sourceCoverage: sourceComplete ? 'complete' : 'incomplete',
      connectionCoverage: plannerComplete && !skippedJobs.size && !failedJobs.size && !representationLimited && !crossSegmentGap ? 'complete_for_contract' : 'incomplete',
      representationLimited, crossSegmentGap, indexCueCount: cues.length, segmentCueCount, candidateCount: proposals.length,
      jobsPlanned: plannedJobs.size, jobsProcessed: completedJobs.size, jobsSkipped: skippedJobs.size, jobsFailed: failedJobs.size,
      planningComplete: plannerComplete, minimumConnectionCalls: singletonKeys.size, routeCounts: { ...routeCounts }, misses: missLedger(), ledger: novelClone(budget.ledger), expiresAt }
  }
  const snapshot = (): NovelScanPage => ({ ...identity, state, phase, ...(reason ? { reason } : {}), ...(failedJobId ? { failedJobId } : {}),
    progress: progress(), ...(reviewing(state) && published ? { candidates: novelClone(proposals) } : {}) })
  const pause = (why: NovelScanReason) => { state = 'paused'; reason = why }
  const accountedPage = (): NovelScanPage => {
    // Snapshot construction/serialization is processing too, including the final publication tail.
    const page = snapshot()
    budget.charge()
    if (!terminal(state) && budget.remainingMs() <= 0) {
      pause('budget'); published = false; page.state = state; page.reason = reason; delete page.candidates
    }
    budget.stop(); page.progress.ledger = novelClone(budget.ledger)
    return page
  }

  const applyFailure = (error: unknown) => {
    const why = transportReason(error)
    if (['source_changed', 'graph_changed', 'owner_changed', 'configuration_changed', 'guard_timeout', 'cancelled', 'expired'].includes(why)) invalidate(why)
    else pause(why)
  }
  const currentAnchors = () => phase === 'collect' ? (plan.windows[windowCursor]?.sources ?? []).map(id => novelAnchor(plan.atoms[id]!))
    : (pendingJob?.atoms ?? []).map(id => novelAnchor(plan.atoms[id]!))
  const enterB = async () => {
    collectionEnded = true; connectAuthorized = false; phase = 'connect'; failedJobId = undefined; reason = undefined
    if (plannerDirty || !planner) { planner = createNovelConnectionPlanner(cues); plannerComplete = false; plannerDirty = false }
    await guard()
    readyExpiresAt = Math.min(expiresAt, Date.now() + L.readyMs)
    state = 'ready_b'
  }
  const publish = async () => {
    await guard([], true)
    assertCurrent()
    state = progress().sourceCoverage === 'complete' && plannerComplete && !skippedJobs.size && !failedJobs.size && !representationLimited && !crossSegmentGap
      ? 'reviewing_complete_for_contract' : 'reviewing_partial'
    reason = undefined; published = true
  }
  const preparePending = async (): Promise<boolean> => {
    if (pendingJob) {
      if (!plannedJobs.has(pendingJob.id)) { pause('planning_capacity'); return false }
      return true
    }
    if (!planner) { planner = createNovelConnectionPlanner(cues); plannerDirty = false }
    for (let step = 0; step < L.pagePlanningSteps; step++) {
      assertCurrent()
      const next = planner.next()
      if (next.done) { plannerComplete = true; await publish(); return false }
      const job = next.value
      if (!job || plannedJobs.has(job.id)) continue
      if (plannedJobs.size >= L.plannedJobs) {
        pendingJob = job
        planningCapacityMiss ??= { scope: 'connection', reason: 'planning_capacity', knownCount: 1, lowerBound: true, segmentId: identity.segmentId, job: { id: job.id, route: job.route, atomIds: [...job.atoms] } }
        pause('planning_capacity'); return false
      }
      plannedJobs.add(job.id); routeCounts[job.route]++; pendingJob = job; return true
    }
    await yieldTask(); assertCurrent(); return false
  }
  const runPage = async (): Promise<NovelScanPage> => {
    budget.start()
    let attempted = false, committed = false
    try {
      assertCurrent()
      if (pauseRequested) { pauseRequested = false; pause('user'); return accountedPage() }
      if (phase === 'collect' && windowCursor >= plan.windows.length) { await enterB(); return accountedPage() }
      if (phase === 'connect' && !connectAuthorized) { await enterB(); return accountedPage() }
      if (phase === 'connect' && !await preparePending()) return accountedPage()
      const window: NovelSourceWindow | undefined = phase === 'collect' ? plan.windows[windowCursor] : undefined
      if (phase === 'collect') {
        if (cues.length + 4 > L.indexCues || indexBytes + 65_536 > L.indexBytes) { pause('index_capacity'); return accountedPage() }
        if (segmentCueCount + 4 > cueCapacity) { pause('cue_capacity'); return accountedPage() }
      } else if (proposals.length + 2 > L.candidates || proposalBytes + 131_072 > L.candidateBytes) { pause('review_capacity'); return accountedPage() }
      const jobId = window?.id ?? pendingJob!.id, anchors = currentAnchors()
      const prompt = buildNovelPrompt(phase, anchors, window?.primaryReferences)
      budget.canDispatch(prompt)
      await guard(anchors)
      budget.reserve(prompt)
      attempted = true
      let beforeRequestCalled = false
      const attempt = new AbortController(), abortAttempt = () => attempt.abort()
      controller.signal.addEventListener('abort', abortAttempt, { once: true })
      const providerStarted = performance.now()
      let raw: string
      try {
        const timeoutMs = Math.max(1, Math.min(L.providerMs, Math.floor(budget.remainingMs())))
        raw = await bounded(() => generator({ phase, system: prompt.system, prompt: prompt.prompt, signal: attempt.signal,
          maxOutputTokens: L.outputTokens, timeoutMs,
          async beforeRequest() {
            if (beforeRequestCalled || attempt.signal.aborted) novelFail('cancelled')
            beforeRequestCalled = true
            await guard(anchors)
            if (attempt.signal.aborted) novelFail('cancelled')
            assertCurrent()
          },
        }), timeoutMs, 'provider')
      } finally {
        attempt.abort(); controller.signal.removeEventListener('abort', abortAttempt)
        budget.ledger.providerMs += Math.max(0, performance.now() - providerStarted)
      }
      budget.ledger.observedResponseBytes += typeof raw === 'string' ? Math.min(L.responseBytes + 1, novelBytes(raw)) : 0
      await guard(anchors)
      if (phase === 'collect') {
        const parsed = parseNovelCueResponse(raw, anchors, window!.primaryReferences)
        const additions: Array<{ cue: NovelIndexedCue; key: string; bytes: number }> = []
        for (const item of parsed.cues) {
          const atoms = item.references.map(ref => window!.sources[ref - 1]!).sort((a, b) => a - b)
          const key = JSON.stringify([item.kind, [...item.keys].sort(), atoms])
          if (cueKeys.has(key) || additions.some(addition => addition.key === key)) continue
          const cue = { id: cues.length + additions.length, kind: item.kind, keys: [...item.keys], atoms }
          additions.push({ cue, key, bytes: novelBytes(JSON.stringify({ ...cue, anchors: atoms.map(id => novelAnchor(plan.atoms[id]!)) })) })
        }
        if (cues.length + additions.length > L.indexCues || indexBytes + additions.reduce((sum, item) => sum + item.bytes, 0) > L.indexBytes) novelFail('index_capacity')
        await guard(anchors); assertCurrent()
        for (const addition of additions) { cues.push(addition.cue); cueKeys.add(addition.key); singletonKeys.add(addition.cue.atoms.join(',')); indexBytes += addition.bytes }
        segmentCueCount += additions.length; plannerDirty ||= additions.length > 0
        if (additions.length) plannerComplete = false
        representationLimited ||= parsed.saturated
        if (parsed.saturated) {
          const first = plan.atoms[window!.primary[0]!]!, last = plan.atoms[window!.primary.at(-1)!]!
          recordMiss({ scope: 'representation', reason: 'provider_saturated', knownCount: 1, lowerBound: true, segmentId: identity.segmentId,
            source: { chapterId: first.chapterId, revision: first.sourceRevision, start: first.start, end: last.end, firstWindow: windowCursor, lastWindow: windowCursor } })
        }
        failureReasons.delete(window!.id)
        windowStates[windowCursor] = 1; windowSegments[windowCursor] = identity.segmentId; windowCursor++; failedJobId = undefined; committed = true
        if (windowCursor >= plan.windows.length) await enterB()
      } else {
        const parsed = parseNovelCandidateResponse(raw, anchors)
        const additions = parsed.candidates.map((item, index): NovelScanCandidate => ({ ...item, ...identity,
          id: `${identity.campaignId}:${segment}:${completedJobs.size}:${index}`, jobId, projectId: saved.project.id,
          createdBy: 'model', authorConfirmed: false, semanticValidation: 'protocol-and-current-sources' }))
        const bytes = novelBytes(JSON.stringify(additions))
        if (proposals.length + additions.length > L.candidates || proposalBytes + bytes > L.candidateBytes) novelFail('review_capacity')
        await guard(anchors); assertCurrent()
        proposals.push(...additions); proposalBytes += bytes; representationLimited ||= parsed.saturated
        if (parsed.saturated) recordMiss({ scope: 'representation', reason: 'provider_saturated', knownCount: 1, lowerBound: true, segmentId: identity.segmentId,
          job: { id: jobId, route: pendingJob!.route, atomIds: [...pendingJob!.atoms] } })
        completedJobs.add(jobId); failureReasons.delete(jobId); failedJobs.delete(jobId); jobMisses.delete(jobId); pendingJob = null; failedJobId = undefined; committed = true
      }
      if (pauseRequested && (state === 'running_a' || state === 'running_b')) { pauseRequested = false; pause('user') }
      assertCurrent()
    } catch (error) {
      if (sourceChecksInFlight > 0 && transportReason(error) === 'provider') error = new NovelScanError('guard_timeout')
      sourceGuardEpoch++
      if (attempted && !committed && !terminal(state)) {
        const failure = transportReason(error)
        if (phase === 'collect' && windowCursor < plan.windows.length) { windowStates[windowCursor] = 3; windowSegments[windowCursor] = identity.segmentId; failedJobId = plan.windows[windowCursor]!.id; failureReasons.set(failedJobId, failure) }
        else if (pendingJob) { failedJobId = pendingJob.id; failedJobs.add(pendingJob.id); recordJobMiss(pendingJob, 'failed_job'); failureReasons.set(pendingJob.id, failure) }
      }
      applyFailure(error)
    }
    return accountedPage()
  }
  const launch = (): Promise<NovelScanPage> => {
    if (inFlight) return inFlight
    // Lock synchronously, before scheduling a microtask or calling a provider.
    const promise = Promise.resolve().then(runPage)
    inFlight = promise; inFlightKind = 'page'
    void promise.finally(() => { if (inFlight === promise) { inFlight = null; inFlightKind = null } })
    return promise
  }
  const local = (operation: () => Promise<void>, isReview = false): Promise<NovelScanPage> => {
    if (inFlight) return inFlight
    const promise = Promise.resolve().then(async () => {
      reviewMode = isReview
      const localStarted = performance.now()
      if (!isReview) budget.start()
      try { await operation() } catch (error) { applyFailure(error) }
      if (isReview) budget.ledger.reviewMs += Math.max(0, performance.now() - localStarted)
      const page = isReview ? snapshot() : accountedPage()
      reviewMode = false
      return page
    })
    inFlight = promise; inFlightKind = 'local'
    void promise.finally(() => { if (inFlight === promise) { inFlight = null; inFlightKind = null } })
    return promise
  }
  try {
    assertCurrent()
    await guard([], true)
    plan = await bounded(() => planNovelWindows(saved.project, saved.stats, saved.throughChapterId, assertCurrent), L.prepareMs, 'guard_timeout')
    windowStates = new Uint8Array(plan.windows.length); windowSegments = Array.from({ length: plan.windows.length }, () => '')
    await guard([], true)
    budget.ledger.preparationMs = Math.max(0, performance.now() - preparingStarted)
    preparing = false
  } catch (error) { dispose(); controller.abort(); throw error }
  const preview = (): NovelScanPreview => ({ ...identity, projectId: saved.project.id, throughChapterId: saved.throughChapterId,
    chapterCount: plan.cutoff + 1, eligibleChars: plan.eligibleChars, windows: plan.windows.length,
    ...labels, readyExpiresAt, expiresAt, allocation: novelClone(budget.ledger.authorized), cueCapacity, bounds: L })
  const start = (value: NovelScanIdentity, target: NovelScanPhase, supplied?: NovelScanGenerator): Promise<NovelScanPage> => {
    handle(value)
    if (inFlight) return inFlightKind === 'local' ? inFlight.then(() => start(value, target, supplied)) : inFlight
    if (state !== (target === 'collect' ? 'ready_a' : 'ready_b')) return Promise.resolve(snapshot())
    if (Date.now() >= readyExpiresAt) { invalidate('expired'); return Promise.resolve(snapshot()) }
    if (supplied) generator = supplied
    if (target === 'connect') connectAuthorized = true
    phase = target; state = target === 'collect' ? 'running_a' : 'running_b'; reason = undefined
    return launch()
  }
  const result: PreparedNovelScan = {
    get preview() { return preview() },
    startA: (value, supplied) => start(value, 'collect', supplied),
    startB: (value, supplied) => start(value, 'connect', supplied),
    advance(value) { handle(value); if (inFlight) return inFlight; return state === 'running_a' || state === 'running_b' ? launch() : Promise.resolve(snapshot()) },
    decide(value: NovelScanIdentity, decision: NovelScanDecision): Promise<NovelScanPage> {
      handle(value)
      if (decision.type === 'cancel') { invalidate('cancelled'); return Promise.resolve(snapshot()) }
      if (decision.type === 'pause') {
        if (inFlight) pauseRequested = true
        else if (state === 'running_a' || state === 'running_b') pause('user')
        return Promise.resolve(snapshot())
      }
      if (inFlight) return inFlightKind === 'local' ? inFlight.then(() => result.decide(value, decision)) : inFlight
      if (terminal(state)) return Promise.resolve(snapshot())
      if (decision.type === 'ignore') {
        if (!reviewing(state)) novelFail('invalid_decision')
        proposals = proposals.filter(candidate => candidate.id !== decision.candidateId); proposalBytes = novelBytes(JSON.stringify(proposals)); return Promise.resolve(snapshot())
      }
      if (decision.type === 'extend') {
        budget.grant(decision.grant, identity)
        return Promise.resolve(snapshot())
      }
      if (decision.type === 'extend-cue-capacity') {
        if (!Number.isSafeInteger(decision.newCapacity) || decision.newCapacity < cueCapacity || decision.newCapacity > L.maxCues) novelFail('invalid_decision')
        cueCapacity = decision.newCapacity; return Promise.resolve(snapshot())
      }
      if (decision.type === 'finish-partial') {
        if (reviewing(state)) return Promise.resolve(snapshot())
        return local(async () => { if (phase === 'collect') await enterB(); else await publish() })
      }
      if (decision.type === 'skip-index-remainder') {
        if (state !== 'paused' || reason !== 'index_capacity' || phase !== 'collect') novelFail('invalid_decision')
        crossSegmentGap = true
        for (; windowCursor < plan.windows.length; windowCursor++) { windowStates[windowCursor] = 2; windowSegments[windowCursor] = identity.segmentId }
        return local(enterB)
      }
      if (decision.type === 'retry' || decision.type === 'skip') {
        if (state !== 'paused' || !failedJobId || decision.failedJobId !== failedJobId) novelFail('invalid_decision')
        if (decision.type === 'skip') {
          failureReasons.delete(failedJobId)
          if (phase === 'collect') { windowStates[windowCursor] = 2; windowSegments[windowCursor] = identity.segmentId; windowCursor++ }
          else if (pendingJob) { skippedJobs.add(pendingJob.id); failedJobs.delete(pendingJob.id); recordJobMiss(pendingJob, 'skipped_job'); pendingJob = null }
          failedJobId = undefined
        }
        state = phase === 'collect' ? 'running_a' : 'running_b'; reason = undefined; return launch()
      }
      if (decision.type === 'continue') {
        if (state !== 'paused' || failedJobId || ['planning_capacity', 'index_capacity'].includes(reason ?? '')) novelFail('invalid_decision')
        state = phase === 'collect' ? 'running_a' : 'running_b'; reason = undefined; return launch()
      }
      return Promise.resolve(snapshot())
    },
    nextSegment(value, nextInput) {
      handle(value)
      if (inFlight && inFlightKind === 'local') return inFlight.then(() => result.nextSegment(value, nextInput))
      if (!reviewing(state) || proposals.length || inFlight) novelFail('invalid_decision')
      return local(async () => {
        let supplied: NovelScanInput
        if (typeof nextInput === 'function') {
          // A successful input keeps this signal for later source guards; a failed builder
          // must stop its own late continuation without cancelling the reusable campaign.
          const operation = new AbortController(), abortOperation = () => operation.abort()
          const unlink = () => controller.signal.removeEventListener('abort', abortOperation)
          controller.signal.addEventListener('abort', abortOperation, { once: true })
          try {
            supplied = await bounded(() => nextInput(operation.signal), L.guardMs, 'guard_timeout')
            assertCurrent()
            unlinkSignals.push(() => { unlink(); operation.abort() })
          } catch (error) { unlink(); operation.abort(); throw error }
        } else supplied = nextInput
        assertCurrent()
        const next = capture(supplied)
        if (next.graphRevision !== graphRevision || next.project.id !== saved.project.id || next.throughChapterId !== saved.throughChapterId
          || next.stats.fingerprint !== saved.stats.fingerprint || JSON.stringify(next.project) !== JSON.stringify(saved.project)) novelFail('source_changed')
        saved = next; linkSignal(next.signal); await guard([], true)
        segment++; identity.segmentId = crypto.randomUUID(); identity.generation++; segmentCueCount = 0; connectAuthorized = false; clear(); readyExpiresAt = Math.min(expiresAt, Date.now() + L.readyMs)
        reason = undefined; failedJobId = undefined
        if (!plannerComplete && collectionEnded) {
          phase = 'connect'; state = 'ready_b'
          if (pendingJob && failedJobs.has(pendingJob.id)) { failedJobId = pendingJob.id; pause(failureReasons.get(pendingJob.id) ?? 'provider') }
        } else if (windowCursor < plan.windows.length) {
          phase = 'collect'; state = 'ready_a'; collectionEnded = false
          if (windowStates[windowCursor] === 3) { failedJobId = plan.windows[windowCursor]!.id; pause(failureReasons.get(failedJobId) ?? 'provider') }
        } else { state = 'closed'; dispose() }
      })
    },
    async reviewCandidate(value, candidateId) {
      handle(value)
      if (!reviewing(state) || !published) return null
      const candidate = proposals.find(item => item.id === candidateId)
      if (!candidate) return null
      await local(() => guard(candidate.kind === 'relationship' ? candidate.evidence : candidate.premises.flatMap(group => group.evidence)), true)
      return reviewing(state) && published ? novelClone(candidate) : null
    },
    notifyAccepted(value, candidateId, previousRevision, actualRevision) {
      handle(value)
      if (terminal(state)) return Promise.resolve(snapshot())
      if (!reviewing(state) || !published || graphRevision !== previousRevision || typeof actualRevision !== 'string' || !actualRevision.length
        || actualRevision === previousRevision || !proposals.some(candidate => candidate.id === candidateId)) novelFail('invalid_decision')
      graphRevision = actualRevision
      proposals = proposals.filter(candidate => candidate.id !== candidateId); proposalBytes = novelBytes(JSON.stringify(proposals))
      return local(() => guard([], true), true)
    },
    audit(value) { handle(value); return terminal(state) ? Promise.resolve(snapshot()) : local(() => guard([], true), reviewing(state)) },
    chapterCoverage, snapshot, cancel() { invalidate('cancelled') },
  }
  return result
}
