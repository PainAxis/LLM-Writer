import type { ApiConfig, GenerateOptions, GenerationRequestUsage } from '../types/api'
import type { MemoryChapterInput, MemoryProjectInput } from '../types/memory'
import type {
  WriterAgentApplyLease, WriterAgentAuditEvent, WriterAgentController, WriterAgentErrorCode,
  WriterAgentMemoryClient, WriterAgentModelPhase, WriterAgentOptions, WriterAgentOwner,
  WriterAgentPhase, WriterAgentPreview, WriterAgentSnapshot, WriterAgentToolReceipt, WriterAgentUsage,
} from '../types/writerAgent'
import { MemoryClient } from './memory/client'
import { readMemoryNovel } from './memory/labData'
import { chapterRevision } from './memory/revision'
import { prepareWriterMemoryContext, type PreparedWriterMemoryContext, type WriterMemoryClient } from './memory/writerContext'
import { stripWriterHtml } from '../utils/writerContent'
import { BoundedGenerationError } from './aiRequestLimits'
import {
  WRITER_AGENT_LIMITS as LIMIT, WRITER_AGENT_TOOL, WriterAgentError, assertWriterAgentReceipt, assertWriterAgentConfig,
  parseWriterAgentPlan, validateWriterAgentToolInput, validateWriterAgentDraft,
  writerAgentTail, writerAgentPlanPrompt, writerAgentDraftPrompt,
} from './writerAgentProtocol'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const terminalPhases = new Set<WriterAgentPhase>(['cancelled', 'expired', 'stale', 'failed', 'needs_author_input'])
const activePhases = new Set<WriterAgentPhase>(['previewing', 'planning', 'executing_retrieval_tool', 'selecting_evidence', 'drafting'])
const ownerSignature = (owner: WriterAgentOwner) => JSON.stringify([
  owner.ownershipKey, owner.projectId, owner.targetChapterId, owner.throughChapterId, owner.editorHtml, owner.brief, owner.ready,
])

/** Compare all fields (including credentials/custom headers) privately and exactly.
 * This identity is neither hashed into audit nor exposed, persisted or logged. */
function configIdentity(config: ApiConfig): string {
  const headers = Object.entries(config.customHeaders ?? {}).sort(([left], [right]) => left.localeCompare(right))
  return JSON.stringify({ ...config, customHeaders: headers })
}

interface AgentRun {
  id: string
  owner: WriterAgentOwner
  ownerSignature: string
  config?: string
  controller: AbortController
  started: number
  absoluteDeadline: number
  activeStarted: number | null
  activeUsed: number
  activeTimer?: ReturnType<typeof setTimeout>
  expiryTimer?: ReturnType<typeof setTimeout>
  deadlines: Set<{ at: number; code: WriterAgentErrorCode }>
  state: WriterAgentSnapshot
  sourceSignature?: string
  expectedTarget?: MemoryChapterInput
  preview?: WriterAgentPreview
  client?: WriterAgentMemoryClient
  prepared?: PreparedWriterMemoryContext
  selected?: PreparedWriterMemoryContext
  receipt?: WriterAgentToolReceipt
  proposal?: string
  applyChecking: boolean
  consumed: boolean
  failure?: WriterAgentError
}

function initialSnapshot(): WriterAgentSnapshot {
  return { runId: null, phase: 'idle', preview: null, evidence: [], receipt: null, proposal: null,
    usage: [], audit: [], budget: { modelReservations: 0, outputTokensReserved: 0, toolReservations: 0, activeMs: 0, expiresAt: null }, error: null }
}

/** Finite host-controlled JSON plan → one real private retrieval → author selection
 * → one draft. No history, persistence, global extension registry, retries or SDK tool loop. */
