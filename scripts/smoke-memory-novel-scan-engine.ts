/** Local controlled mechanics only. No real provider or network access. */
import assert from 'node:assert/strict'
import { MemoryIndex } from '../src/services/memory/engine'
import type { MemoryProjectInput } from '../src/types/memory'
import type { NovelScanGenerator, NovelScanInput, NovelScanPage } from '../src/types/memoryNovelScan'
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } })
globalThis.fetch = async () => { throw new Error('Unmocked network forbidden') }
const { prepareNovelCandidateScan, NOVEL_SCAN_HARD_ALLOCATION: HARD, parseNovelCueResponse, parseNovelCandidateResponse, NovelScanError } = await import('../src/services/memory/novelScan')
const { planNovelWindows, createNovelConnectionPlanner } = await import('../src/services/memory/novelScanPlan')
const { buildNovelPrompt } = await import('../src/services/memory/novelScanProtocol')
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const empty: NovelScanGenerator = async request => { await request.beforeRequest(); return JSON.stringify(request.phase === 'collect' ? { version: 1, cues: [], saturated: false } : { version: 1, candidates: [], saturated: false }) }
async function sample(texts = ['甲把银钥匙交给乙。'], capacity = 2048) {
  const project: MemoryProjectInput = { id: crypto.randomUUID(), title: 'controlled', clues: [], chapters: texts.map((text, index) => ({ id: `c${index}`, title: `章${index}`, text })) }
  const stats = await new MemoryIndex().sync(project), committed = copy(project)
  let graph: string | null = null, owner = true, freshHook: (() => Promise<void> | void) | undefined, ownerHook: (() => void) | undefined
  const input: NovelScanInput = { project, stats, throughChapterId: project.chapters.at(-1)!.id, graphRevision: null,
    allocation: { ...HARD }, cueCapacity: capacity,
    assertOwner() { ownerHook?.(); if (!owner) throw new Error('owner changed') },
    async assertFresh(expected) { await freshHook?.(); if (expected !== graph || JSON.stringify(committed) !== JSON.stringify(project)) throw new Error('changed') },
  }
  return { input, project, stats, committed, graph: (value: string) => { graph = value }, setFresh: (hook?: () => Promise<void> | void) => { freshHook = hook },
    setOwner: (hook?: () => void) => { ownerHook = hook }, loseOwner: () => { owner = false } }
}
async function drain(session: Awaited<ReturnType<typeof prepareNovelCandidateScan>>, page: NovelScanPage) {
  let guard = 0
  while (page.state === 'running_a' || page.state === 'running_b') { assert.ok(++guard < 100_000); page = await session.advance(page) }
  return page
}
let tests = 0
// Exact all-source geometry with escaping, whitespace and surrogate boundaries, and B fits too.
{
  const source = await sample(['', '\u0001'.repeat(12000) + '"\\\r\n'.repeat(3000) + '😀'.repeat(1500), ' \n\t'])
  const plan = await planNovelWindows(source.project, source.stats, source.input.throughChapterId)
  for (const chapter of source.project.chapters) {
    const atoms = plan.atoms.filter(atom => atom.chapterId === chapter.id)
    assert.equal(atoms.map(atom => atom.quote).join(''), chapter.text)
    assert.equal(atoms.reduce((n, atom) => n + atom.quote.length, 0), chapter.text.length)
  }
  for (const window of plan.windows) { const prompt = buildNovelPrompt('collect', window.sources.map(id => plan.atoms[id]!), window.primaryReferences); assert.ok(prompt.inputChars <= 16000 && prompt.inputBytes <= 48000) }
  for (let index = 0; index < plan.atoms.length; index += 6) if (plan.atoms.slice(index, index + 6).length) buildNovelPrompt('connect', plan.atoms.slice(index, index + 6))
  const session = await prepareNovelCandidateScan(source.input)
  let page = await drain(session, await session.startA(session.preview, empty)); assert.equal(page.state, 'ready_b')
  page = await drain(session, await session.startB(page, empty)); assert.equal(page.state, 'reviewing_complete_for_contract')
  assert.equal(page.progress.processedChars, source.project.chapters.reduce((n, chapter) => n + chapter.text.length, 0)); assert.equal(page.progress.sourceCoverage, 'complete')
  tests++
}
// Source-derived A keys and exact JSON deny invalid/extra/duplicate fields.
{
  const source = await sample(), plan = await planNovelWindows(source.project, source.stats, source.input.throughChapterId), anchors = plan.atoms
  assert.throws(() => parseNovelCueResponse('{"version":1,"version":1,"cues":[],"saturated":false}', anchors, [1]), NovelScanError)
  assert.throws(() => parseNovelCueResponse(JSON.stringify({ version: 1, cues: [{ kind: 'bridge', keys: ['未来别名'], references: [1] }], saturated: false }), anchors, [1]), NovelScanError)
  assert.throws(() => parseNovelCueResponse(JSON.stringify({ version: 1, cues: [{ kind: 'event', keys: ['甲'], references: [1] }], saturated: false }), anchors, []), NovelScanError)
  assert.throws(() => parseNovelCandidateResponse(JSON.stringify({ version: 1, candidates: [], saturated: false, authorConfirmed: true }), anchors), NovelScanError)
  tests++
}
// Synchronous double start deduplicates; pause during call is immediate, cancel settles ignored abort.
{
  const source = await sample(['甲', '乙']), session = await prepareNovelCandidateScan(source.input), pending = deferred<string>()
  let calls = 0
  const generate: NovelScanGenerator = async request => { await request.beforeRequest(); calls++; return pending.promise }
  const first = session.startA(session.preview, generate), second = session.startA(session.preview, generate)
  assert.equal(first, second)
  while (!calls) await new Promise(resolve => setTimeout(resolve, 0))
  const paused = await session.decide(session.preview, { type: 'pause' }); assert.equal(paused.state, 'running_a')
  session.cancel()
  const page = await first; assert.equal(page.state, 'cancelled'); assert.equal(page.progress.processedWindows, 0)
  pending.resolve(JSON.stringify({ version: 1, cues: [], saturated: false })); await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(session.snapshot().progress.processedWindows, 0); assert.equal(calls, 1); tests++
}
// Every return and every source guard re-reads committed data; stale results never publish.
{
  const source = await sample(), session = await prepareNovelCandidateScan(source.input)
  const page = await session.startA(session.preview, async request => { await request.beforeRequest(); source.committed.chapters[0]!.text += '改变'; return JSON.stringify({ version: 1, cues: [], saturated: false }) })
  assert.equal(page.state, 'invalidated'); assert.equal(page.reason, 'source_changed'); assert.equal(page.progress.processedWindows, 0); tests++
}
// A failed response never implicitly retries. A grant is additive, idempotent, conflict-atomic.
{
  const source = await sample(['甲', '乙']); source.input.allocation = { ...HARD, attempts: 1 }
  const session = await prepareNovelCandidateScan(source.input); let calls = 0
  let page = await session.startA(session.preview, async request => { await request.beforeRequest(); calls++; return 'not JSON' })
  assert.equal(page.state, 'paused'); assert.equal(page.reason, 'invalid_response'); assert.ok(page.failedJobId)
  assert.equal((await session.advance(page)).progress.ledger.used.attempts, 1); assert.equal(calls, 1)
  const grant = { campaignId: page.campaignId, segmentId: page.segmentId, generation: page.generation, grantId: 'grant-1', add: { attempts: 1, activeMs: 0, inputChars: 0, inputBytes: 0, outputTokens: 0, responseBytes: 0 } }
  page = await session.decide(page, { type: 'extend', grant }); await session.decide(page, { type: 'extend', grant });
  await session.decide(page, { type: 'extend', grant: { ...grant, add: { responseBytes: 0, outputTokens: 0, inputBytes: 0, inputChars: 0, activeMs: 0, attempts: 1 } } });
  assert.equal(page.progress.ledger.authorized.attempts, 2)
  assert.throws(() => session.decide(page, { type: 'extend', grant: { ...grant, add: { ...grant.add, attempts: 2 } } }), NovelScanError)
  page = await session.decide(page, { type: 'retry', failedJobId: page.failedJobId! }); assert.equal(calls, 2); assert.equal(page.progress.ledger.used.attempts, 2); session.cancel(); tests++
}
// Old endpoints + new bridge across cue-capacity segments: all three original sources appear in B.
{
  const source = await sample(['阿明持有银钥。', '银狐打开密室。', '旁人甲。', '旁人乙。', '阿明就是银狐。'], 4)
  const session = await prepareNovelCandidateScan(source.input); const sent = new Set<string>(); let bridgeSeen = false
  const generate: NovelScanGenerator = async request => {
    await request.beforeRequest(); const wire = JSON.parse(request.prompt) as { sources: Array<{ reference: number; quote: string }>; primaryReferences?: number[] }
    if (request.phase === 'collect') {
      const quote = wire.sources[0]!.quote
      const keys = quote.includes('就是') ? ['阿明', '银狐'] : [quote.includes('阿明') ? '阿明' : quote.includes('银狐') ? '银狐' : quote]
      return JSON.stringify({ version: 1, cues: [{ kind: quote.includes('就是') ? 'bridge' : 'event', keys, references: [1] }], saturated: false })
    }
    const key = wire.sources.map(item => item.quote).sort().join('|'); assert.ok(!sent.has(key), 'do not resend completed B jobs across segments'); sent.add(key)
    if (['阿明持有银钥。', '银狐打开密室。', '阿明就是银狐。'].every(quote => wire.sources.some(item => item.quote === quote))) bridgeSeen = true
    return JSON.stringify({ version: 1, candidates: [], saturated: false })
  }
  let page = await drain(session, await session.startA(session.preview, generate)); assert.equal(page.reason, 'cue_capacity')
  while (page.progress.sourceCoverage !== 'complete' || !page.progress.planningComplete) {
    if (page.state === 'paused') page = await session.decide(page, { type: 'finish-partial' })
    if (page.state === 'ready_b') page = await drain(session, await session.startB(page, generate))
    if (page.state.startsWith('reviewing')) page = await session.nextSegment(page, source.input)
    if (page.state === 'ready_a') page = await drain(session, await session.startA(page, generate))
    if (page.state === 'closed') break
  }
  assert.equal(bridgeSeen, true); assert.equal(page.progress.crossSegmentGap, false); tests++
}
// Planner includes adjacent no-key-overlap and explicit two-edge bridges without arbitrary four-way joins.
{
  const jobs = [...createNovelConnectionPlanner([
    { id: 0, kind: 'event', keys: ['A'], atoms: [0] }, { id: 1, kind: 'event', keys: ['unrelated'], atoms: [1] },
    { id: 2, kind: 'event', keys: ['B'], atoms: [2] }, { id: 3, kind: 'bridge', keys: ['A', 'B'], atoms: [3] },
  ])].filter(job => job !== null)
  assert.ok(jobs.some(job => job.route === 'adjacent' && job.atoms.join() === '0,1'))
  assert.ok(jobs.some(job => job.route === 'bridge' && job.atoms.join() === '0,2,3'))
  assert.ok(jobs.every(job => job.cues.length <= 3)); tests++
}
// More than 512 candidates continue the retained B cursor across review segments with no duplicate dispatch.
{
  const source = await sample(Array.from({ length: 270 }, (_, i) => `人物${i}持有物件${i}。`))
  const session = await prepareNovelCandidateScan(source.input), dispatched = new Set<string>()
  const generate: NovelScanGenerator = async request => {
    await request.beforeRequest()
    const wire = JSON.parse(request.prompt) as { sources: Array<{ reference: number; quote: string }> }
    if (request.phase === 'collect') return JSON.stringify({ version: 1, cues: [{ kind: 'event', keys: [wire.sources[0]!.quote], references: [1] }], saturated: false })
    const key = wire.sources.map(item => item.quote).join('|'); assert.ok(!dispatched.has(key)); dispatched.add(key)
    const quote = wire.sources[0]!.quote
    const candidate = { kind: 'relationship', source: { type: 'person', label: quote.match(/人物\d+/)![0] }, target: { type: 'object', label: quote.match(/物件\d+/)![0] }, predicate: '持有', origin: 'explicit', premises: [{ role: 'support', references: [1] }] }
    return JSON.stringify({ version: 1, candidates: [candidate, { ...candidate, predicate: '拿着' }], saturated: false })
  }
  let page = await drain(session, await session.startA(session.preview, generate)); assert.equal(page.state, 'ready_b')
  page = await drain(session, await session.startB(page, generate))
  let segments = 1, accepted = 0, previousAttempts = page.progress.ledger.used.attempts
  while (page.state !== 'reviewing_complete_for_contract') {
    assert.equal(page.reason, 'review_capacity'); assert.equal(page.progress.sourceCoverage, 'complete')
    page = await session.decide(page, { type: 'finish-partial' }); assert.equal(page.candidates!.length, 512)
    accepted += page.candidates!.length
    for (const candidate of page.candidates!) page = await session.decide(page, { type: 'ignore', candidateId: candidate.id })
    page = await session.nextSegment(page, source.input); assert.equal(page.state, 'ready_b'); assert.equal(page.progress.ledger.used.attempts, previousAttempts)
    page = await drain(session, await session.startB(page, generate)); assert.ok(page.progress.ledger.used.attempts > previousAttempts); previousAttempts = page.progress.ledger.used.attempts
    assert.ok(++segments < 10)
  }
  accepted += page.candidates!.length
  assert.equal(dispatched.size, 807); assert.equal(accepted, 1614); assert.equal(page.progress.jobsProcessed, 807)
  assert.equal(page.progress.ledger.used.attempts, 1077); assert.equal(segments, 4); tests++
}
// Source or external graph changes across segments invalidate rather than silently rebasing.
{
  const source = await sample(['甲', '乙'], 4), session = await prepareNovelCandidateScan(source.input)
  let page = await session.startA(session.preview, async request => { await request.beforeRequest(); return JSON.stringify({ version: 1, cues: [{ kind: 'event', keys: ['甲'], references: [1] }], saturated: false }) })
  page = await session.decide(page, { type: 'finish-partial' }); page = await drain(session, await session.startB(page, empty))
  source.committed.chapters[0]!.text = '改变'
  page = await session.nextSegment(page, source.input); assert.equal(page.state, 'invalidated'); assert.equal(page.reason, 'source_changed'); tests++
}
// Each exact serialized input/output reservation gate pauses BEFORE the generator, including a one-unit shortfall.
{
  const source = await sample(), plan = await planNovelWindows(source.project, source.stats, source.input.throughChapterId)
  const window = plan.windows[0]!, prompt = buildNovelPrompt('collect', window.sources.map(id => plan.atoms[id]!), window.primaryReferences)
  for (const [field, required] of Object.entries({ inputChars: prompt.inputChars, inputBytes: prompt.inputBytes, outputTokens: 1200, responseBytes: 65536 })) {
    source.input.allocation = { ...HARD, [field]: required - 1 }
    const session = await prepareNovelCandidateScan(source.input); let calls = 0
    let page = await session.startA(session.preview, async request => { calls++; return empty(request) })
    assert.equal(page.reason, 'budget', field); assert.equal(calls, 0); assert.equal(page.progress.ledger.used.attempts, 0)
    const zero = { attempts: 0, activeMs: 0, inputChars: 0, inputBytes: 0, outputTokens: 0, responseBytes: 0 }
    page = await session.decide(page, { type: 'extend', grant: { ...session.preview, grantId: 'zero', add: zero } })
    page = await session.decide(page, { type: 'continue' }); assert.equal(calls, 0); assert.equal(page.reason, 'budget')
    page = await session.decide(page, { type: 'extend', grant: { ...session.preview, grantId: 'one', add: { ...zero, [field]: 1 } } })
    page = await session.decide(page, { type: 'continue' }); assert.equal(calls, 1); assert.equal(page.state, 'ready_b'); session.cancel()
  }
  tests++
}
// Local parsing tails and zero-duration microtasks cannot dispatch beyond active authorization.
{
  const actualNow = performance.now.bind(performance); let clock = 100
  Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })
  try {
    const source = await sample(); source.input.allocation = { ...HARD, activeMs: 50 }
    const session = await prepareNovelCandidateScan(source.input), parse = JSON.parse
    const raw = JSON.stringify({ version: 1, cues: [], saturated: false })
    try {
      const page = await session.startA(session.preview, async request => {
        await request.beforeRequest()
        JSON.parse = ((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => { const parsed = parse(text, reviver); if (text === raw) clock += 50; return parsed }) as typeof JSON.parse
        return raw
      })
      assert.equal(page.reason, 'budget'); assert.equal(page.progress.processedWindows, 0); assert.equal(page.progress.ledger.used.attempts, 1)
    } finally { JSON.parse = parse; session.cancel() }
    const zero = await sample(); zero.input.allocation = { ...HARD, activeMs: 1 }
    const zeroSession = await prepareNovelCandidateScan(zero.input); let calls = 0
    zero.setOwner(() => { clock += 1 })
    const page = await zeroSession.startA(zeroSession.preview, async request => { calls++; return empty(request) })
    assert.equal(page.reason, 'budget'); assert.equal(calls, 0); zeroSession.cancel(); tests++
  } finally { Object.defineProperty(performance, 'now', { configurable: true, value: actualNow }) }
}
// Ignored guard aborts settle promptly; guard timeout is terminal, never a retryable provider-only error.
{
  const timer = globalThis.setTimeout
  try {
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => timer(fn, Math.min(delay ?? 0, 5), ...args)) as typeof setTimeout
    const source = await sample(), session = await prepareNovelCandidateScan(source.input); source.setFresh(() => new Promise(() => {}))
    const page = await session.startA(session.preview, empty); assert.equal(page.state, 'invalidated'); assert.equal(page.reason, 'guard_timeout'); assert.equal(page.progress.ledger.used.attempts, 0)
    const prepareSource = await sample(), controller = new AbortController(); prepareSource.input.signal = controller.signal; prepareSource.setFresh(() => new Promise(() => {}))
    const pending = prepareNovelCandidateScan(prepareSource.input); controller.abort(); await assert.rejects(pending, NovelScanError); tests++
  } finally { globalThis.setTimeout = timer }
}
// A provider deadline that wins DURING a late dispatch guard also revokes the session.
{
  const realNow = performance.now.bind(performance), realTimer = globalThis.setTimeout; let offset = 0, providerDeadline: (() => void) | undefined
  try {
    Object.defineProperty(performance, 'now', { configurable: true, value: () => realNow() + offset })
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if (delay === 30000) providerDeadline = () => fn(...args)
      return realTimer(fn, delay, ...args)
    }) as typeof setTimeout
    const source = await sample(), session = await prepareNovelCandidateScan(source.input)
    const page = await session.startA(session.preview, async request => {
      offset += 25000
      source.setFresh(() => { offset += 5000; assert.ok(providerDeadline); providerDeadline(); return new Promise(() => {}) })
      await request.beforeRequest(); return JSON.stringify({ version: 1, cues: [], saturated: false })
    })
    assert.equal(page.state, 'invalidated'); assert.equal(page.reason, 'guard_timeout'); tests++
  } finally { globalThis.setTimeout = realTimer; Object.defineProperty(performance, 'now', { configurable: true, value: realNow }) }
}
// Partial review followed by a new segment never silently retries an earlier failed job.
{
  const source = await sample(), session = await prepareNovelCandidateScan(source.input); let calls = 0
  let page = await session.startA(session.preview, async () => { calls++; return 'bad' })
  page = await session.decide(page, { type: 'finish-partial' }); page = await drain(session, await session.startB(page, empty))
  page = await session.nextSegment(page, source.input); assert.equal(page.state, 'paused'); assert.equal(page.reason, 'invalid_response'); assert.ok(page.failedJobId)
  assert.equal((await session.startA(page, empty)).state, 'paused'); assert.equal(calls, 1); session.cancel(); tests++
}
// Protocol/persist compatibility rejects cross-role repeated citations and blank evidence before review.
{
  const source = await sample(), plan = await planNovelWindows(source.project, source.stats, source.input.throughChapterId)
  const invalid = { version: 1, saturated: false, candidates: [{ kind: 'foreshadowing', mode: 'possible_recovery', title: '候选', explanation: '模型解释',
    premises: [{ role: 'setup', references: [1] }, { role: 'recovery', references: [1] }] }] }
  assert.throws(() => parseNovelCandidateResponse(JSON.stringify(invalid), plan.atoms), NovelScanError)
  const blank = { version: 1, saturated: false, candidates: [{ kind: 'foreshadowing', mode: 'setup_candidate', title: '候选', explanation: '模型解释', premises: [{ role: 'setup', references: [1] }] }] }
  assert.throws(() => parseNovelCandidateResponse(JSON.stringify(blank), [{ ...plan.atoms[0]!, quote: ' ' }]), NovelScanError); tests++
}
// Owner, configuration change-and-restore, stale handles, and both absolute expiry gates are terminal.
{
  const { useApiConfig } = await import('../src/services/apiConfig')
  const active = useApiConfig().apiConfig, original = copy(active.value)
  const source = await sample(), session = await prepareNovelCandidateScan(source.input)
  active.value = { ...active.value, selectedModel: `${active.value.selectedModel}-changed` }; active.value = original
  let calls = 0
  const page = await session.startA(session.preview, async request => { calls++; return empty(request) })
  assert.equal(page.state, 'invalidated'); assert.equal(page.reason, 'configuration_changed'); assert.equal(calls, 0)
  const owner = await sample(), ownerSession = await prepareNovelCandidateScan(owner.input); owner.loseOwner()
  assert.equal((await ownerSession.startA(ownerSession.preview, empty)).reason, 'owner_changed')
  const stale = await sample(), staleSession = await prepareNovelCandidateScan(stale.input)
  assert.throws(() => staleSession.decide({ ...staleSession.preview, generation: 0 }, { type: 'cancel' }), NovelScanError)
  assert.equal(staleSession.snapshot().state, 'ready_a'); staleSession.cancel()
  const originalDate = Date.now
  try {
    const ready = await sample(), readySession = await prepareNovelCandidateScan(ready.input)
    Date.now = () => readySession.preview.readyExpiresAt
    assert.equal((await readySession.startA(readySession.preview, empty)).reason, 'expired')
    Date.now = originalDate
    const expiry = await sample(), expirySession = await prepareNovelCandidateScan(expiry.input)
    let reviewed = await expirySession.startA(expirySession.preview, empty); reviewed = await expirySession.startB(reviewed, empty)
    assert.equal(reviewed.state, 'reviewing_complete_for_contract')
    Date.now = () => expirySession.preview.expiresAt
    assert.equal((await expirySession.audit(reviewed)).reason, 'expired'); tests++
  } finally { Date.now = originalDate }
}
// A no-event committed edit DURING independent hashing is caught by the second committed read.
{
  const source = await sample(), session = await prepareNovelCandidateScan(source.input)
  const digest = crypto.subtle.digest.bind(crypto.subtle); let changed = false, calls = 0
  Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args: Parameters<typeof crypto.subtle.digest>) => {
    const value = await digest(...args); if (!changed) { changed = true; source.committed.chapters[0]!.text += '并发修改' }; return value
  } })
  try {
    const page = await session.startA(session.preview, async request => { calls++; return empty(request) })
    assert.equal(page.state, 'invalidated'); assert.equal(page.reason, 'source_changed'); assert.equal(calls, 0); tests++
  } finally { Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: digest }) }
}
// New A cues revoke the previous segment's precise/complete B coverage immediately.
{
  const source = await sample(['甲', '乙', '丙'], 4), session = await prepareNovelCandidateScan(source.input)
  const cue: NovelScanGenerator = async request => { await request.beforeRequest(); const wire = JSON.parse(request.prompt); return JSON.stringify(request.phase === 'collect'
    ? { version: 1, cues: [{ kind: 'event', keys: [wire.sources[0].quote], references: [1] }], saturated: false }
    : { version: 1, candidates: [], saturated: false }) }
  let page = await session.startA(session.preview, cue); page = await session.advance(page); assert.equal(page.reason, 'cue_capacity')
  page = await session.decide(page, { type: 'finish-partial' }); page = await drain(session, await session.startB(page, cue))
  assert.equal(page.progress.planningComplete, true); assert.equal(page.progress.connectionCoverage, 'complete_for_contract')
  page = await session.nextSegment(page, source.input); page = await session.startA(page, cue)
  assert.equal(page.state, 'running_a'); assert.equal(page.progress.planningComplete, false); assert.equal(page.progress.connectionCoverage, 'incomplete')
  session.cancel(); tests++
}
// Exhausting time in the A→B transition never turns budget Continue into implicit B consent.
{
  const realNow = performance.now.bind(performance); let clock = 100
  Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })
  try {
    const source = await sample(); source.input.allocation = { ...HARD, activeMs: 50 }
    const session = await prepareNovelCandidateScan(source.input), phases: string[] = []
    const generator: NovelScanGenerator = async request => {
      phases.push(request.phase); await request.beforeRequest()
      if (request.phase === 'connect') return JSON.stringify({ version: 1, candidates: [], saturated: false })
      let reads = 0; source.setFresh(() => { if (++reads === 5) clock += 50 })
      return JSON.stringify({ version: 1, cues: [{ kind: 'event', keys: ['甲'], references: [1] }], saturated: false })
    }
    let page = await session.startA(session.preview, generator)
    assert.equal(page.state, 'paused'); assert.equal(page.phase, 'connect'); assert.equal(page.reason, 'budget'); assert.equal(page.progress.processedWindows, 1)
    page = await session.decide(page, { type: 'extend', grant: { ...session.preview, grantId: 'transition-time', add: { activeMs: 50, attempts: 0, inputChars: 0, inputBytes: 0, outputTokens: 0, responseBytes: 0 } } })
    page = await session.decide(page, { type: 'continue' }); assert.equal(page.state, 'ready_b'); assert.deepEqual(phases, ['collect'])
    page = await session.startB(page, generator); assert.deepEqual(phases, ['collect', 'connect']); session.cancel(); tests++
  } finally { Object.defineProperty(performance, 'now', { configurable: true, value: realNow }) }
}
// An idle audit may finish before an explicit Start, but cannot swallow that Start or duplicate it.
{
  const source = await sample(), session = await prepareNovelCandidateScan(source.input), read = deferred<void>()
  let entered = false, calls = 0
  source.setFresh(async () => { if (!entered) { entered = true; await read.promise } })
  const audit = session.audit(session.preview)
  while (!entered) await new Promise(resolve => setTimeout(resolve, 0))
  const start = session.startA(session.preview, async request => { calls++; return empty(request) })
  read.resolve(); await audit; const page = await start
  assert.equal(page.state, 'ready_b'); assert.equal(calls, 1); session.cancel(); tests++
}
// An in-flight guard bounded by the campaign wall expiry is terminal expired, never provider-retry.
{
  const source = await sample(), session = await prepareNovelCandidateScan(source.input), now = Date.now
  let offset = 0, shifted = false, calls = 0
  Date.now = () => now() + offset
  source.setOwner(() => { if (!shifted) { shifted = true; offset = session.preview.expiresAt - now() - 20 } })
  source.setFresh(() => new Promise<void>(() => {}))
  try {
    const page = await session.startA(session.preview, async request => { calls++; return empty(request) })
    assert.equal(page.state, 'expired'); assert.equal(page.reason, 'expired'); assert.equal(calls, 0)
  } finally { Date.now = now; session.cancel() }
  tests++
}
// Fresh next-segment input preparation is inside the scan active budget and is abortable before ownership changes.
{
  const source = await sample(), session = await prepareNovelCandidateScan(source.input)
  let page = await drain(session, await session.startA(session.preview, empty))
  page = await drain(session, await session.startB(page, empty))
  const used = page.progress.ledger.used.activeMs, now = performance.now, clock = now.call(performance)
  let time = clock
  Object.defineProperty(performance, 'now', { configurable: true, value: () => time })
  try {
    page = await session.nextSegment(page, async signal => { assert.equal(signal.aborted, false); time += 17; return source.input })
    assert.equal(page.state, 'closed'); assert.ok(page.progress.ledger.used.activeMs >= used + 17)
  } finally { Object.defineProperty(performance, 'now', { configurable: true, value: now }); session.cancel() }
  const second = await prepareNovelCandidateScan(source.input)
  let next = await drain(second, await second.startA(second.preview, empty)); next = await drain(second, await second.startB(next, empty))
  let received: AbortSignal | undefined
  const blocked = second.nextSegment(next, async signal => { received = signal; return new Promise<NovelScanInput>(() => {}) })
  while (!received) await new Promise(resolve => setTimeout(resolve, 0))
  second.cancel(); const cancelled = await blocked
  assert.equal(cancelled.state, 'cancelled'); assert.equal(received.aborted, true); assert.equal(cancelled.segmentId, next.segmentId)
  tests++
}
// Failed lazy input builders stop before any late second read; successful builder guards retain a live campaign-linked signal.
{
  const { withMemoryAbort } = await import('../src/services/memory/semanticScanUi')
  const source = await sample(['甲', '乙'], 4), now = performance.now
  let time = 100
  Object.defineProperty(performance, 'now', { configurable: true, value: () => time })
  source.input.allocation = { ...HARD, activeMs: 50 }
  let session: Awaited<ReturnType<typeof prepareNovelCandidateScan>> | undefined
  try {
    session = await prepareNovelCandidateScan(source.input)
    const generator: NovelScanGenerator = async request => {
      await request.beforeRequest()
      if (request.phase === 'connect') return JSON.stringify({ version: 1, candidates: [], saturated: false })
      const wire = JSON.parse(request.prompt) as { sources: Array<{ quote: string }> }
      return JSON.stringify({ version: 1, cues: [{ kind: 'event', keys: [wire.sources[0]!.quote], references: [1] }], saturated: false })
    }
    let page = await drain(session, await session.startA(session.preview, generator))
    assert.equal(page.reason, 'cue_capacity'); page = await session.decide(page, { type: 'finish-partial' })
    page = await drain(session, await session.startB(page)); assert.equal(page.state, 'reviewing_partial')
    const read = deferred<void>(); let firstReads = 0, secondReads = 0, failedSignal: AbortSignal | undefined
    const pending = session.nextSegment(page, async signal => {
      failedSignal = signal; firstReads++; time += 50
      await withMemoryAbort(read.promise, signal)
      if (signal.aborted) throw new Error('cancelled builder')
      secondReads++; return source.input
    })
    const paused = await pending
    assert.equal(paused.state, 'paused'); assert.equal(paused.reason, 'budget'); assert.equal(failedSignal?.aborted, true)
    assert.equal(firstReads, 1); assert.equal(secondReads, 0); assert.equal(paused.progress.ledger.used.activeMs, 50)
    read.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(secondReads, 0)
    page = await session.decide(paused, { type: 'extend', grant: { ...paused, grantId: 'builder-recovery', add: { attempts: 0, activeMs: 50, inputChars: 0, inputBytes: 0, outputTokens: 0, responseBytes: 0 } } })
    page = await session.decide(page, { type: 'finish-partial' })
    let retainedSignal: AbortSignal | undefined, freshCalls = 0
    page = await session.nextSegment(page, async signal => {
      retainedSignal = signal
      return { ...source.input, signal, assertOwner() { assert.equal(signal.aborted, false); source.input.assertOwner() },
        async assertFresh(revision) { assert.equal(signal.aborted, false); freshCalls++; await source.input.assertFresh(revision) } }
    })
    assert.equal(page.state, 'ready_a'); assert.equal(retainedSignal?.aborted, false)
    const callsBefore = freshCalls
    page = await session.startA(page); assert.equal(page.state, 'ready_b'); assert.ok(freshCalls > callsBefore); assert.equal(retainedSignal?.aborted, false)
    session.cancel(); assert.equal(retainedSignal?.aborted, true)
  } finally { session?.cancel(); Object.defineProperty(performance, 'now', { configurable: true, value: now }) }
  tests++
}
// Each committed-source guard gets a fresh operation gate, including active-budget pauses without campaign cancellation.
{
  const { withMemoryAbort } = await import('../src/services/memory/semanticScanUi')
  const source = await sample(), fresh = source.input.assertFresh, now = performance.now
  let time = 100, hold = false, secondReads = 0, operationSignal: AbortSignal | undefined
  const read = deferred<void>()
  Object.defineProperty(performance, 'now', { configurable: true, value: () => time })
  source.input.allocation = { ...HARD, activeMs: 50 }
  source.input.assertFresh = async (revision, signal) => {
    assert.ok(signal); assert.equal(signal.aborted, false)
    if (hold) { operationSignal = signal; time += 50; await withMemoryAbort(read.promise, signal); if (signal.aborted) throw new Error('aborted source guard'); secondReads++ }
    await fresh(revision)
  }
  let session: Awaited<ReturnType<typeof prepareNovelCandidateScan>> | undefined
  try {
    session = await prepareNovelCandidateScan(source.input); hold = true
    let page = await session.startA(session.preview, empty)
    assert.equal(page.state, 'paused'); assert.equal(page.reason, 'budget'); assert.equal(operationSignal?.aborted, true)
    assert.equal(page.progress.ledger.used.attempts, 0); assert.equal(page.progress.ledger.used.activeMs, 50)
    read.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(secondReads, 0)
    hold = false
    page = await session.decide(page, { type: 'extend', grant: { ...page, grantId: 'guard-recovery', add: { attempts: 0, activeMs: 50, inputChars: 0, inputBytes: 0, outputTokens: 0, responseBytes: 0 } } })
    page = await session.decide(page, { type: 'continue' }); assert.equal(page.state, 'ready_b'); assert.equal(page.progress.ledger.used.attempts, 1)
  } finally { session?.cancel(); Object.defineProperty(performance, 'now', { configurable: true, value: now }) }
  tests++
}
// Cancelling after several successful lazy segments aborts every retained child despite reverse signal listeners.
{
  const source = await sample(['甲', '乙', '丙'], 4), session = await prepareNovelCandidateScan(source.input)
  const signals: AbortSignal[] = []
  const generator: NovelScanGenerator = async request => {
    await request.beforeRequest()
    if (request.phase === 'connect') return JSON.stringify({ version: 1, candidates: [], saturated: false })
    const wire = JSON.parse(request.prompt) as { sources: Array<{ quote: string }> }
    return JSON.stringify({ version: 1, cues: [{ kind: 'event', keys: [wire.sources[0]!.quote], references: [1] }], saturated: false })
  }
  let page = session.snapshot()
  for (let segment = 0; segment < 2; segment++) {
    page = await drain(session, await session.startA(page, generator)); assert.equal(page.reason, 'cue_capacity')
    page = await session.decide(page, { type: 'finish-partial' }); page = await drain(session, await session.startB(page))
    assert.equal(page.state, 'reviewing_partial')
    page = await session.nextSegment(page, async signal => {
      signals.push(signal)
      return { ...source.input, signal, assertOwner() { assert.equal(signal.aborted, false); source.input.assertOwner() } }
    })
    assert.equal(page.state, 'ready_a'); assert.ok(signals.every(signal => !signal.aborted))
  }
  session.cancel(); assert.equal(signals.length, 2); assert.ok(signals.every(signal => signal.aborted)); tests++
}
// Every additive grant honors all hard caps and rejects invalid values atomically.
{
  const { NovelScanBudget } = await import('../src/services/memory/novelScanBudget')
  const identity = { campaignId: 'campaign', segmentId: 'segment', generation: 1 }
  const budget = new NovelScanBudget({ ...HARD })
  for (const key of ['attempts', 'activeMs', 'inputChars', 'inputBytes', 'outputTokens', 'responseBytes'] as const) {
    const add = { attempts: 0, activeMs: 0, inputChars: 0, inputBytes: 0, outputTokens: 0, responseBytes: 0 }
    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 1]) {
      assert.throws(() => budget.grant({ ...identity, grantId: `${key}-${invalid}`, add: { ...add, [key]: invalid } }, identity), NovelScanError)
      assert.deepEqual(budget.ledger.authorized, HARD)
    }
  }
  tests++
}
// At the retained provenance hard cap, never drop cues: pause, then only explicit skip records the exact source gap.
{
  const source = await sample(Array.from({ length: 2049 }, () => '甲乙丙丁'), 8192)
  const session = await prepareNovelCandidateScan(source.input); let calls = 0
  const generator: NovelScanGenerator = async request => { calls++; await request.beforeRequest(); return JSON.stringify({ version: 1,
    cues: ['甲', '乙', '丙', '丁'].map(key => ({ kind: 'event', keys: [key], references: [1] })), saturated: false }) }
  let page = await drain(session, await session.startA(session.preview, generator))
  assert.equal(page.state, 'paused'); assert.equal(page.reason, 'index_capacity'); assert.equal(page.progress.indexCueCount, 8192); assert.equal(calls, 2048)
  assert.equal(page.progress.processedWindows, 2048); assert.equal(page.progress.remainingChars, 4)
  assert.throws(() => session.decide(page, { type: 'continue' }), NovelScanError)
  page = await session.decide(page, { type: 'skip-index-remainder' }); assert.equal(page.state, 'ready_b'); assert.equal(calls, 2048)
  assert.equal(page.progress.indexCueCount, 8192); assert.equal(page.progress.crossSegmentGap, true); assert.equal(page.progress.skippedChars, 4)
  assert.ok(page.progress.misses.some(miss => miss.reason === 'skipped_windows' && miss.source?.chapterId === 'c2048' && miss.source.start === 0 && miss.source.end === 4))
  session.cancel(); tests++
}
console.log(JSON.stringify({ suite: 'novel-scan-engine-controlled', tests, semanticAccuracyClaim: false }))
