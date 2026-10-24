/** Offline-first evaluation of the genuine Writer Agent → memory → APIService → SDK path.
 * Mock HTTP replies demonstrate mechanics only. Never apply a proposal or score prose automatically. */
import { randomUUID } from 'node:crypto'
import { readFile, readdir, realpath, open, stat } from 'node:fs/promises'
import { resolve, relative, dirname, join, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ApiConfig, GenerateOptions } from '../../src/types/api'
import type { MemoryEvidence, MemoryProjectInput } from '../../src/types/memory'
import type { WriterAgentPhase, WriterAgentSnapshot } from '../../src/types/writerAgent'
import { loadWriterAgentEvalFixture, type WriterAgentEvalCase } from './writer-agent-eval-fixture'
import { EvaluationError, EVALUATION_LIVE_LIMITS, blockNodeNetwork, createEvaluationFetchGuard,
  containsCredential, scrubCredential, sha256, validateCredential, validateLivePlan, type DispatchRecord,
  type ExpectedDispatch, type WriterAgentLivePlan } from './writer-agent-eval-network'

export type EvaluationOutcome = 'draft_ready' | 'needs_author_input' | 'retrieval_insufficient' | 'failed' | 'not_run'
export interface PrivateCasePacket {
  caseId: string
  phase: WriterAgentPhase | 'not_run'
  notRunReason?: 'not_selected' | 'integrity_stop'
  status: EvaluationOutcome
  draft: string | null
  plan: string | null
  selectedEvidence: MemoryEvidence[]
  evidence: MemoryEvidence[]
  missingPremiseIds: string[]
  requests: DispatchRecord[]
  usage: WriterAgentSnapshot['usage']
  audit: WriterAgentSnapshot['audit']
  sourceBeforeSha256: string
  sourceAfterSha256: string
}
export interface WriterAgentPrivatePacket {
  schemaVersion: 1
  kind: 'writer-agent-evaluation-private'
  runId: string
  mode: 'mock' | 'live'
  fixtureSha256: string
  sourceTreeSha256: string
  sourceTreeAfterSha256: string
  cases: PrivateCasePacket[]
}
const root = fileURLToPath(new URL('../../', import.meta.url))
export async function sourceTreeHash(): Promise<string> {
  const entries: Array<[string, string]> = []
  async function walk(path: string) {
    for (const entry of (await readdir(join(root, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${path}/${entry.name}`
      if (entry.isDirectory()) await walk(name)
      else if (entry.isFile()) entries.push([name, sha256(await readFile(join(root, name)))])
      else throw new EvaluationError('source_changed')
    }
  }
  for (const path of ['src', 'scripts']) await walk(path)
  for (const path of ['package.json', 'package-lock.json', 'tsconfig.json']) entries.push([path, sha256(await readFile(join(root, path)))])
  return sha256(JSON.stringify(entries))
}
const chapterHash = (chapter: { title: string; text: string }) => sha256(JSON.stringify([chapter.title, chapter.text]))
const ordered = (a: MemoryEvidence, b: MemoryEvidence) => a.ordinal - b.ordinal || a.start - b.start || a.end - b.end || a.id.localeCompare(b.id)
/** Frozen mechanical author surrogate, NOT a semantic-support or human judgment score.
 * Every required full span must be covered by real, current, disclosed, verified hits. */
export function selectRequiredEvidence(testCase: WriterAgentEvalCase, hits: readonly MemoryEvidence[]) {
  const boundary = testCase.project.chapters.findIndex(row => row.id === testCase.throughChapterId)
  const chapters = testCase.project.chapters.slice(0, boundary + 1)
  const current = new Map(chapters.map(chapter => [chapter.id, chapter]))
  const verified = hits.filter(hit => {
    const chapter = current.get(hit.chapterId)
    return chapter && hit.projectId === testCase.project.id && Number.isInteger(hit.start) && Number.isInteger(hit.end)
      && hit.start >= 0 && hit.end > hit.start && hit.end <= chapter.text.length
      && hit.revision === chapterHash(chapter) && hit.quote === chapter.text.slice(hit.start, hit.end)
  }).sort(ordered)
  const covers = (hit: MemoryEvidence, premise: WriterAgentEvalCase['requiredPremises'][number]) => {
    const chapter = current.get(premise.chapterId)
    return !!chapter && premise.quote.length > 0 && premise.revision === chapterHash(chapter)
      && premise.quote === chapter.text.slice(premise.start, premise.end)
      && hit.chapterId === premise.chapterId && hit.revision === premise.revision
      && hit.start <= premise.start && hit.end >= premise.end
      && hit.quote.slice(premise.start - hit.start, premise.end - hit.start) === premise.quote
  }
  const missingPremiseIds = testCase.requiredPremises.filter(premise => !verified.some(hit => covers(hit, premise))).map(row => row.id)
  if (!testCase.requiredPremises.length || missingPremiseIds.length || verified.length > 6) {
    return { selected: [] as MemoryEvidence[], verified, missingPremiseIds, covered: testCase.requiredPremises.length - missingPremiseIds.length, complete: false }
  }
  const coverage = verified.map(hit => testCase.requiredPremises.map((premise, index) => covers(hit, premise) ? index : -1).filter(index => index >= 0))
  const indices = minimumCover(coverage, testCase.requiredPremises.length)
  const selected = indices?.map(index => verified[index]!) ?? []
  return { selected, verified, missingPremiseIds, covered: testCase.requiredPremises.length, complete: indices !== null }
}

/** Minimum-cardinality cover, then lexicographic sorted-index tie-break. */
export function minimumCover(coverage: readonly (readonly number[])[], premiseCount: number): number[] | null {
  if (premiseCount < 1 || coverage.length > 6) return null
  let best: number[] | null = null
  for (let mask = 1; mask < (1 << coverage.length); mask++) {
    const indices = coverage.map((_row, index) => index).filter(index => mask & (1 << index))
    if (best && indices.length > best.length) continue
    const covered = new Set(indices.flatMap(index => [...coverage[index]!]))
    if (Array.from({ length: premiseCount }, (_value, index) => index).some(index => !covered.has(index))) continue
    if (!best || indices.length < best.length || indices.some((value, index) => value !== best![index] && indices.slice(0, index).every((n, i) => n === best![i]) && value < best![index]!)) best = indices
  }
  return best

}

const safeHtml = (text: string) => `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`
const promptText = (system: string, prompt: string) => {
  const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []
  return [system, ...strings(JSON.parse(prompt))].join('\n')
}
const integer = (n: number) => Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(n)))
const allowedErrors = new Set(['invalid_input', 'not_ready', 'stale', 'cancelled', 'expired', 'timeout', 'model_deadline', 'retrieval_deadline',
  'source_guard_deadline', 'active_deadline', 'limits', 'protocol', 'no_candidates', 'needs_author_input', 'transport', 'output_incomplete', 'settings', 'failed'])
let running = false
export interface EvaluationOptions {
  mode?: 'mock' | 'live'
  /** Live runs must be independently approved. These values are never taken from environment variables. */
  livePlan?: unknown
  credential?: string
  /** Synthetic boundary tests only: replaces the final HTTP dispatch, not the production SDK/runtime. */
  testTransport?: typeof fetch
  /** Synthetic error-path tests; default runs use the frozen fixture's HTTP replies. */
  mockReply?: (caseId: string, phase: 'plan' | 'draft', defaultText: string) => string
}
export async function runWriterAgentEvaluation(options: EvaluationOptions = {}) {
  if (running) throw new EvaluationError('internal')
  running = true
  const mode = options.mode ?? 'mock'
  if (mode !== 'mock' && mode !== 'live') { running = false; throw new EvaluationError('invalid_plan') }
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const oldFetch = globalThis.fetch
  const oldConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug }
  let network = { restore: () => {}, count: () => 0 }
  const storage = new Map<string, string>()
  let fictionStorageWrites = 0
  let credential = ''
  let clearConfig: (() => void) | undefined
  try {
    // No application storage, secrets or active account is read. Storage writes are
    // temporary in-process config/billing metadata and are discarded on return.
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (/novel|chapter|fiction|writer/i.test(key)) { fictionStorageWrites++; throw new EvaluationError('internal') }
        storage.set(key, String(value))
      }, removeItem: (key: string) => { storage.delete(key) }, clear: () => storage.clear(),
      key: (index: number) => [...storage.keys()][index] ?? null, get length() { return storage.size },
    } })
    // Third-party SDK diagnostics are not an evaluation output channel.
    console.log = console.warn = console.error = console.info = console.debug = () => {}
    globalThis.fetch = async () => { throw new EvaluationError('dispatch_denied') }
    if (mode === 'mock' || options.testTransport) network = blockNodeNetwork()
    const { fixture, sha256: fixtureSha256 } = await loadWriterAgentEvalFixture()
    const sourceBefore = await sourceTreeHash()
    let plan: WriterAgentLivePlan | undefined
    if (mode === 'live') {
      plan = validateLivePlan(options.livePlan, fixtureSha256, fixture.cases.map(row => row.id))
      credential = validateCredential(options.credential ?? '')
    } else {
      if (options.livePlan !== undefined || options.credential !== undefined || options.testTransport) throw new EvaluationError('invalid_plan')
      credential = 'synthetic-placeholder-no-real-secret'
    }
    const endpoint = plan?.endpoint ?? 'https://writer-agent-evaluation.invalid/v1/chat/completions'
    const model = plan?.model ?? 'synthetic-writer-agent-evaluation'
    const config: ApiConfig = { provider: 'custom', baseURL: endpoint.slice(0, -'/chat/completions'.length),
      apiKey: credential, selectedModel: model, temperature: 0.2, maxTokens: 1_200, unlimitedTokens: false,
      customHeaders: {}, proxyUrl: '', thinkingProtocol: 'auto', thinkingMode: 'default' }
    const { useApiConfig } = await import('../../src/services/apiConfig')
    const api = (await import('../../src/services/api')).default
    const { createWriterAgent } = await import('../../src/services/writerAgent')
    const { MemoryIndex } = await import('../../src/services/memory/engine')
    const { BoundedGenerationError } = await import('../../src/services/aiRequestLimits')
    useApiConfig().updateConfig(config)
    clearConfig = () => useApiConfig().updateConfig({ ...config, apiKey: '' })
    const privatePacket: WriterAgentPrivatePacket = { schemaVersion: 1, kind: 'writer-agent-evaluation-private', runId: randomUUID(), mode,
      fixtureSha256, sourceTreeSha256: sourceBefore, sourceTreeAfterSha256: sourceBefore, cases: [] }
    const publicCases: Array<ReturnType<typeof publicCase> | ReturnType<typeof notRunCase>> = []
    let totalDispatches = 0
    const chosen = plan ? plan.caseIds : fixture.cases.map(row => row.id)
    let integrityStop = false
    for (const testCase of fixture.cases) {
      if (!chosen.includes(testCase.id) || integrityStop) {
        const reason = chosen.includes(testCase.id) ? 'integrity_stop' : 'not_selected'
        const sourceHash = sha256(JSON.stringify(testCase.project))
        privatePacket.cases.push({ caseId: testCase.id, phase: 'not_run', status: 'not_run', notRunReason: reason, draft: null, plan: null, selectedEvidence: [], evidence: [], missingPremiseIds: [], requests: [], usage: [], audit: [], sourceBeforeSha256: sourceHash, sourceAfterSha256: sourceHash })
        publicCases.push(notRunCase(testCase, reason))
        continue
      }
      const started = performance.now()
      const source = structuredClone(testCase.project) as MemoryProjectInput
      const sourceHash = sha256(JSON.stringify(source))
      const target = source.chapters.find(chapter => chapter.id === testCase.targetChapterId)!
      const records: DispatchRecord[] = []
      let expected: ExpectedDispatch | null = null
      let visiblePlan: string | null = null, visibleDraft: string | null = null
      let calls = 0, searches = 0, reads = 0, prewarmSyncs = 0, currentSyncs = 0, echo = false, boundaryViolation = false
      const prompts: Partial<Record<'plan' | 'draft', string>> = {}
      const phases = new Set<WriterAgentPhase>()
      const guard = createEvaluationFetchGuard({ endpoint, model, credential, records,
        maxRequests: (plan ? EVALUATION_LIVE_LIMITS.maxHttpRequests : chosen.length * 2) - totalDispatches,
        expected: () => expected,
        send: mode === 'live' ? options.testTransport ?? oldFetch : async () => {
          const phase = expected!.phase
          const defaultText = phase === 'plan' ? testCase.expectedMock.planText : testCase.expectedMock.draftText ?? ''
          const text = options.mockReply?.(testCase.id, phase, defaultText) ?? defaultText
          return new Response(JSON.stringify({ id: 'synthetic-evaluation', object: 'chat.completion', created: 1, model,
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
            usage: { prompt_tokens: phase === 'plan' ? 101 : 201, completion_tokens: phase === 'plan' ? 31 : 71,
              total_tokens: phase === 'plan' ? 132 : 272 } }), { headers: { 'content-type': 'application/json' } })
        },
      })
      globalThis.fetch = guard.fetch
      const controller = createWriterAgent({
        getOwner: () => ({ ownershipKey: 1, projectId: source.id, targetChapterId: target.id, throughChapterId: testCase.throughChapterId,
          editorHtml: safeHtml(target.text), brief: testCase.brief, ready: true }),
        onChange: snapshot => { phases.add(snapshot.phase) },
        ports: {
          getConfig: () => config,
          readProject: async id => { reads++; if (id !== source.id) throw new EvaluationError('internal'); return structuredClone(source) },
          createMemoryClient: () => {
            const index = new MemoryIndex()
            const stale = testCase.staleChapters?.length ? structuredClone(source) : null
            if (stale) stale.chapters = stale.chapters.map(chapter => testCase.staleChapters?.find(old => old.id === chapter.id) ?? chapter)
            const prewarm = stale ? index.sync(stale).then(() => { prewarmSyncs++ }) : Promise.resolve()
            return { sync: async project => { await prewarm; currentSyncs++; return index.sync(project) },
              search: (query, remote, beforeRemote, controls) => {
                searches++
                if (remote || !controls?.signal || query.limit !== 6) throw new EvaluationError('internal')
                return index.search(query, remote, beforeRemote)
              }, invalidateSource: () => index.invalidateSource(), dispose: () => index.invalidateSource() }
          },
          generateText: async (prompt: string, request: GenerateOptions) => {
            calls++
            const phase = request.type === 'writer-agent-plan' ? 'plan' : 'draft'
            if (calls > 2 || request.maxTokens !== 1_200 || request.requestLimits?.maxAttempts !== 1
              || request.requestLimits.maxResponseBytes !== 65_536 || request.requestLimits.timeoutMs !== 30_000
              || request.requestLimits.omitUsageContent !== true || !request.beforeRequest || !request.onRequestUsage) throw new EvaluationError('internal')
            expected = { phase, system: request.system!, prompt }
            prompts[phase] = promptText(request.system!, prompt)
            if (testCase.excluded.some(exclusion => exclusion.locations.includes(phase === 'plan' ? 'plan_input' : 'draft_input') && prompts[phase]!.includes(exclusion.exact))) {
              boundaryViolation = true; expected = null; throw new EvaluationError('source_boundary')
            }
            try {
              const text = await api.generateText(prompt, request)
              if (containsCredential(text, credential)) { echo = true; throw new BoundedGenerationError('transport') }
              if (phase === 'plan') visiblePlan = text
              else visibleDraft = text
              return text
            } finally { expected = null }
          },
        },
      })
      let evidence: MemoryEvidence[] = [], selection = selectRequiredEvidence(testCase, evidence)
      let outcome: EvaluationOutcome = 'failed'
      let snapshot: WriterAgentSnapshot
      try {
        await controller.preview()
        if (controller.snapshot().phase === 'previewed') await controller.start({ previewId: controller.snapshot().preview!.previewId, authorizeTool: true })
        snapshot = controller.snapshot()
        if (snapshot.phase === 'awaiting_evidence') {
          evidence = snapshot.evidence
          selection = selectRequiredEvidence(testCase, evidence)
          if (testCase.excluded.some(exclusion => exclusion.locations.includes('retrieval') && evidence.some(hit => hit.quote.includes(exclusion.exact)))) boundaryViolation = true
          if (boundaryViolation) outcome = 'failed'
          else if (selection.complete) {
            await controller.approveEvidence(selection.selected.map(hit => hit.id))
            snapshot = controller.snapshot()
            outcome = snapshot.phase === 'awaiting_author' ? 'draft_ready' : 'failed'
          } else outcome = 'retrieval_insufficient'
        } else if (snapshot.error?.code === 'no_candidates') outcome = 'retrieval_insufficient'
        else if (snapshot.phase === 'needs_author_input' && snapshot.error?.code === 'needs_author_input') outcome = 'needs_author_input'
        // No assertBeforeApply and no apply lease acquisition/consumption, ever.
        const sourceAfter = sha256(JSON.stringify(source))
        const dispatch = guard.counts()
        totalDispatches += dispatch.dispatched
        integrityStop = boundaryViolation || echo || !!dispatch.failure || network.count() > 0 || sourceHash !== sourceAfter || snapshot.error?.code === 'limits'
          || records.some(record => record.responseStatus === 401 || record.responseStatus === 403 || (record.responseStatus !== null && record.responseStatus >= 300 && record.responseStatus < 400))
        const packet: PrivateCasePacket = { caseId: testCase.id, phase: snapshot.phase, status: outcome,
          draft: outcome === 'draft_ready' ? snapshot.proposal?.text ?? null : null, plan: visiblePlan,
          selectedEvidence: selection.selected, evidence, missingPremiseIds: snapshot.budget.toolReservations > 0 ? selection.missingPremiseIds : [],
          requests: records, usage: snapshot.usage, audit: snapshot.audit, sourceBeforeSha256: sourceHash, sourceAfterSha256: sourceAfter }
        privatePacket.cases.push(packet)
        const exclusionChecks = testCase.excluded.flatMap(exclusion => exclusion.locations.map(location => {
          const text = location === 'plan_input' ? prompts.plan ?? '' : location === 'retrieval' ? evidence.map(hit => hit.quote).join('\n')
            : location === 'draft_input' ? prompts.draft ?? '' : visibleDraft ?? ''
          const evaluated = location === 'plan_input' ? prompts.plan !== undefined : location === 'retrieval' ? phases.has('awaiting_evidence') || snapshot.error?.code === 'no_candidates'
            : location === 'draft_input' ? prompts.draft !== undefined : visibleDraft !== null
          return { location, evaluated, failed: evaluated && text.includes(exclusion.exact) }
        }))
        publicCases.push(publicCase({ testCase, outcome, snapshot, calls, searches, reads, records, phases, selection,
          elapsed: performance.now() - started, sourceHash, sourceAfter, fictionStorageWrites, prewarmSyncs, currentSyncs, networkDenials: network.count(), mode,
          exclusionChecks, guardFailure: boundaryViolation ? 'source_boundary' : echo ? 'credential_echo' : dispatch.failure }))
      } finally { controller.dispose(); globalThis.fetch = async () => { throw new EvaluationError('dispatch_denied') } }
    }
    privatePacket.sourceTreeAfterSha256 = await sourceTreeHash()
    const unchanged = sourceBefore === privatePacket.sourceTreeAfterSha256
    if (!unchanged) throw new EvaluationError('source_changed')
    const publicSummary = { schemaVersion: 1 as const, kind: 'writer-agent-evaluation-summary' as const, mode,
      fixtureSha256, sourceTreeSha256: sourceBefore, sourceTreeAfterSha256: privatePacket.sourceTreeAfterSha256,
      sourceUnchanged: unchanged, providerModelSha256: sha256(JSON.stringify([endpoint, model])),
      caseCount: publicCases.length, selectedCaseCount: chosen.length, executedCaseCount: publicCases.filter(row => row.outcome !== 'not_run').length, httpRequests: totalDispatches, maxOutputTokensReserved: publicCases.reduce((sum, row) => sum + row.outputTokensReserved, 0),
      quality: 'not_reviewed' as const, cases: publicCases }
    return scrubCredential({ publicSummary, privatePacket }, credential)
  } catch (error) {
    // Never propagate a provider/SDK/fixture parser message, cause or stack.
    throw new EvaluationError(error instanceof EvaluationError ? error.code : 'internal')
  } finally {
    try { clearConfig?.() } catch { /* in-memory cleanup only */ }
    storage.clear(); credential = ''; globalThis.fetch = oldFetch; network.restore()
    for (const [key, method] of Object.entries(oldConsole)) (console as unknown as Record<string, unknown>)[key] = method
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
    running = false
  }
}

interface ExclusionCheck { location: string; evaluated: boolean; failed: boolean }
function summarizeExclusions(checks: readonly ExclusionCheck[]) {
  const lane = (location: string) => ({ checked: checks.filter(row => row.location === location && row.evaluated).length,
    notEvaluated: checks.filter(row => row.location === location && !row.evaluated).length,
    violations: checks.filter(row => row.location === location && row.failed).length })
  return { configured: checks.length, checked: checks.filter(row => row.evaluated).length,
    notEvaluated: checks.filter(row => !row.evaluated).length, violations: checks.filter(row => row.failed).length,
    inputBoundaryViolations: checks.filter(row => row.failed && row.location !== 'draft_output').length,
    draftOutputViolations: checks.filter(row => row.failed && row.location === 'draft_output').length,
    byLocation: { plan_input: lane('plan_input'), retrieval: lane('retrieval'), draft_input: lane('draft_input'), draft_output: lane('draft_output') } }
}

function publicCase(input: {
  testCase: WriterAgentEvalCase; outcome: EvaluationOutcome; snapshot: WriterAgentSnapshot; calls: number; searches: number; reads: number;
  records: DispatchRecord[]; phases: Set<WriterAgentPhase>; selection: ReturnType<typeof selectRequiredEvidence>; elapsed: number;
  sourceHash: string; sourceAfter: string; fictionStorageWrites: number; prewarmSyncs: number; currentSyncs: number; networkDenials: number; mode: 'mock' | 'live';
  exclusionChecks: ExclusionCheck[]; guardFailure: string | null;
}) {
  const { testCase, snapshot, selection, outcome } = input
  const usage = snapshot.usage.map(row => ({ phase: row.phase, status: row.status, usageSource: row.usageSource,
    inputTokens: row.inputTokens, outputTokens: row.outputTokens, totalTokens: row.totalTokens }))
  const usageCorrelated = snapshot.usage.length === input.calls && new Set(snapshot.usage.map(row => row.requestId)).size === input.calls
    && snapshot.usage.every((row, index) => row.runId === snapshot.runId && row.phase === (index === 0 ? 'plan' : 'draft') && row.status !== 'reserved')
  const expectedMissing = [...testCase.expectedMock.missingPremiseIds].sort()
  return { caseId: testCase.id, outcome, phase: snapshot.phase,
    errorCategory: input.guardFailure ?? (snapshot.error && allowedErrors.has(snapshot.error.code) ? snapshot.error.code : outcome === 'retrieval_insufficient' ? 'retrieval_insufficient' : 'none'),
    networkDenials: input.networkDenials, prewarmSyncs: input.prewarmSyncs, currentSyncs: input.currentSyncs,
    modelCalls: input.calls, httpRequests: input.records.length, toolCalls: snapshot.budget.toolReservations,
    outputTokensReserved: snapshot.budget.outputTokensReserved, latencyMs: integer(input.elapsed),
    candidateCount: snapshot.budget.toolReservations > 0 ? input.selection.verified.length : null, requiredPremiseCount: testCase.requiredPremises.length,
    retrievedRequiredPremiseCount: snapshot.budget.toolReservations > 0 ? selection.covered : null, selectedRequiredPremiseCount: snapshot.budget.toolReservations > 0 ? selection.complete ? testCase.requiredPremises.length : 0 : null,
    verifiedSelectionCount: selection.selected.length, missingPremiseCount: snapshot.budget.toolReservations > 0 ? selection.missingPremiseIds.length : null,
    exclusions: summarizeExclusions(input.exclusionChecks),
    checks: { completeRequiredCoverageBeforeDraft: !input.phases.has('drafting') || selection.complete,
      noApply: !snapshot.audit.some(row => row.kind === 'apply_consumed'), noPersistence: input.fictionStorageWrites === 0,
      noSourceMutation: input.sourceHash === input.sourceAfter,
      limits: input.calls <= 2 && input.searches <= 1 && snapshot.budget.toolReservations <= 1 && snapshot.budget.outputTokensReserved <= 2_400 && input.records.length <= 2,
      offlineBoundary: input.mode === 'mock' ? input.networkDenials === 0 : null, inputBoundary: !input.exclusionChecks.some(row => row.failed && row.location !== 'draft_output'),
      staleIndexRebuilt: !testCase.staleChapters?.length || snapshot.budget.toolReservations === 0 ? null : input.prewarmSyncs === 1 && input.currentSyncs === 1,
      usageCorrelated, productionRetrieval: snapshot.budget.toolReservations === 0 ? null : input.searches === 1 && input.reads > 0,
      mockExpectation: input.mode === 'mock' ? outcome === testCase.expectedMock.outcome && JSON.stringify([...selection.missingPremiseIds].sort()) === JSON.stringify(expectedMissing) : null },
    usage, quality: 'not_reviewed' as const }
}

function notRunCase(testCase: WriterAgentEvalCase, reason: 'not_selected' | 'integrity_stop') {
  return { caseId: testCase.id, outcome: 'not_run' as const, phase: 'not_run' as const, errorCategory: reason,
    networkDenials: 0, prewarmSyncs: 0, currentSyncs: 0, modelCalls: 0, httpRequests: 0, toolCalls: 0,
    outputTokensReserved: 0, latencyMs: 0, candidateCount: 0, requiredPremiseCount: testCase.requiredPremises.length,
    retrievedRequiredPremiseCount: null, selectedRequiredPremiseCount: null, verifiedSelectionCount: 0, missingPremiseCount: null,
    exclusions: summarizeExclusions(testCase.excluded.flatMap(exclusion => exclusion.locations.map(location => ({ location, evaluated: false, failed: false })))),
    checks: { completeRequiredCoverageBeforeDraft: null, noApply: true, noPersistence: true, noSourceMutation: true,
      limits: true, offlineBoundary: true, inputBoundary: true, staleIndexRebuilt: null, usageCorrelated: null, productionRetrieval: null, mockExpectation: null },
    usage: [], quality: 'not_reviewed' as const }
}

export function evaluationFailed(summary: Awaited<ReturnType<typeof runWriterAgentEvaluation>>['publicSummary']): boolean {
  return !summary.sourceUnchanged || summary.cases.some(row => row.outcome === 'failed' || row.exclusions.inputBoundaryViolations > 0
    || Object.values(row.checks).some(value => value === false))
}

/** Private packets are opt-in, outside the checkout, new files only, mode 0600.
 * No user-specific source, credentials, raw request envelopes or hidden reasoning. */
export async function writePrivatePacket(path: string, packet: WriterAgentPrivatePacket) {
  const parent = await realpath(dirname(resolve(path)))
  const checkout = await realpath(root)
  const relativeParent = relative(checkout, parent)
  if (!(relativeParent === '..' || relativeParent.startsWith('../') || isAbsolute(relativeParent))) throw new EvaluationError('packet_destination')
  const parentInfo = await stat(parent)
  if (!parentInfo.isDirectory()) throw new EvaluationError('packet_destination')
  const handle = await open(join(parent, resolve(path).split('/').at(-1)!), 'wx', 0o600)
  try { await handle.writeFile(`${JSON.stringify(packet, null, 2)}\n`); await handle.sync() } finally { await handle.close() }
}