export function createWriterAgent(options: WriterAgentOptions): WriterAgentController {
  const now = options.ports?.now ?? (() => performance.now())
  const wallNow = options.ports?.wallNow ?? (() => Date.now())
  const readProjectPort = options.ports?.readProject ?? readMemoryNovel
  const makeClient = options.ports?.createMemoryClient ?? (() => new MemoryClient())
  let getConfig = options.ports?.getConfig
  let current: AgentRun | undefined
  let disposed = false
  let sequence = 0

  const activeUsed = (run: AgentRun) => run.activeUsed + (run.activeStarted === null ? 0 : Math.max(0, now() - run.activeStarted))
  const snapshot = (): WriterAgentSnapshot => {
    if (!current) return initialSnapshot()
    return copy({ ...current.state, budget: { ...current.state.budget, activeMs: Math.ceil(activeUsed(current)) } })
  }
  const publish = () => { try { options.onChange?.(snapshot()) } catch { /* UI observers do not acquire execution authority. */ } }
  const audit = (run: AgentRun, event: Omit<WriterAgentAuditEvent, 'sequence' | 'elapsedMs'>, terminal = false) => {
    // Always retain one slot for a terminal event before authorizing more work.
    if (run.state.audit.length >= LIMIT.auditEvents - (terminal ? 0 : 1)) throw new WriterAgentError('limits')
    run.state.audit.push({ sequence: run.state.audit.length + 1, elapsedMs: Math.max(0, Math.floor(now() - run.started)), ...event })
  }
  const disposeClient = (run: AgentRun) => {
    try { run.client?.invalidateSource() } catch { /* No external errors or source contents. */ }
    try { run.client?.dispose() } catch { /* Revocation remains final even for a broken worker. */ }
  }
  const stopTimers = (run: AgentRun) => {
    clearTimeout(run.activeTimer); clearTimeout(run.expiryTimer)
    if (run.activeStarted !== null) { run.activeUsed = activeUsed(run); run.activeStarted = null }
  }
  const end = (run: AgentRun, code: WriterAgentErrorCode): WriterAgentError => {
    if (run.failure) return run.failure
    const error = new WriterAgentError(code)
    if (run.consumed) return error
    run.failure = error
    stopTimers(run)
    run.controller.abort(error)
    disposeClient(run)
    run.prepared = undefined; run.selected = undefined; run.proposal = undefined
    run.expectedTarget = undefined; run.sourceSignature = undefined; run.preview = undefined; run.receipt = undefined
    run.state.preview = null; run.state.evidence = []; run.state.receipt = null; run.state.proposal = null
    run.state.phase = code === 'cancelled' || code === 'expired' || code === 'stale' ? code
      : code === 'needs_author_input' || code === 'no_candidates' ? 'needs_author_input' : 'failed'
    run.state.error = { code, message: error.message }
    if (run.state.audit.length < LIMIT.auditEvents) audit(run, { kind: 'terminal', code }, true)
    if (current === run) publish()
    return error
  }
  const assertLive = (run: AgentRun) => {
    if (run.failure) throw run.failure
    if (disposed || current !== run || run.controller.signal.aborted || run.consumed) throw new WriterAgentError('cancelled')
    if (now() >= run.absoluteDeadline) throw end(run, 'expired')
    if (activeUsed(run) >= LIMIT.activeMs) throw end(run, 'active_deadline')
    for (const deadline of run.deadlines) if (now() >= deadline.at) throw end(run, deadline.code)
    const owner = options.getOwner()
    if (!owner || !owner.ready || ownerSignature(owner) !== run.ownerSignature
      || owner.targetChapterId !== owner.throughChapterId) throw end(run, 'stale')
    if (run.config !== undefined && (!getConfig || configIdentity(getConfig()) !== run.config)) throw end(run, 'stale')
  }
  const setPhase = (run: AgentRun, phase: WriterAgentPhase) => {
    assertLive(run)
    const wasActive = run.activeStarted !== null
    const isActive = activePhases.has(phase)
    if (wasActive && !isActive) {
      run.activeUsed = activeUsed(run); run.activeStarted = null; clearTimeout(run.activeTimer)
    } else if (!wasActive && isActive) {
      run.activeStarted = now()
      run.activeTimer = setTimeout(() => { end(run, 'active_deadline') }, Math.max(0, LIMIT.activeMs - run.activeUsed))
    }
    run.state.phase = phase
    publish()
    assertLive(run)
  }
  /** Races only for timely UI settlement. The operation's internal ports also
   * check ownership before AND after awaits, so an ignored abort cannot continue. */
  const bounded = async <T>(run: AgentRun, timeout: number, operation: () => Promise<T>): Promise<T> => {
    assertLive(run)
    const deadline = { at: now() + timeout, code: (timeout === LIMIT.modelMs ? 'model_deadline'
      : timeout === LIMIT.preparationMs ? 'retrieval_deadline' : 'source_guard_deadline') as WriterAgentErrorCode }
    run.deadlines.add(deadline)
    const timer = setTimeout(() => { end(run, deadline.code) }, timeout)
    let onAbort!: () => void
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(run.failure ?? new WriterAgentError('cancelled'))
      run.controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const result = await Promise.race([Promise.resolve().then(() => { assertLive(run); return operation() }), aborted])
      assertLive(run)
      return result
    } finally {
      clearTimeout(timer)
      run.deadlines.delete(deadline)
      run.controller.signal.removeEventListener('abort', onAbort)
    }
  }
  const handleFailure = (run: AgentRun, error: unknown) => {
    if (run.consumed || run.failure || current !== run) return
    if (error instanceof WriterAgentError) { end(run, error.code); return }
    if (error instanceof BoundedGenerationError) {
      const code = error.code === 'response_too_large' || error.code === 'request_limit' || error.code === 'invalid_limits' ? 'limits'
        : error.code === 'redirect' ? 'transport' : error.code
      end(run, code); return
    }
    end(run, 'failed')
  }
  const ensureConfig = async (run: AgentRun) => {
    if (!getConfig) {
      const { useApiConfig } = await bounded(run, LIMIT.guardMs, () => import('./apiConfig'))
      assertLive(run)
      getConfig = () => useApiConfig().activeConfig.value
    }
    assertLive(run)
    const config = getConfig()
    if (!config.apiKey?.trim() || !config.selectedModel?.trim()) throw new WriterAgentError('settings')
    assertWriterAgentConfig(config)
    run.config = configIdentity(config)
    return { provider: config.provider, model: config.selectedModel }
  }
  /** Pins the exact narrative prefix before touching/reading the target tail. */
  const disclosed = (project: MemoryProjectInput, run: AgentRun): MemoryProjectInput => {
    assertLive(run)
    if (run.owner.targetChapterId !== run.owner.throughChapterId || project.id !== run.owner.projectId
      || !Array.isArray(project.chapters)) throw new WriterAgentError('stale')
    const ids = project.chapters.map(chapter => chapter.id)
    const index = ids.indexOf(run.owner.targetChapterId)
    if (index < 0 || new Set(ids).size !== ids.length) throw new WriterAgentError('stale')
    if (index + 1 > LIMIT.chapters) throw new WriterAgentError('limits')
    const chapters = project.chapters.slice(0, index + 1)
    let chars = 0
    for (const chapter of chapters) {
      if (!chapter || typeof chapter.id !== 'string' || typeof chapter.title !== 'string' || typeof chapter.text !== 'string') throw new WriterAgentError('stale')
      chars += chapter.text.length
      if (chars > LIMIT.sourceChars) throw new WriterAgentError('limits')
    }
    const prefix = new Set(chapters.map(chapter => chapter.id))
    return { id: project.id, title: project.title, chapters,
      clues: (project.clues ?? []).filter(clue => prefix.has(clue.chapterId)) }
  }
  const readProject = async (run: AgentRun, projectId: string): Promise<MemoryProjectInput> => {
    assertLive(run)
    if (projectId !== run.owner.projectId) throw new WriterAgentError('stale')
    const project = await bounded(run, LIMIT.guardMs, () => {
      assertLive(run)
      return readProjectPort(projectId)
    })
    assertLive(run)
    const prefix = disclosed(project, run)
    if (run.sourceSignature !== undefined && JSON.stringify(prefix) !== run.sourceSignature) throw end(run, 'stale')
    return project
  }
  const assertSource = async (run: AgentRun) => {
    assertLive(run)
    await readProject(run, run.owner.projectId)
    assertLive(run)
  }
  const assertSelected = async (run: AgentRun) => {
    assertLive(run)
    if (!run.selected || !run.receipt || run.receipt.status !== 'ready') throw new WriterAgentError('stale')
    await bounded(run, LIMIT.guardMs, async () => {
      assertLive(run)
      await run.selected!.assertFresh()
      assertLive(run)
    })
    assertLive(run)
  }
  const digest = async (run: AgentRun, text: string): Promise<string> => {
    assertLive(run)
    const result = await bounded(run, LIMIT.guardMs, () => chapterRevision({ title: 'writer-agent:v1', text }))
    assertLive(run)
    return result
  }
  const generate = async (run: AgentRun, phase: WriterAgentModelPhase, input: { system: string; prompt: string }): Promise<string> => {
    assertLive(run)
    if (run.state.budget.modelReservations >= LIMIT.modelCalls
      || run.state.budget.outputTokensReserved + LIMIT.outputTokensPerCall > LIMIT.outputTokensTotal) throw new WriterAgentError('limits')
    // Consume before *any* awaited source guard; a failed guard never refunds it.
    run.state.budget.modelReservations++
    run.state.budget.outputTokensReserved += LIMIT.outputTokensPerCall
    const requestId = `${run.id}:${phase}`
    const row: WriterAgentUsage = { runId: run.id, requestId, phase, status: 'reserved', usageSource: 'unknown', inputTokens: null, outputTokens: null, totalTokens: null }
    run.state.usage.push(row)
    audit(run, { kind: 'model_reserved', phase, requestId })
    publish(); assertLive(run)
    let usageSeen = false
    const number = (value: number | undefined) => Number.isSafeInteger(value) && value! >= 0 ? value! : null
    const onRequestUsage = (event: GenerationRequestUsage) => {
      // Late usage belongs to this row only. Never publish into a newer run.
      if (usageSeen) return
      usageSeen = true
      row.status = event.status
      row.usageSource = event.usageSource
      if (event.usageSource === 'reported') {
        row.inputTokens = number(event.inputTokens); row.outputTokens = number(event.outputTokens); row.totalTokens = number(event.totalTokens)
      }
      if (current === run) publish()
    }
    try {
      const text = await bounded(run, LIMIT.modelMs, async () => {
        const request: GenerateOptions = {
          system: input.system, maxTokens: LIMIT.outputTokensPerCall,
          signal: run.controller.signal, type: `writer-agent-${phase}`, onRequestUsage,
          requestLimits: { maxAttempts: 1, maxResponseBytes: LIMIT.responseBytes, timeoutMs: LIMIT.modelMs, omitUsageContent: true },
          beforeRequest: async () => {
            assertLive(run)
            if (phase === 'draft') await assertSelected(run)
            else await assertSource(run)
            assertLive(run)
          },
        }
        // The genuine bounded API owns the actual HTTP boundary; no raw fetch.
        assertLive(run)
        const generateText = options.ports?.generateText
        if (generateText) return generateText(input.prompt, request)
        const api = (await import('./api')).default
        assertLive(run)
        return api.generateText(input.prompt, request)
      })
      assertLive(run)
      if (!usageSeen) row.status = 'success'
      audit(run, { kind: 'model_completed', phase, requestId })
      if (phase === 'draft') await assertSelected(run)
      else await assertSource(run)
      assertLive(run)
      return text
    } catch (error) {
      if (!usageSeen) row.status = 'failed'
      if (error instanceof BoundedGenerationError && error.code === 'timeout') throw new WriterAgentError('model_deadline')
      throw error
    }
  }

  const preview = async (): Promise<void> => {
    if (disposed) return
    if (current && (current.consumed || activePhases.has(current.state.phase) || current.applyChecking)) return
    if (current && !terminalPhases.has(current.state.phase)) end(current, 'cancelled')
    const owner = options.getOwner()
    // Do this before committed source access, config loading, or tail extraction.
    const valid = owner && owner.targetChapterId && owner.projectId && owner.targetChapterId === owner.throughChapterId
      && typeof owner.brief === 'string' && !!owner.brief.trim() && owner.brief.length <= LIMIT.briefChars
    const started = now()
    const run: AgentRun = {
      id: `writer-agent-${globalThis.crypto.randomUUID()}-${++sequence}`, owner: copy(owner ?? {
        ownershipKey: '', projectId: '', targetChapterId: '', throughChapterId: '', editorHtml: '', brief: '', ready: false,
      }), ownerSignature: owner ? ownerSignature(owner) : '', controller: new AbortController(),
      started, absoluteDeadline: started + LIMIT.expiryMs, activeStarted: null, activeUsed: 0,
      deadlines: new Set(), state: initialSnapshot(), applyChecking: false, consumed: false,
    }
    run.state.runId = run.id
    run.state.budget.expiresAt = wallNow() + LIMIT.expiryMs
    current = run
    if (!valid || !owner.ready) {
      const error = new WriterAgentError(!valid ? 'invalid_input' : 'not_ready')
      run.failure = error
      run.state.error = { code: error.code, message: error.message }
      publish()
      return
    }
    run.expiryTimer = setTimeout(() => { end(run, 'expired') }, LIMIT.expiryMs)
    try {
      setPhase(run, 'previewing')
      const display = await ensureConfig(run)
      assertLive(run)
      const project = disclosed(await readProject(run, owner.projectId), run)
      assertLive(run)
      const target = project.chapters.at(-1)!
      if (stripWriterHtml(owner.editorHtml) !== target.text) throw new WriterAgentError('stale')
      run.expectedTarget = copy(target)
      run.sourceSignature = JSON.stringify(project)
      const revision = await bounded(run, LIMIT.guardMs, () => chapterRevision(target))
      assertLive(run)
      const fingerprint = await digest(run, run.sourceSignature)
      assertLive(run)
      await assertSource(run)
      assertLive(run)
      run.preview = { previewId: `${run.id}:preview`, projectId: owner.projectId, targetChapterId: owner.targetChapterId,
        throughChapterId: owner.throughChapterId, brief: owner.brief, ...display,
        tail: { ...writerAgentTail(target.text), revision }, sourceFingerprint: fingerprint }
      run.state.preview = copy(run.preview)
      audit(run, { kind: 'preview_ready', digest: fingerprint })
      setPhase(run, 'previewed')
    } catch (error) { handleFailure(run, error) }
  }

  const start = async (grant: { previewId: string; authorizeTool: true }): Promise<void> => {
    const run = current
    if (!run || run.state.phase !== 'previewed' || !run.preview || run.consumed) return
    try {
      assertLive(run)
      if (!grant || grant.authorizeTool !== true || grant.previewId !== run.preview.previewId
        || Object.keys(grant).length !== 2) return
      setPhase(run, 'planning')
      const response = await generate(run, 'plan', writerAgentPlanPrompt(run.preview))
      assertLive(run)
      const plan = parseWriterAgentPlan(response)
      if ('outcome' in plan) { end(run, 'needs_author_input'); return }
      const planDigest = await digest(run, JSON.stringify(plan))
      assertLive(run)
      audit(run, { kind: 'plan_validated', digest: planDigest, queryLength: plan.input.query.length })
      const queryDigest = await digest(run, plan.input.query)
      assertLive(run)
      // A singleton private executable, not a global Tools Library/SDK registry.
      const tool = {
        name: WRITER_AGENT_TOOL,
        execute: async (input: unknown): Promise<void> => {
          assertLive(run)
          const { query } = validateWriterAgentToolInput(input)
          if (run.state.budget.toolReservations >= LIMIT.toolCalls) throw new WriterAgentError('limits')
          run.state.budget.toolReservations++
          const callId = `${run.id}:retrieval`
          audit(run, { kind: 'tool_started', callId, digest: queryDigest, queryLength: query.length })
          setPhase(run, 'executing_retrieval_tool')
          try {
            const prepared = await bounded(run, LIMIT.preparationMs, async () => {
              await assertSource(run)
              assertLive(run)
              // MemoryClient.dispose is not terminal: this facade is the gate.
              run.client = makeClient()
              const client: WriterMemoryClient = {
                async sync(project) {
                  assertLive(run)
                  const value = await run.client!.sync(project)
                  assertLive(run)
                  return value
                },
                async search(query, remote, guard, controls) {
                  assertLive(run)
                  if (remote !== undefined) throw new WriterAgentError('invalid_input')
                  const value = await run.client!.search(query, undefined, guard, { ...controls, signal: run.controller.signal })
                  assertLive(run)
                  return value
                },
                invalidateSource() { if (!run.controller.signal.aborted && current === run) run.client?.invalidateSource() },
              }
              assertLive(run)
              const result = await prepareWriterMemoryContext({
                projectId: run.owner.projectId, query, throughChapterId: run.owner.throughChapterId,
                targetChapterId: run.owner.targetChapterId, expectedTarget: run.expectedTarget,
                includeGraph: false, remote: undefined, limit: LIMIT.candidates, maxChars: LIMIT.evidenceChars,
              }, { client, readProject: projectId => readProject(run, projectId), signal: run.controller.signal })
              assertLive(run)
              return result
            })
            assertLive(run)
            await assertSource(run)
            assertLive(run)
            const receipt: WriterAgentToolReceipt = { runId: run.id, callId, tool: WRITER_AGENT_TOOL,
              status: prepared.hits.length ? 'ready' : 'no_candidates', planDigest, queryDigest, queryLength: query.length,
              sourceFingerprint: prepared.fingerprint, candidateCount: prepared.hits.length, requiresAuthorSelection: true }
            assertWriterAgentReceipt(receipt)
            audit(run, { kind: prepared.hits.length ? 'tool_ready' : 'tool_no_candidates', callId,
              digest: receipt.sourceFingerprint, candidateCount: receipt.candidateCount })
            if (!prepared.hits.length) { end(run, 'no_candidates'); return }
            // Only this successful execution may publish evidence authority.
            run.prepared = prepared; run.receipt = receipt
            run.state.receipt = copy(receipt); run.state.evidence = copy(prepared.hits)
            setPhase(run, 'awaiting_evidence')
          } catch (error) {
            if (!run.failure && current === run) audit(run, { kind: 'tool_failed', callId })
            throw error
          }
        },
      }
      if (tool.name !== plan.tool) throw new WriterAgentError('protocol')
      await tool.execute(plan.input)
    } catch (error) { handleFailure(run, error) }
  }

  const approveEvidence = async (hitIds: readonly string[]): Promise<void> => {
    const run = current
    if (!run || run.state.phase !== 'awaiting_evidence' || !run.prepared || !run.receipt || run.consumed) return
    try {
      assertLive(run)
      // Invalid UI selections acquire no capability and leave the verified preview
      // available. The real adapter repeats validation against its private originals.
      if (!Array.isArray(hitIds) || !hitIds.length || hitIds.length > LIMIT.candidates
        || hitIds.some(id => typeof id !== 'string' || !run.prepared!.hits.some(hit => hit.id === id))
        || new Set(hitIds).size !== hitIds.length) return
      const ids = [...hitIds]
      setPhase(run, 'selecting_evidence')
      const selected = await bounded(run, LIMIT.guardMs, async () => {
        assertLive(run)
        const result = await run.prepared!.selectEvidence({ hitIds: ids, relationIds: [] })
        assertLive(run)
        return result
      })
      assertLive(run)
      if (!selected.hits.length || selected.relations.length || selected.prompt.length > LIMIT.evidenceChars) throw new WriterAgentError('invalid_input')
      run.selected = selected
      await assertSelected(run)
      assertLive(run)
      audit(run, { kind: 'evidence_approved', digest: selected.fingerprint, candidateCount: selected.hits.length })
      setPhase(run, 'drafting')
      const text = validateWriterAgentDraft(await generate(run, 'draft', writerAgentDraftPrompt(run.preview!, selected.prompt)))
      assertLive(run)
      // A final fresh committed read gates publication, not just transport entry.
      await assertSelected(run)
      assertLive(run)
      run.proposal = text
      run.state.proposal = { text, selectionFingerprint: selected.fingerprint }
      audit(run, { kind: 'proposal_ready', digest: selected.fingerprint })
      setPhase(run, 'awaiting_author')
    } catch (error) { handleFailure(run, error) }
  }

  const assertBeforeApply = async (): Promise<WriterAgentApplyLease> => {
    const run = current
    if (!run || run.state.phase !== 'awaiting_author' || !run.proposal || run.consumed || run.applyChecking) throw new WriterAgentError('stale')
    run.applyChecking = true
    // Guard time counts toward active work even while the displayed phase remains review.
    run.activeStarted = now()
    run.activeTimer = setTimeout(() => { end(run, 'active_deadline') }, Math.max(0, LIMIT.activeMs - run.activeUsed))
    try {
      assertLive(run)
      await assertSelected(run)
      assertLive(run)
      let used = false
      return Object.freeze({ consume(beforeConsume?: (text: string) => boolean): string {
        if (used || run.consumed || run.state.phase !== 'awaiting_author') throw new WriterAgentError('stale')
        assertLive(run)
        // Consume synchronously before content watchers can cancel the run.
        const text = run.proposal!
        if (beforeConsume && beforeConsume(text) !== true) throw new WriterAgentError('stale')
        // Validation cannot create authority or consume twice through a callback.
        if (used || run.consumed || run.state.phase !== 'awaiting_author') throw new WriterAgentError('stale')
        assertLive(run)
        audit(run, { kind: 'apply_consumed' })
        used = true; run.consumed = true
        stopTimers(run)
        run.controller.abort()
        disposeClient(run)
        run.selected = undefined; run.prepared = undefined
        return text
      } })
    } catch (error) { handleFailure(run, error); throw run.failure ?? new WriterAgentError('stale') }
    finally {
      run.applyChecking = false
      if (run.activeStarted !== null) { run.activeUsed = activeUsed(run); run.activeStarted = null }
      clearTimeout(run.activeTimer)
    }
  }
  const cancel = (reason: 'cancelled' | 'stale' = 'cancelled'): boolean => {
    if (current?.consumed) return false
    if (current && !terminalPhases.has(current.state.phase)) end(current, reason)
    return true
  }
  return { snapshot, preview, start, approveEvidence, assertBeforeApply, cancel,
    dispose() { cancel(); disposed = true } }
}
