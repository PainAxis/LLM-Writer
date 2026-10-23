/** Finite Writer runtime acceptance. Real MemoryIndex + prepareWriterMemoryContext;
 * synthetic model replies only, never evidence of model quality or real HTTP usage. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { setImmediate as turn } from 'node:timers/promises'
import type { ApiConfig, GenerateOptions, GenerationRequestUsage } from '../src/types/api'
import type { MemoryProjectInput, MemorySearchResult } from '../src/types/memory'
import type { WriterAgentController, WriterAgentOwner, WriterAgentSnapshot } from '../src/types/writerAgent'

// Only synthetic in-process storage is available to imported configuration modules.
let writes = 0
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { writes++; storage.set(key, value) },
  removeItem: (key: string) => { writes++; storage.delete(key) },
  clear: () => { writes++; storage.clear() }, key: (index: number) => [...storage.keys()][index] ?? null,
  get length() { return storage.size },
} })
const originalFetch = globalThis.fetch
let networkCalls = 0
globalThis.fetch = async () => { networkCalls++; throw new Error('No network is allowed in the Writer Agent runtime smoke') }
const { createWriterAgent } = await import('../src/services/writerAgent')
const {
  parseWriterAgentPlan, validateWriterAgentToolInput, validateWriterAgentDraft, writerAgentTail,
  assertWriterAgentInput, assertWriterAgentReceipt, writerAgentDraftPrompt, WRITER_AGENT_LIMITS: LIMIT, WriterAgentError,
} = await import('../src/services/writerAgentProtocol')
const { MemoryIndex } = await import('../src/services/memory/engine')
const { chapterRevision } = await import('../src/services/memory/revision')
const { BoundedGenerationError } = await import('../src/services/aiRequestLimits')
const fixtureBytes = await readFile(new URL('./fixtures/writer-agent-v1.json', import.meta.url))
const fixtureHash = createHash('sha256').update(fixtureBytes).digest('hex')
const frozenHash = (await readFile(new URL('./fixtures/writer-agent-v1.sha256', import.meta.url), 'utf8')).split(/\s/)[0]!
assert.equal(fixtureHash, frozenHash)
const matrix = JSON.parse(fixtureBytes.toString('utf8'))
const gold = matrix.fixtures
assert.equal(matrix.denominator.runtimeGroups, 18)
assert.equal(matrix.denominator.browserGroups, 18)
const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const safeHtml = (text: string) => `<p>${escapeHtml(text)}</p>`
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
async function until(test: () => boolean) {
  for (let tries = 0; tries < 400 && !test(); tries++) await turn()
  assert.ok(test(), 'Expected controlled runtime boundary was not reached')
}
const active: WriterAgentController[] = []
const coverage = new Set<string>()
let variants = 0
async function scenario(id: string, run: () => Promise<void> | void) {
  const before = active.length
  try { await run(); coverage.add(id); variants++ }
  finally { for (const item of active.splice(before)) item.dispose() }
}

function harness() {
  const project: MemoryProjectInput = {
    id: `novel:${gold.novelA.id}`, title: gold.novelA.title, clues: [],
    chapters: gold.novelA.chapters.map(({ id, title, text }: { id: string; title: string; text: string }) => ({ id, title, text })),
  }
  const target = project.chapters.find(row => row.id === gold.novelA.targetChapterId)!
  const owner: WriterAgentOwner = { ownershipKey: 1, projectId: project.id, targetChapterId: target.id,
    throughChapterId: target.id, editorHtml: safeHtml(target.text), brief: gold.authorBrief, ready: true }
  const config: ApiConfig = { provider: 'custom', selectedModel: 'fixture-model', apiKey: 'synthetic-private-key',
    baseURL: 'https://example.invalid/v1', maxTokens: 16_384, unlimitedTokens: false, temperature: 0.7,
    customHeaders: { 'x-fixture': 'synthetic-private-header' }, thinkingMode: 'default' }
  const count = { reads: 0, clients: 0, sync: 0, search: 0, dispose: 0, invalidate: 0,
    model: 0, guard: 0, dispatch: 0, ready: 0 }
  const requests: Array<{ prompt: string; options: GenerateOptions }> = []
  const indexed: MemoryProjectInput[] = []
  const snapshots: WriterAgentSnapshot[] = []
  const hooks: {
    read?: (number: number, captured: MemoryProjectInput) => Promise<void> | void
    sync?: () => Promise<void> | void
    afterSync?: () => Promise<void> | void
    search?: (result: MemorySearchResult) => Promise<MemorySearchResult> | MemorySearchResult
    beforeGuard?: (phase: 'plan' | 'draft') => Promise<void> | void
    afterGuard?: (phase: 'plan' | 'draft') => Promise<void> | void
    output?: (phase: 'plan' | 'draft') => Promise<string> | string
    snapshot?: (snapshot: WriterAgentSnapshot) => void
    usage?: (phase: 'plan' | 'draft', status: 'success' | 'failed') => GenerationRequestUsage | undefined
  } = {}
  let time = 0
  const controller = createWriterAgent({
    getOwner: () => owner,
    onChange(state) {
      snapshots.push(state)
      if (state.phase === 'awaiting_author') count.ready++
      hooks.snapshot?.(state)
    },
    ports: {
      now: () => time, wallNow: () => 1_000_000 + time, getConfig: () => config,
      async readProject(id) {
        assert.equal(id, project.id)
        count.reads++
        const captured = structuredClone(project)
        await hooks.read?.(count.reads, captured)
        return captured
      },
      createMemoryClient() {
        count.clients++
        const index = new MemoryIndex()
        return {
          async sync(input) {
            count.sync++; indexed.push(structuredClone(input))
            await hooks.sync?.()
            const value = await index.sync(input)
            await hooks.afterSync?.()
            return value
          },
          async search(query, remote, beforeRemote, controls) {
            count.search++
            assert.equal(remote, undefined, 'Legacy/global remote settings must not leak into this local tool')
            assert.ok(controls?.signal, 'Retrieval and freshness share the entire run signal')
            assert.equal(query.limit, 6)
            const result = await index.search(query, remote, beforeRemote)
            return hooks.search ? hooks.search(result) : result
          },
          invalidateSource() { count.invalidate++; index.invalidateSource() },
          // Deliberately nonterminal, matching MemoryClient: calls could restart it.
          dispose() { count.dispose++; index.invalidateSource() },
        }
      },
      async generateText(prompt, options) {
        count.model++
        requests.push({ prompt, options })
        const phase = options.type === 'writer-agent-plan' ? 'plan' : 'draft'
        assert.ok(!options.extensions && !options.preparedExtensions && !options.messages)
        assert.equal(options.maxTokens, 1_200)
        assert.deepEqual(options.requestLimits, { maxAttempts: 1, maxResponseBytes: 65_536, timeoutMs: 30_000, omitUsageContent: true })
        let status: 'success' | 'failed' = 'failed'
        try {
          await hooks.beforeGuard?.(phase)
          count.guard++
          await options.beforeRequest!()
          await hooks.afterGuard?.(phase)
          if (options.signal?.aborted) throw new BoundedGenerationError('cancelled')
          count.dispatch++ // Synthetic provider-entry counter, not a live HTTP claim.
          const result = hooks.output ? await hooks.output(phase) : phase === 'plan' ? gold.validPlanText : gold.draftText
          status = 'success'
          return result
        } finally {
          const usage = hooks.usage ? hooks.usage(phase, status) : { status, usageSource: 'reported' as const,
            inputTokens: phase === 'plan' ? 111 : 333, outputTokens: phase === 'plan' ? 22 : 44, totalTokens: phase === 'plan' ? 133 : 377 }
          if (usage) options.onRequestUsage?.(usage)
        }
      },
    },
  })
  active.push(controller)
  const state = () => controller.snapshot()
  const preview = async () => { await controller.preview(); assert.equal(state().phase, 'previewed', JSON.stringify(state().error)) }
  const start = () => controller.start({ previewId: state().preview!.previewId, authorizeTool: true })
  const evidence = async () => { await preview(); await start(); assert.equal(state().phase, 'awaiting_evidence', JSON.stringify(state().error)) }
  const anchor = () => {
    const hit = state().evidence.find(row => row.chapterId === gold.anchorSelection.choose.chapterId && row.quote === gold.anchorSelection.choose.quote)
    assert.ok(hit, 'Choose an actual verified hit by original chapter and exact quote, never a hardcoded hit ID')
    return hit
  }
  const ready = async () => { await evidence(); await controller.approveEvidence([anchor().id]); assert.equal(state().phase, 'awaiting_author', JSON.stringify(state().error)) }
  return { controller, project, owner, config, count, requests, indexed, snapshots, hooks, state, preview, start, evidence, anchor, ready,
    advance: (ms: number) => { time += ms }, time: () => time }
}

try {
  for (const chapter of gold.novelA.chapters) assert.equal(await chapterRevision(chapter), chapter.expectedRevisionSha256)

  await scenario('R01.a', async () => {
    const f = harness()
    assert.equal(f.state().phase, 'idle')
    assert.deepEqual(f.count, { reads: 0, clients: 0, sync: 0, search: 0, dispose: 0, invalidate: 0, model: 0, guard: 0, dispatch: 0, ready: 0 })
    await f.preview()
    const tail = f.state().preview!.tail
    assert.equal(tail.text, gold.novelA.chapters[3].text)
    assert.deepEqual([tail.start, tail.end, tail.revision], [0, tail.text.length, gold.novelA.chapters[3].expectedRevisionSha256])
    assert.equal(f.count.model + f.count.clients, 0)
    assert.equal(f.state().budget.modelReservations + f.state().budget.toolReservations, 0)
  })
  await scenario('R01.b', async () => {
    const f = harness(); f.owner.ready = false
    await f.controller.preview()
    assert.equal(f.state().phase, 'idle'); assert.equal(f.count.reads + f.count.model, 0)
    assert.equal(f.state().preview, null)
  })
  await scenario('R02.a', async () => {
    const f = harness(); await f.preview()
    await f.controller.start({ previewId: f.state().preview!.previewId, authorizeTool: false } as never)
    await f.controller.start({ previewId: 'forged', authorizeTool: true })
    assert.equal(f.state().phase, 'previewed'); assert.equal(f.count.model + f.count.clients, 0)
  })

  for (const invalid of [...gold.invalidPlans,
    { name: 'query201', text: JSON.stringify({ version: 1, tool: 'writer_retrieve_disclosed_context', input: { query: '铃'.repeat(201) } }) },
    { name: 'plan1201', text: '铃'.repeat(1201) },
    { name: 'two_objects', text: `${gold.validPlanText}${gold.validPlanText}` },
    { name: 'both_intents', text: '{"version":1,"outcome":"needs_author_input","tool":"writer_retrieve_disclosed_context","input":{"query":"铜铃"}}' },
  ]) {
    await scenario(`R03.a:${invalid.name}`, async () => {
      assert.throws(() => parseWriterAgentPlan(invalid.text), WriterAgentError)
      const f = harness(); f.hooks.output = () => invalid.text
      await f.preview(); await f.start()
      assert.equal(f.state().phase, 'failed'); assert.equal(f.state().error?.code, 'protocol')
      assert.equal(f.count.dispatch, 1); assert.equal(f.count.clients, 0)
      assert.equal(f.state().budget.modelReservations, 1); assert.equal(f.state().budget.toolReservations, 0)
    })
  }
  assert.throws(() => validateWriterAgentToolInput({ query: '铜铃', remote: true }), WriterAgentError)
  await scenario('R03.b', async () => {
    const f = harness(); f.hooks.output = () => JSON.stringify({ version: 1, tool: 'writer_retrieve_disclosed_context', input: { query: gold.canaries.sourceInstruction } })
    await f.evidence()
    assert.ok(f.state().evidence.some(hit => hit.quote.includes(gold.canaries.sourceInstruction)))
    assert.equal(f.count.dispatch, 1); assert.equal(f.count.sync, 1); assert.equal(f.count.search, 1)
    assert.ok(!JSON.stringify(f.state().audit).includes(gold.canaries.sourceInstruction))
  })

  for (const cutoff of [gold.novelA.chapters[1].id, gold.novelA.chapters[4].id, '']) {
    await scenario(`R04.a:${cutoff || 'missing'}`, async () => {
      const f = harness(); f.owner.throughChapterId = cutoff
      await f.controller.preview(); await f.controller.start({ previewId: 'fake', authorizeTool: true })
      assert.equal(f.count.reads + f.count.model + f.count.clients, 0); assert.equal(f.state().preview, null)
    })
  }
  await scenario('R04.a:deleted', async () => {
    const f = harness(); f.project.chapters = f.project.chapters.filter(chapter => chapter.id !== f.owner.targetChapterId)
    await f.controller.preview(); assert.equal(f.count.model + f.count.clients, 0); assert.equal(f.state().preview, null)
  })
  await scenario('R04.b+R05.a+R08.b+R13.a', async () => {
    const f = harness(); await f.evidence()
    assert.deepEqual(f.indexed[0]!.chapters.map(chapter => chapter.id), gold.novelA.chapters.slice(0, 4).map((chapter: { id: string }) => chapter.id))
    assert.equal(f.state().receipt!.candidateCount, f.state().evidence.length)
    assert.equal(f.state().receipt!.tool, 'writer_retrieve_disclosed_context')
    assert.deepEqual(f.state().audit.filter(row => ['plan_validated', 'tool_started', 'tool_ready'].includes(row.kind)).map(row => row.kind), ['plan_validated', 'tool_started', 'tool_ready'])
    const forged = f.state(); const selected = f.anchor()
    forged.evidence.find(row => row.id === selected.id)!.quote = 'FORGED SOURCE'
    forged.evidence[0]!.revision = 'FORGED REVISION'; forged.receipt!.sourceFingerprint = 'FORGED RECEIPT'
    await f.controller.approveEvidence([selected.id])
    assert.equal(f.state().phase, 'awaiting_author')
    assert.equal(f.state().proposal!.text, gold.draftText)
    const plan = JSON.parse(f.requests[0]!.prompt)
    const draft = JSON.parse(f.requests[1]!.prompt)
    assert.deepEqual(Object.keys(plan), ['brief', 'tail'])
    assert.deepEqual(Object.keys(draft), ['brief', 'tail', 'selectedEvidence'])
    assert.equal(plan.tail, draft.tail); assert.equal(plan.tail, f.state().preview!.tail.text)
    assert.ok(draft.selectedEvidence.includes(selected.quote)); assert.ok(!draft.selectedEvidence.includes('FORGED'))
    for (const canary of ['futureA', 'futureB', 'otherNovel', 'unselected', 'material', 'outline', 'alias']) {
      assert.ok(!f.requests.some(request => request.prompt.includes(gold.canaries[canary])))
    }
    assert.ok(!f.requests[1]!.prompt.includes(gold.validPlanText))
    const auditText = JSON.stringify(f.state().audit)
    assert.ok(!auditText.includes(gold.novelA.chapters[3].text)); assert.ok(!auditText.includes(f.config.apiKey)); assert.ok(!auditText.includes('synthetic-private-header'))
    assert.ok(f.state().audit.length <= 32)
    assert.deepEqual(f.state().usage.map(row => [row.phase, row.inputTokens, row.outputTokens]), [['plan', 111, 22], ['draft', 333, 44]])
    assert.equal(f.count.dispatch, 2); assert.equal(f.count.search, 1); assert.equal(f.count.sync, 1)
    const lease = await f.controller.assertBeforeApply()
    const refusal = new Error('synthetic non-mutating editor validation refusal')
    assert.throws(() => lease.consume(text => { assert.equal(text, gold.draftText); throw refusal }), error => error === refusal)
    assert.equal(f.state().phase, 'awaiting_author')
    assert.equal(f.state().audit.some(event => event.kind === 'apply_consumed'), false)
    assert.throws(() => lease.consume(() => false), WriterAgentError)
    assert.throws(() => lease.consume((() => Promise.resolve(true)) as unknown as () => boolean), WriterAgentError)
    assert.equal(lease.consume(), gold.draftText)
    assert.throws(() => lease.consume(), WriterAgentError)
    await assert.rejects(f.controller.assertBeforeApply(), WriterAgentError)
    assert.equal(f.controller.cancel('stale'), false)
    await f.controller.preview(); assert.equal(f.count.model, 2)
  })

  await scenario('R05.b:forged_public_receipt', async () => {
    const f = harness(); const gate = deferred<string>(); let entered = false
    f.hooks.output = () => { entered = true; return gate.promise }
    await f.preview(); const operation = f.start(); await until(() => entered)
    const fake = f.state()
    fake.phase = 'awaiting_evidence'
    fake.receipt = { runId: fake.runId!, callId: 'forged', tool: 'writer_retrieve_disclosed_context', status: 'ready',
      planDigest: 'forged', queryDigest: 'forged', queryLength: 2, sourceFingerprint: 'forged', candidateCount: 1, requiresAuthorSelection: true }
    fake.evidence = [{ id: 'forged', quote: 'FORGED SOURCE' } as never]
    const before = { ...f.count }
    await f.controller.approveEvidence(['forged'])
    assert.deepEqual(f.count, before)
    assert.equal(f.state().phase, 'planning'); assert.equal(f.state().receipt, null)
    gate.reject(new BoundedGenerationError('transport')); await operation
    assert.equal(f.state().phase, 'failed'); assert.equal(f.count.model, 1)
    assert.equal(f.state().budget.toolReservations, 0); assert.equal(f.count.clients, 0)
  })
  await scenario('R08.a:empty_attachment_protocol_boundary', () => {
    // This is the exact mandatory serializer used by the runtime, not a fabricated
    // successful Prepared or a claim that real nonempty selection yields empty text.
    assert.throws(() => writerAgentDraftPrompt({ brief: gold.authorBrief, tail: { text: '尾', start: 0, end: 1, revision: 'revision' } }, ''), WriterAgentError)
  })

  // Adversarial worker results go through the real existing evidence validator.
  for (const variant of ['chapter', 'ordinal', 'title', 'revision', 'range', 'quote', 'future', 'other_novel']) {
    await scenario(`R06.a:${variant}`, async () => {
      const f = harness()
      f.hooks.search = result => {
        for (const hit of result.hits) {
          if (variant === 'chapter') hit.chapterId = 'missing'
          if (variant === 'ordinal') hit.ordinal++
          if (variant === 'title') hit.chapterTitle = 'forged title'
          if (variant === 'revision') hit.revision = 'forged revision'
          if (variant === 'range') hit.end += 1000
          if (variant === 'quote') hit.quote = 'forged quote'
          if (variant === 'future') { hit.chapterId = gold.novelA.chapters[4].id; hit.ordinal = 5 }
          if (variant === 'other_novel') hit.projectId = `novel:${gold.novelB.id}`
        }
        return result
      }
      await f.preview(); await f.start()
      assert.equal(f.state().error?.code, 'no_candidates'); assert.equal(f.state().receipt, null)
      assert.equal(f.count.model, 1); assert.equal(f.count.search, 1)
    })
  }
  await scenario('R06.a:surrogate_split', async () => {
    const f = harness(); const chapter = f.project.chapters[1]!
    chapter.text = gold.unicodeText
    f.hooks.output = () => JSON.stringify({ version: 1, tool: 'writer_retrieve_disclosed_context', input: { query: '小鱼' } })
    f.hooks.search = async result => {
      const start = chapter.text.indexOf('🐟') + 1
      result.hits = [{ ...result.hits[0]!, id: 'split', projectId: f.project.id, chapterId: chapter.id, chapterTitle: chapter.title,
        ordinal: 2, revision: await chapterRevision(chapter), start, end: start + 1,
        quote: chapter.text.slice(start, start + 1), kind: 'passage', label: '原文', score: 1, reason: '' }]
      return result
    }
    await f.preview(); await f.start(); assert.equal(f.state().error?.code, 'no_candidates')
  })
  await scenario('R06.b:once_normalization', async () => {
    const f = harness(); const target = f.project.chapters[3]!
    target.text = gold.literalEntity.normalizedOnce; f.owner.editorHtml = gold.literalEntity.savedHtml
    await f.preview()
    assert.equal(f.state().preview!.tail.text, gold.literalEntity.normalizedOnce)
    await f.start(); assert.equal(f.state().phase, 'awaiting_evidence')
    const hit = f.state().evidence.find(row => row.chapterId === target.id)!
    assert.ok(hit); assert.equal(hit.quote, target.text)
    await f.controller.approveEvidence([hit.id]); assert.equal(f.state().phase, 'awaiting_author')
    const selected = JSON.parse(f.requests[1]!.prompt).selectedEvidence
    const source = JSON.parse(selected.split('WRITER_MEMORY_CONTEXT_JSON\n')[1]).sources[0]
    assert.equal(source.quote, gold.literalEntity.normalizedOnce)
  })
  await scenario('R06.b:plain_legacy+duplicate', async () => {
    const f = harness(); const target = f.project.chapters[3]!
    target.text = gold.literalEntity.plainLegacyText; f.owner.editorHtml = target.text
    f.hooks.search = result => { result.hits = result.hits.flatMap(hit => [hit, structuredClone(hit)]); return result }
    await f.evidence()
    assert.equal(f.state().preview!.tail.text, target.text)
    assert.equal(new Set(f.state().evidence.map(hit => hit.id)).size, f.state().evidence.length)
  })
  await scenario('R06.b:tail_surrogate', () => {
    const text = `a🐟${'铃'.repeat(1999)}`
    const tail = writerAgentTail(text)
    assert.equal(tail.start, 3); assert.equal(tail.text, '铃'.repeat(1999))
    assert.ok(tail.text.length <= 2000)
  })

  await scenario('R07.a', async () => {
    const f = harness(); f.hooks.output = () => gold.needsInputPlanText
    await f.preview(); await f.start()
    assert.equal(f.state().phase, 'needs_author_input'); assert.equal(f.count.clients, 0)
  })
  await scenario('R07.b', async () => {
    const f = harness(); f.hooks.output = () => JSON.stringify({ version: 1, tool: 'writer_retrieve_disclosed_context', input: { query: 'zzxyz_unfindable_9731' } })
    await f.preview(); await f.start(); assert.equal(f.state().error?.code, 'no_candidates')
    await f.controller.approveEvidence(['anything']); assert.equal(f.count.model, 1)
  })
  await scenario('R07.c', async () => {
    const f = harness(); f.hooks.output = () => { throw new Error('arbitrary provider body SECRET manuscript') }
    await f.preview(); await f.start()
    assert.equal(f.count.dispatch, 1); assert.equal(f.state().budget.modelReservations, 1)
    assert.equal(f.state().phase, 'failed'); assert.equal(f.count.clients, 0)
    assert.ok(!JSON.stringify(f.state()).includes('arbitrary provider body'))
  })
  for (const variant of ['empty', 'wrong_id', 'duplicate', 'relation']) {
    await scenario(`R08.a:${variant}`, async () => {
      const f = harness(); await f.evidence(); const id = f.anchor().id
      const selection = variant === 'empty' ? [] : variant === 'duplicate' ? [id, id] : [variant]
      await f.controller.approveEvidence(selection)
      assert.equal(f.count.model, 1)
      assert.equal(f.state().phase, 'awaiting_evidence')
    })
  }

  // Every async read boundary, in both cancellation orderings. Count client starts
  // too: disposing a MemoryClient alone would not stop a later sync from restarting it.
  const boundaries = [
    'first_dispatch_guard', 'tool_preparation_guard', 'adapter_project_read',
    'selection_guard', 'second_dispatch_guard', 'post_draft_guard', 'first_apply_guard',
  ] as const
  for (const boundary of boundaries) for (const resolvedFirst of [false, true]) {
    await scenario(`R11.${boundary}:${resolvedFirst ? 'resolved' : 'pending'}`, async () => {
      const f = harness(); const gate = deferred(); let entered = false; let operation!: Promise<unknown>
      if (['selection_guard', 'second_dispatch_guard', 'post_draft_guard'].includes(boundary)) await f.evidence()
      else if (boundary === 'first_apply_guard') await f.ready()
      else await f.preview()
      let phaseReads = 0
      f.hooks.read = async () => {
        const phase = f.state().phase
        const matching = boundary === 'first_dispatch_guard' ? phase === 'planning'
          : boundary === 'tool_preparation_guard' ? phase === 'executing_retrieval_tool' && f.count.clients === 0
          : boundary === 'adapter_project_read' ? phase === 'executing_retrieval_tool' && f.count.clients === 1
          : boundary === 'selection_guard' ? phase === 'selecting_evidence'
          : boundary === 'second_dispatch_guard' ? phase === 'drafting' && f.count.dispatch === 1
          : boundary === 'post_draft_guard' ? phase === 'drafting' && f.count.dispatch === 2
          : phase === 'awaiting_author'
        if (matching && phaseReads++ === 0) { entered = true; await gate.promise }
      }
      if (boundary === 'first_apply_guard') operation = f.controller.assertBeforeApply().catch(error => error)
      else if (['selection_guard', 'second_dispatch_guard', 'post_draft_guard'].includes(boundary)) operation = f.controller.approveEvidence([f.anchor().id])
      else operation = f.start()
      await until(() => entered)
      if (resolvedFirst) gate.resolve()
      f.controller.cancel()
      const atCancel = { ...f.count }
      if (!resolvedFirst) gate.resolve()
      await operation; await turn(); await turn()
      assert.equal(f.state().phase, 'cancelled')
      for (const key of ['reads', 'clients', 'sync', 'search', 'model', 'guard', 'dispatch', 'ready'] as const) assert.equal(f.count[key], atCancel[key], `${boundary}: no new ${key} after revoke`)
      assert.equal(f.state().preview, null); assert.equal(f.state().receipt, null); assert.equal(f.state().proposal, null)
      if (boundary === 'first_dispatch_guard') assert.equal(f.state().budget.modelReservations, 1)
      if (boundary === 'tool_preparation_guard') assert.equal(f.state().budget.toolReservations, 1)
    })
  }

  await scenario('R02.b:reservation_collision', async () => {
    const f = harness(); await f.preview()
    const grant = { previewId: f.state().preview!.previewId, authorizeTool: true as const }
    const gate = deferred(); let entered = false
    f.hooks.read = async () => { if (f.state().phase === 'executing_retrieval_tool') { entered = true; await gate.promise } }
    const first = f.controller.start(grant)
    await until(() => entered)
    const reads = f.count.reads
    await f.controller.start(grant); assert.equal(f.count.reads, reads)
    f.controller.cancel(); gate.resolve(); await first
    await f.controller.start(grant)
    assert.equal(f.count.model, 1); assert.equal(f.count.clients, 0); assert.equal(f.state().budget.toolReservations, 1)
  })
  await scenario('R09.b:approve_collision', async () => {
    const f = harness(); await f.evidence(); const id = f.anchor().id
    const first = f.controller.approveEvidence([id]); const second = f.controller.approveEvidence([id])
    await Promise.all([first, second]); assert.equal(f.count.model, 2); assert.equal(f.state().phase, 'awaiting_author')
  })
  for (const change of ['close', 'selection_change', 'cutoff_change', 'config_change']) {
    await scenario(`R09.a:${change}`, async () => {
      const f = harness(); await f.evidence()
      const gate = deferred(); let entered = false
      f.hooks.read = async () => { if (!entered) { entered = true; await gate.promise } }
      const approval = f.controller.approveEvidence([f.anchor().id]); await until(() => entered)
      if (change === 'close' || change === 'selection_change') f.controller.cancel('stale')
      if (change === 'cutoff_change') f.owner.throughChapterId = gold.novelA.chapters[1].id
      if (change === 'config_change') f.config.customHeaders!['x-fixture'] = 'changed header'
      gate.resolve(); await approval
      assert.equal(f.state().phase, 'stale'); assert.equal(f.count.model, 1); assert.equal(f.state().proposal, null)
    })
  }

  await scenario('R10.a:brief+input+receipt', async () => {
    const f = harness(); f.owner.brief = '铃'.repeat(1001)
    await f.controller.preview(); assert.equal(f.count.reads + f.count.model, 0)
    assert.throws(() => assertWriterAgentInput('', '\\'.repeat(8192)), WriterAgentError)
    assert.throws(() => assertWriterAgentInput('铃'.repeat(16384), ''), WriterAgentError)
    assert.throws(() => assertWriterAgentReceipt({ text: '铃'.repeat(2049) }), WriterAgentError)
    assert.equal(validateWriterAgentDraft(' \n原样正文\n '), ' \n原样正文\n ')
  })
  for (const change of [
    (config: ApiConfig) => { config.provider = 'qwen'; config.selectedModel = 'qwen3'; config.thinkingMode = 'default' },
    (config: ApiConfig) => { config.provider = 'qwen'; config.selectedModel = 'qwen3'; config.thinkingMode = 'budget'; config.thinkingBudget = 1200 },
    (config: ApiConfig) => { config.provider = 'anthropic'; config.selectedModel = 'claude-sonnet-4-5'; config.thinkingMode = 'budget'; config.thinkingBudget = 4096 },
  ]) {
    await scenario('R10.a:thinking', async () => {
      const f = harness(); change(f.config); await f.controller.preview()
      assert.equal(f.state().error?.code, 'settings'); assert.equal(f.count.model, 0); assert.equal(f.state().budget.modelReservations, 0)
    })
  }
  await scenario('R10.a:chapter_geometry', async () => {
    const f = harness()
    f.project.chapters = Array.from({ length: 2501 }, (_, i) => ({ id: `${i}`, title: `${i}`, text: '雨落在石阶上。' }))
    const target = f.project.chapters.at(-1)!
    f.owner.targetChapterId = f.owner.throughChapterId = target.id; f.owner.editorHtml = safeHtml(target.text)
    await f.controller.preview(); assert.equal(f.state().error?.code, 'limits'); assert.equal(f.count.model + f.count.clients, 0)
    // A long whole book is allowed when the disclosed prefix itself is small.
    f.owner.targetChapterId = f.owner.throughChapterId = '3'; await f.preview()
  })
  await scenario('R10.a:character_geometry', async () => {
    const f = harness(); f.project.chapters[0]!.text = '雨'.repeat(12_000_001)
    await f.controller.preview(); assert.equal(f.state().error?.code, 'limits'); assert.equal(f.count.model + f.count.clients, 0)
  })
  for (const variant of ['draft2001', 'empty', 'length', 'bytes', 'filter', 'timeout']) {
    await scenario(`R10.b:${variant}`, async () => {
      const f = harness(); await f.evidence()
      f.hooks.output = () => {
        if (variant === 'draft2001') return '铃'.repeat(2001)
        if (variant === 'empty') return ' \n '
        throw new BoundedGenerationError(variant === 'bytes' ? 'response_too_large' : variant === 'timeout' ? 'timeout' : 'output_incomplete')
      }
      await f.controller.approveEvidence([f.anchor().id])
      assert.equal(f.state().phase, 'failed'); assert.equal(f.state().proposal, null)
      assert.equal(f.count.dispatch, 2); assert.equal(f.state().budget.outputTokensReserved, 2400)
      assert.equal(f.state().usage[0]!.phase, 'plan'); assert.equal(f.state().usage[0]!.inputTokens, 111)
    })
  }
  await scenario('R10.c:retrieval_deadline', async () => {
    const f = harness(); f.hooks.afterSync = () => f.advance(90_001)
    await f.preview(); await f.start()
    assert.equal(f.state().error?.code, 'retrieval_deadline'); assert.equal(f.count.search, 0)
    assert.ok(f.count.dispose > 0); assert.equal(f.count.model, 1)
  })
  await scenario('R10:source_guard_deadline', async () => {
    const f = harness(); await f.preview()
    f.hooks.read = () => f.advance(10_001)
    await f.start(); assert.equal(f.state().error?.code, 'source_guard_deadline')
    assert.equal(f.count.dispatch, 0); assert.equal(f.state().budget.modelReservations, 1)
  })
  await scenario('R10:model_deadline', async () => {
    const f = harness(); f.hooks.output = () => { f.advance(30_001); return gold.validPlanText }
    await f.preview(); await f.start(); assert.equal(f.state().error?.code, 'model_deadline')
    assert.equal(f.count.dispatch, 1); assert.equal(f.count.clients, 0)
  })
  await scenario('R10.d:active_deadline', async () => {
    const f = harness()
    let selectionReads = 0
    let postDraftReads = 0
    const timeline: Array<[string, number]> = []
    f.hooks.read = () => {
      const phase = f.state().phase
      const cost = phase === 'selecting_evidence' && ++selectionReads <= 2 ? 4_000 : 9_000
      f.advance(cost)
      timeline.push([phase, f.state().budget.activeMs])
      if (phase === 'drafting' && f.count.dispatch === 2) postDraftReads++
    }
    f.hooks.output = phase => { f.advance(15_000); return phase === 'plan' ? gold.validPlanText : gold.draftText }
    await f.preview(); await f.start()
    assert.equal(f.state().phase, 'awaiting_evidence', JSON.stringify({ error: f.state().error, timeline }))
    const activeAtReview = f.state().budget.activeMs
    f.advance(100_000) // Author review wait is excluded, not a fresh active allowance.
    assert.equal(f.state().budget.activeMs, activeAtReview)
    await f.controller.approveEvidence([f.anchor().id])
    assert.equal(f.state().error?.code, 'active_deadline', JSON.stringify({ error: f.state().error, timeline }))
    assert.equal(f.count.dispatch, 2)
    assert.ok(postDraftReads > 0, 'The cumulative limit must be reached in a post-draft guard, not an earlier local deadline')
    assert.equal(f.state().proposal, null)
  })
  await scenario('R10.e:expiry', async () => {
    const f = harness(); await f.ready()
    const activeMs = f.state().budget.activeMs
    f.advance(LIMIT.expiryMs)
    await assert.rejects(f.controller.assertBeforeApply(), WriterAgentError)
    assert.equal(f.state().phase, 'expired'); assert.equal(f.count.model, 2)
    assert.equal(f.state().budget.activeMs, activeMs)
  })

  // Cancellation at the exact facade gap must prevent restart even though the
  // underlying client remains callable after dispose.
  for (const boundary of ['before_sync', 'after_sync', 'after_search']) {
    await scenario(`R11.facade:${boundary}`, async () => {
      const f = harness(); await f.preview()
      let adapterReads = 0
      if (boundary === 'before_sync') f.hooks.read = () => {
        if (f.state().phase === 'executing_retrieval_tool' && f.count.clients === 1 && ++adapterReads === 2) f.controller.cancel()
      }
      if (boundary === 'after_sync') f.hooks.afterSync = () => { f.controller.cancel() }
      if (boundary === 'after_search') f.hooks.search = result => { f.controller.cancel(); return result }
      await f.start()
      assert.equal(f.state().phase, 'cancelled'); assert.equal(f.state().receipt, null)
      if (boundary === 'before_sync') assert.equal(f.count.sync, 0)
      if (boundary !== 'after_search') assert.equal(f.count.search, 0)
      const after = { ...f.count }; await turn(); assert.deepEqual(f.count, after)
    })
  }

  for (const phase of ['plan', 'draft'] as const) {
    await scenario(`R12.${phase}:late_old_response`, async () => {
      const f = harness(); if (phase === 'draft') await f.evidence(); else await f.preview()
      const gate = deferred<string>(); let entered = false
      f.hooks.output = () => { entered = true; return gate.promise }
      const operation = phase === 'plan' ? f.start() : f.controller.approveEvidence([f.anchor().id])
      await until(() => entered); f.controller.cancel()
      await f.controller.preview(); const newId = f.state().runId; const newSnapshot = f.state()
      gate.resolve(phase === 'plan' ? gold.validPlanText : gold.draftText)
      await operation; await turn(); await turn()
      assert.equal(f.state().runId, newId); assert.deepEqual(f.state(), newSnapshot)
      assert.equal(f.count.model, phase === 'plan' ? 1 : 2)
    })
  }
  await scenario('R12.b:late_worker', async () => {
    const f = harness(); const gate = deferred(); let entered = false
    f.hooks.sync = () => { entered = true; return gate.promise }
    await f.preview(); const operation = f.start(); await until(() => entered)
    f.controller.cancel(); await f.controller.preview(); const newSnapshot = f.state()
    gate.resolve(); await operation; await turn(); await turn()
    assert.deepEqual(f.state(), newSnapshot); assert.equal(f.count.search, 0)
  })
  await scenario('R13.b:post_draft_source_change', async () => {
    const f = harness(); await f.evidence()
    f.hooks.output = () => { f.project.chapters[1]!.text += '异页已更改。'; return gold.draftText }
    await f.controller.approveEvidence([f.anchor().id])
    assert.equal(f.state().phase, 'stale'); assert.equal(f.state().proposal, null); assert.equal(f.count.ready, 0)
  })
  await scenario('R13:source_free_query_audit', async () => {
    const f = harness(); const tail = f.project.chapters[3]!.text
    f.hooks.output = () => JSON.stringify({ version: 1, tool: 'writer_retrieve_disclosed_context', input: { query: tail } })
    await f.evidence()
    assert.ok(!JSON.stringify(f.state().audit).includes(tail)); assert.ok(!JSON.stringify(f.state().receipt).includes(tail))
    assert.ok(f.state().audit.some(row => row.kind === 'plan_validated' && row.queryLength === tail.length && /^[a-f\d]{64}$/.test(row.digest!)))
  })
  await scenario('R13:correlated_partial_unknown_usage', async () => {
    const f = harness(); f.hooks.usage = (phase, status) => phase === 'plan'
      ? { status, usageSource: 'reported', inputTokens: 9 }
      : { status, usageSource: 'unavailable' }
    await f.evidence()
    f.hooks.output = () => { throw new BoundedGenerationError('transport') }
    await f.controller.approveEvidence([f.anchor().id])
    assert.deepEqual(f.state().usage.map(row => [row.phase, row.inputTokens, row.outputTokens, row.totalTokens, row.status]),
      [['plan', 9, null, null, 'success'], ['draft', null, null, null, 'failed']])
    assert.notEqual(f.state().usage[0]!.requestId, f.state().usage[1]!.requestId)
  })
  await scenario('R13:missing_usage_is_not_zero', async () => {
    const f = harness(); f.hooks.usage = () => undefined; await f.ready()
    assert.ok(f.state().usage.every(row => row.inputTokens === null && row.outputTokens === null && row.totalTokens === null && row.usageSource === 'unknown'))
  })
  await scenario('R13:raw_html_and_config_apply_guard', async () => {
    const f = harness(); await f.ready(); const lease = await f.controller.assertBeforeApply()
    f.owner.editorHtml = f.owner.editorHtml.replace('<p>', '<p class="author-format">')
    assert.throws(() => lease.consume(), WriterAgentError); assert.equal(f.state().phase, 'stale')
    assert.equal(f.count.model, 2)
    for (const change of ['cancel', 'owner', 'reenter']) {
      const guarded = harness(); await guarded.ready()
      const capability = await guarded.controller.assertBeforeApply()
      assert.throws(() => capability.consume(() => {
        if (change === 'cancel') guarded.controller.cancel()
        if (change === 'owner') guarded.owner.editorHtml += '<p>changed</p>'
        if (change === 'reenter') assert.equal(capability.consume(), gold.draftText)
        return true
      }), WriterAgentError)
      assert.equal(guarded.state().audit.filter(event => event.kind === 'apply_consumed').length, change === 'reenter' ? 1 : 0)
      assert.throws(() => capability.consume(), WriterAgentError)
    }
  })
  await scenario('R18.a', async () => {
    const f = harness()
    await f.controller.approveEvidence(['forged'])
    await assert.rejects(f.controller.assertBeforeApply(), WriterAgentError)
    assert.equal(f.count.reads + f.count.model + f.count.clients, 0)
    await f.evidence(); await f.controller.approveEvidence([])
    assert.equal(f.state().phase, 'awaiting_evidence'); assert.equal(f.count.model, 1)
    assert.ok(!('selectEvidence' in f.state()) && !('assertFresh' in f.state()))
  })
  await scenario('R18.b', async () => {
    const f = harness(); f.controller.cancel(); f.controller.dispose()
    const newer = harness(); assert.equal(newer.state().phase, 'idle')
    assert.equal(newer.count.reads + newer.count.model + newer.count.clients, 0)
  })

  assert.equal(networkCalls, 0, 'No live API, remote search, browser or install')
  assert.equal(writes, 0, 'The Agent runtime never persists a manuscript, history, graph, grant or audit')
  console.log(`✓ Writer Agent finite runtime: ${variants} controlled variants; real MemoryIndex and private existing evidence validator; zero external network / storage writes`)
  console.log(JSON.stringify({ fixtureSha256: fixtureHash, coveredRows: [...coverage].sort(),
    excluded: 'R14–R17 Writer mutation/save/CAS recovery and browser gates require their own suites; synthetic replies do not establish model quality or real HTTP counts.' }, null, 2))
} finally {
  active.forEach(controller => controller.dispose())
  globalThis.fetch = originalFetch
}
