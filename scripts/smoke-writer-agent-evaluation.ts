/** Deterministic production-path and egress-contract checks. Never a live/model-quality run. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import net from 'node:net'
import { loadWriterAgentEvalFixture } from './lib/writer-agent-eval-fixture'
import { runWriterAgentEvaluation, selectRequiredEvidence, minimumCover, writePrivatePacket, evaluationFailed } from './lib/writer-agent-evaluation'
import { EVALUATION_LIVE_LIMITS, EvaluationError, validateLivePlan, parseLivePlanJSON, validateCredential, createEvaluationFetchGuard, blockNodeNetwork } from './lib/writer-agent-eval-network'

let groups = 0
async function main() {
const { fixture, sha256 } = await loadWriterAgentEvalFixture()
const secret = 'synthetic-live-guard-key-never-real'
const ids = fixture.cases.slice(0, 2).map(row => row.id)
const plan = { schemaVersion: 1, fixtureSha256: sha256, endpoint: 'https://api.provider.example.org/v1/chat/completions',
  model: 'synthetic-general-purpose', caseIds: ids, limits: { ...EVALUATION_LIVE_LIMITS }, approvedSyntheticCorpus: true, approvedAutomaticSelection: true }
const errorCode = (code: string) => (error: unknown) => error instanceof EvaluationError && error.code === code
assert.deepEqual(validateLivePlan(parseLivePlanJSON(JSON.stringify(plan)), sha256, fixture.cases.map(row => row.id)), plan)
assert.throws(() => parseLivePlanJSON('{"approvedAutomaticSelection":false,"approvedAutomaticSelection":true}'), errorCode('invalid_plan'))
for (const patch of [
  { endpoint: 'http://api.provider.example.org/v1/chat/completions' },
  { endpoint: 'https://api.provider.example.org/v1/chat/completions?key=forbidden' },
  { endpoint: 'https://user:password@api.provider.example.org/v1/chat/completions' },
  { endpoint: 'https://127.0.0.1/v1/chat/completions' }, { endpoint: 'https://api.provider.example.org/v1/models' },
  { caseIds: [] }, { caseIds: [...ids, ids[0]] }, { caseIds: ['not-a-frozen-case'] },
  { limits: { ...EVALUATION_LIVE_LIMITS, maxHttpRequests: 5 } }, { approvedAutomaticSelection: false }, { extra: true },
]) assert.throws(() => validateLivePlan({ ...plan, ...patch }, sha256, fixture.cases.map(row => row.id)), errorCode('invalid_plan'))
for (const key of ['', 'short', `${secret}\n`, `Bearer ${secret}`, `${secret}"`]) assert.throws(() => validateCredential(key), errorCode('invalid_credential'))
groups++

// This mask-order counterexample used to choose [1,2], not the specified [0,3].
assert.deepEqual(minimumCover([[0, 1], [0, 2], [1, 3], [2, 3]], 4), [0, 3])
assert.equal(minimumCover([[0]], 2), null)
assert.equal(minimumCover([[]], 0), null)
groups++

let rawNetworkAttempts = 0
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { rawNetworkAttempts++; throw new Error('Real network is forbidden') }
try {
  const result = await runWriterAgentEvaluation()
  assert.equal(result.publicSummary.caseCount, 8)
  assert.equal(result.publicSummary.executedCaseCount, 8)
  assert.equal(result.publicSummary.httpRequests, 13)
  assert.equal(result.publicSummary.sourceUnchanged, true)
  assert.deepEqual(result.publicSummary.cases.map(row => row.outcome), fixture.cases.map(row => row.expectedMock.outcome))
  assert.ok(result.publicSummary.cases.every(row => Object.values(row.checks).every(value => value !== false)))
  assert.equal(result.publicSummary.cases.filter(row => row.outcome === 'draft_ready').length, 5)
  const publicText = JSON.stringify(result.publicSummary)
  for (const row of fixture.cases) {
    assert.ok(!publicText.includes(row.brief))
    for (const premise of row.requiredPremises) assert.ok(!publicText.includes(premise.quote))
    if (row.expectedMock.draftText) assert.ok(!publicText.includes(row.expectedMock.draftText))
  }
  assert.ok(!JSON.stringify(result).includes('synthetic-placeholder-no-real-secret'))
  assert.ok(result.publicSummary.cases.every(row => row.quality === 'not_reviewed'))
  const revision = result.publicSummary.cases.find(row => row.caseId === 'q03-current-revision')!
  assert.equal(revision.prewarmSyncs, 1); assert.equal(revision.currentSyncs, 1)
  assert.equal(result.publicSummary.cases.reduce((sum, row) => sum + row.exclusions.inputBoundaryViolations, 0), 0)
  assert.equal(result.publicSummary.cases.reduce((sum, row) => sum + row.exclusions.draftOutputViolations, 0), 1)
  for (const row of result.privatePacket.cases) {
    assert.ok(!row.audit.some(event => event.kind === 'apply_consumed'))
    const testCase = fixture.cases.find(testCase => testCase.id === row.caseId)!
    if (row.status === 'draft_ready') {
      const selection = selectRequiredEvidence(testCase, row.evidence)
      assert.equal(selection.complete, true)
      assert.deepEqual(selection.selected, row.selectedEvidence)
    } else { assert.equal(row.draft, null); assert.equal(row.requests.length, 1) }
  }
  groups++

  const firstCase = fixture.cases[0]!, first = result.privatePacket.cases[0]!
  assert.equal(selectRequiredEvidence({ ...firstCase, requiredPremises: [] }, first.evidence).complete, false)
  assert.equal(selectRequiredEvidence(firstCase, first.evidence.map(hit => ({ ...hit, revision: '0'.repeat(64) }))).complete, false)
  assert.equal(selectRequiredEvidence(firstCase, first.evidence.map(hit => ({ ...hit, quote: hit.quote.slice(-1), start: hit.end - 1 }))).complete, false)
  assert.equal(selectRequiredEvidence(firstCase, first.evidence.map(hit => ({ ...hit, projectId: 'another-project' }))).complete, false)
  groups++

  const badPlan = await runWriterAgentEvaluation({ mockReply: (id, phase, text) => id === firstCase.id && phase === 'plan' ? '{not-json}' : text })
  assert.equal(badPlan.publicSummary.cases[0]!.errorCategory, 'protocol')
  assert.equal(badPlan.publicSummary.cases[0]!.httpRequests, 1)
  assert.equal(badPlan.privatePacket.cases[0]!.draft, null)
  groups++

  let liveDispatches = 0
  const reply = (text: string, model = plan.model, status = 200) => new Response(JSON.stringify({ id: 'synthetic', object: 'chat.completion', created: 1, model,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 } }),
  { status, headers: { 'content-type': 'application/json' } })
  const admitted = await runWriterAgentEvaluation({ mode: 'live', livePlan: plan, credential: secret, testTransport: async (_input, init) => {
    const body = JSON.parse(String(init!.body))
    assert.equal(body.model, plan.model); assert.equal(init!.redirect, 'error')
    const testCase = fixture.cases[Math.floor(liveDispatches / 2)]!
    const text = liveDispatches++ % 2 === 0 ? testCase.expectedMock.planText : testCase.expectedMock.draftText!
    return reply(text)
  } })
  assert.equal(liveDispatches, 4); assert.equal(admitted.publicSummary.caseCount, 8)
  assert.equal(admitted.publicSummary.executedCaseCount, 2)
  assert.equal(admitted.publicSummary.maxOutputTokensReserved, 4_800)
  assert.equal(admitted.publicSummary.cases.filter(row => row.outcome === 'not_run').length, 6)
  assert.ok(admitted.publicSummary.cases.every(row => row.checks.mockExpectation === null))
  assert.ok(!JSON.stringify(admitted).includes(secret))
  groups++

  const abstention = await runWriterAgentEvaluation({ mode: 'live', livePlan: { ...plan, caseIds: fixture.cases.slice(2, 4).map(row => row.id) }, credential: secret,
    testTransport: async () => reply('{"version":1,"outcome":"needs_author_input"}') })
  assert.equal(evaluationFailed(abstention.publicSummary), false)
  const untouchedRevision = abstention.publicSummary.cases[2]!
  assert.equal(untouchedRevision.checks.staleIndexRebuilt, null)
  assert.equal(untouchedRevision.checks.productionRetrieval, null)
  const skippedExclusions = abstention.publicSummary.cases[3]!.exclusions
  assert.ok(skippedExclusions.checked > 0)
  assert.ok(skippedExclusions.notEvaluated > 0)
  assert.equal(skippedExclusions.byLocation.retrieval.checked, 0)
  assert.equal(skippedExclusions.byLocation.draft_output.checked, 0)
  groups++

  for (const scenario of ['echo', 'encoded_echo', 'authentication', 'redirect', 'oversize', 'provider_error'] as const) {
    let requests = 0
    const run = await runWriterAgentEvaluation({ mode: 'live', livePlan: plan, credential: secret, testTransport: async () => {
      requests++
      if (scenario === 'echo') return reply(secret)
      if (scenario === 'encoded_echo') return reply(JSON.stringify({ version: 1, tool: 'writer_retrieve_disclosed_context', input: { query: secret } }).replaceAll(secret, [...secret].map(char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join('')))
      if (scenario === 'authentication') return new Response(JSON.stringify({ error: { message: secret } }), { status: 401 })
      if (scenario === 'redirect') return new Response('', { status: 307, headers: { location: 'https://not-authorized.example.org/' } })
      if (scenario === 'oversize') return new Response('x'.repeat(65_537))
      return new Response(JSON.stringify({ error: { message: `PRIVATE_PROVIDER_DIAGNOSTIC ${secret}` } }), { status: 503 })
    } })
    assert.ok(!JSON.stringify(run).includes(secret))
    assert.ok(!JSON.stringify(run).includes('PRIVATE_PROVIDER_DIAGNOSTIC'))
    assert.equal(run.publicSummary.cases[0]!.outcome, 'failed')
    assert.equal(run.privatePacket.cases[0]!.draft, null)
    assert.equal(evaluationFailed(run.publicSummary), true)
    if (scenario !== 'provider_error') {
      assert.equal(requests, 1)
      assert.equal(run.privatePacket.cases[1]!.notRunReason, 'integrity_stop')
    }
    if (scenario === 'oversize') assert.equal(run.publicSummary.cases[0]!.errorCategory, 'limits')
  }
  groups++

  const directory = await mkdtemp(join(tmpdir(), 'writer-agent-eval-private-'))
  try {
    const path = join(directory, 'packet.json')
    await writePrivatePacket(path, result.privatePacket)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), result.privatePacket)
    await assert.rejects(writePrivatePacket(path, result.privatePacket))
    const repoPrivate = new URL('../..private-eval', import.meta.url)
    await mkdir(repoPrivate, { recursive: true })
    try { await assert.rejects(writePrivatePacket(join(repoPrivate.pathname, 'packet.json'), result.privatePacket), errorCode('packet_destination')) }
    finally { await rm(repoPrivate, { recursive: true, force: true }) }
  } finally { await rm(directory, { recursive: true, force: true }) }
  groups++
} finally { globalThis.fetch = originalFetch }
assert.equal(rawNetworkAttempts, 0)

const denied = blockNodeNetwork()
try { assert.throws(() => net.connect(443, 'not-authorized.example.org'), errorCode('dispatch_denied')); assert.equal(denied.count(), 1) }
finally { denied.restore() }
groups++

let guardCalls = 0
const records: Array<{ phase: 'plan' | 'draft'; requestSha256: string; requestBytes: number; responseStatus: number | null }> = []
const expected = { phase: 'plan' as const, system: 'fixed system', prompt: 'fixed prompt' }
const guard = createEvaluationFetchGuard({ endpoint: plan.endpoint, model: plan.model, credential: secret, maxRequests: 1,
  expected: () => expected, records, send: async () => { guardCalls++; return new Response('{}') } })
const init = { method: 'POST', redirect: 'error' as const, signal: new AbortController().signal,
  headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model: plan.model, messages: [{ role: 'system', content: expected.system }, { role: 'user', content: expected.prompt }], max_tokens: 1200, temperature: 0.2 }) }
await assert.rejects(guard.fetch(`${plan.endpoint}/different`, init), errorCode('dispatch_denied'))
await assert.rejects(guard.fetch(plan.endpoint, { ...init, method: 'GET' }), errorCode('dispatch_denied'))
await assert.rejects(guard.fetch(plan.endpoint, { ...init, body: init.body.replace('1200', '1201') }), errorCode('dispatch_denied'))
await assert.rejects(guard.fetch(plan.endpoint, init), errorCode('dispatch_denied'))
assert.equal(guardCalls, 0, 'A denied boundary is sticky, even if a caller catches it')
assert.equal(guard.counts().failure, 'dispatch_denied')
const cleanGuard = createEvaluationFetchGuard({ endpoint: plan.endpoint, model: plan.model, credential: secret, maxRequests: 1, expected: () => expected, records, send: async () => { guardCalls++; return new Response('{}') } })
await cleanGuard.fetch(plan.endpoint, init)
await assert.rejects(cleanGuard.fetch(plan.endpoint, init), errorCode('request_budget'))
assert.equal(guardCalls, 1)
groups++

// Invalid admission fails before stdin/key read, even when stdin is empty.
const invalid = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/eval-writer-agent.ts', '--live'], { encoding: 'utf8', timeout: 5_000, input: '' })
assert.equal(invalid.status, 1)
assert.equal(invalid.stdout, '')
assert.equal(JSON.parse(invalid.stderr).errorCategory, 'invalid_plan')
groups++
process.stdout.write(`${JSON.stringify({ kind: 'writer-agent-evaluation-smoke', groups, fixtureCases: fixture.cases.length, externalRequests: rawNetworkAttempts, quality: 'not_reviewed' })}\n`)

}
main().catch(() => {
  process.stderr.write(`${JSON.stringify({ kind: 'writer-agent-evaluation-smoke', errorCategory: 'assertion_or_runtime_failure', completedGroups: groups })}\n`)
  process.exitCode = 1
})
