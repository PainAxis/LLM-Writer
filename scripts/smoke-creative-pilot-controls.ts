/** Focused fixture/oracle development gate. Pure compiler controls are NOT SDK task evidence. */
import type { CreativeCheckpoint, CreativeSourceView } from '../src/types/creativePilot'
import { request as httpRequest } from 'node:http'
import { createCreativeControlServer } from './lib/creative-pilot-node-server'
import { createCreativeCandidate, createCreativeManifest, creativeRequestReservation, encodeCreativeResponseText, sealCreativeRequest, sealCreativeResponse } from '../src/services/writerCampaign/creativePilotProtocol'
import { compileCreativeInput } from '../src/services/writerCampaign/creativePilotContext'
import { compileCreativeResponse } from '../src/services/writerCampaign/creativePilotCompiler'
import { createCreativeMemoryIO } from './lib/creative-pilot-io'
import { creativePilotBriefs } from './lib/creative-pilot-briefs'
import { CREATIVE_CONTROL_MODEL, creativeControlIdentity, creativeControlReply, creativeControlText } from './lib/creative-pilot-control'
import { bodyOracle, byteOracle, canonicalOracle, controlAssert, hashOracle, scalarOracle, storageCounterOracle, writeBytesOracle } from './lib/creative-pilot-oracles'
import { CREATIVE_APP_CHECKS, CREATIVE_COMPILER_IDS, CREATIVE_DURABLE_IDS, CREATIVE_DURABLE_VARIANTS, CREATIVE_ENGINE_IDS, CREATIVE_INTERRUPTION_IDS, CREATIVE_METAMORPHIC_IDS, CREATIVE_POSITIVE_CHECKS, CREATIVE_REPORT_IDS } from './lib/creative-pilot-registry'
let checks = 0
function check(value: unknown) { controlAssert(value); checks++ }
function refuses(fn: () => unknown) { let refused = false; try { fn() } catch { refused = true }; check(refused) }
async function main() {
  let serverWire = ''
  check(await hashOracle('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  check(canonicalOracle({ z: [true, null, 0], a: '中🙂' }) === '{"a":"中🙂","z":[true,null,0]}')
  refuses(() => scalarOracle('\ud800')); refuses(() => scalarOracle('\udc00')); refuses(() => canonicalOracle({ n: 0.7 })); refuses(() => canonicalOracle({ n: -1 }))
  check(byteOracle('中🙂') === 7)
  const m = await bodyOracle('A\u030a\r\n🙂'); check(m.raw.scalars === 5 && m.raw.utf16Units === 6 && m.canonical.scalars === 3)
  check(storageCounterOracle('0000000001900544') === 1900544)
  check(writeBytesOracle([{ key: 'k', value: '中' }]) === 4)
  // A committed legacy/non-v4 write and an invalid accounting record must still count as writes.
  for (const values of [[{ schemaVersion: 2 }], [{ protocolVersion: 'creative-pilot-checkpoint-v4', campaignId: 'invalid-accounting' }, { protocolVersion: 'creative-pilot-receipt-v4' }]]) {
    const memory = createCreativeMemoryIO(), entries = values.map((value, index) => ({ key: 'meter-' + index, value: JSON.stringify(value), expectedValue: null }))
    let rejected = false; try { await memory.io.compareAndSwapMany(entries) } catch { rejected = true }
    check(rejected && memory.observe().successfulCas === 1 && memory.observe().casCalls === 1 && entries.every(entry => memory.rows.get(entry.key) === entry.value))
  }
  check(CREATIVE_DURABLE_VARIANTS.length === 21 && CREATIVE_DURABLE_IDS.length === 63 && new Set(CREATIVE_DURABLE_IDS).size === 63)
  check(CREATIVE_POSITIVE_CHECKS.length === 12 && CREATIVE_APP_CHECKS.length === 16 && CREATIVE_COMPILER_IDS.length === 24 && CREATIVE_METAMORPHIC_IDS.length === 6 && CREATIVE_ENGINE_IDS.length === 20 && CREATIVE_INTERRUPTION_IDS.length === 16 && CREATIVE_REPORT_IDS.length === 16)
  const fixtures = creativePilotBriefs(), digests = new Set<string>()
  check(fixtures.length === 6 && fixtures.filter(x => x.brief.language === 'zh').length === 3)
  const first = creativePilotBriefs(); first[0]!.brief.premise = 'mutated'; check(creativePilotBriefs()[0]!.brief.premise !== 'mutated')
  for (const fixture of fixtures) {
    const candidate = await createCreativeCandidate(`control-${fixture.id}`, fixture.brief, 1)
    const manifest = await createCreativeManifest(`control-${fixture.id}`, candidate, { runtimeIdentity: 'pure-control', source: { commit: null, tree: null } })
    // Explicit pure-context stub, not a stored/accepted campaign or an SDK positive.
    const checkpoint = { candidateHash: candidate.hash, tasks: manifest.tasks.map(t => ({ taskId: t.id, revision: 0, status: 'pending', artifactHash: null, requestHash: null })) } as CreativeCheckpoint
    const view: CreativeSourceView = { manifest, candidate, checkpoint, artifacts: new Map(), rawHead: 'pure-control-not-persisted' }
    const prepared = await compileCreativeInput(view, 'outline')
    check(prepared.inputDigest === await hashOracle(canonicalOracle(prepared.wire)))
    const rawBody = JSON.stringify({ model: CREATIVE_CONTROL_MODEL, temperature: 0.7, max_tokens: 4096, messages: [{ role: 'system', content: prepared.wire.system }, { role: 'user', content: prepared.wire.prompt }] })
    if (!serverWire) serverWire = rawBody
    const reply = await creativeControlReply(rawBody), text = JSON.parse(reply.body).choices[0].message.content as string
    check(reply.record.bodyDigest === await hashOracle(rawBody) && reply.record.inputDigest === prepared.inputDigest)
    const parsed = JSON.parse(text); check(parsed.payload.premise === fixture.brief.premise && parsed.payload.genreRules[0].statement === fixture.brief.constraints[0])
    digests.add(reply.record.briefDigest)
    const request = await sealCreativeRequest({ schemaVersion: 1, protocol: 'creative-pilot-request-v1', campaignId: manifest.campaignId, id: 'pure-request', operationId: 'pure-operation', manifestHash: manifest.hash, candidateHash: candidate.hash, taskId: 'outline', taskRevision: 0, dependencies: [], prepared, adapter: creativeControlIdentity('http://127.0.0.1:1/v1'), invocationId: 'pure-unit-not-authority', reservation: creativeRequestReservation(), createdAt: 2, expiresAt: 60002, storageAllocationBytes: '0000000001900544' as never })
    const response = await sealCreativeResponse({ schemaVersion: 1, protocol: 'creative-pilot-response-v1', campaignId: manifest.campaignId, requestHash: request.hash, intentHash: 'a'.repeat(64), evidenceId: 'pure-unit-evidence', ...await encodeCreativeResponseText(text), finishReason: 'stop', contentEvidence: { stepCount: 1, anomalies: [] }, usage: { status: 'partial', provenance: 'synthetic_control', inputTokens: 37, outputTokens: 29, reasoningTokens: null }, reportedModel: { status: 'matched', value: CREATIVE_CONTROL_MODEL } })
    const result = await compileCreativeResponse(view, request, response); check(result.outcome === 'accepted')
    const changed = structuredClone(prepared); changed.brief.premise += fixture.brief.language === 'zh' ? ' 新的选择。' : ' A changed choice.'
    const changedText = await creativeControlText(changed); check(JSON.parse(changedText).payload.premise !== parsed.payload.premise)
    const original = JSON.parse(rawBody); original.tools = []
    let rejected = false; try { await creativeControlReply(JSON.stringify(original)) } catch { rejected = true }; check(rejected)
  }
  check(digests.size === 6)
  process.stdout.write(JSON.stringify({ status: 'pass', scope: 'fixture_oracle_pure_outline_controls', checks, pureOutlineCompilations: 6, sdkRequests: 0, positiveGenerationTasksAwarded: 0 }) + '\n')
  await serverHoldControls(serverWire)
}
/** Real loopback HTTP, without SDK/browser: partial body makes the early-release race deterministic. */
async function serverHoldControls(wire: string) {
  const server = await createCreativeControlServer({ maxAttempts: 3, guardNodeFetch: false })
  const clients: ReturnType<typeof httpRequest>[] = []
  const wait = async (predicate: () => boolean) => {
    const until = Date.now() + 2000
    while (!predicate()) { controlAssert(Date.now() < until, 'server_hold_control_timeout'); await new Promise(resolve => setTimeout(resolve, 5)) }
  }
  try {
    for (const early of [true, false, false]) {
      server.release() // An idle release must not authorize the following request.
      server.setMode('hold')
      const before = server.observe().attempts
      let completed = false, failed = false, status = 0
      const req = httpRequest(server.endpoint + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
        status = res.statusCode ?? 0; res.resume(); res.on('end', () => { completed = true }); res.on('error', () => { failed = true })
      })
      clients.push(req); req.on('error', () => { failed = true })
      req.write(wire.slice(0, 1))
      await wait(() => server.observe().attempts === before + 1)
      controlAssert(server.observe().records.length === before && !completed && !failed)
      if (early) { server.release(); server.release() }
      req.end(wire.slice(1))
      if (!early) {
        await wait(() => server.observe().records.length === before + 1)
        controlAssert(server.observe().activeRequests === 1 && !completed && !failed)
        server.release(); server.release()
      }
      await wait(() => completed || failed)
      controlAssert(completed && !failed && status === 200)
      const final = server.observe()
      controlAssert(final.activeRequests === 0 && final.maxActiveRequests === 1 && final.attempts === before + 1 && final.errors === 0)
    }
    process.stdout.write(JSON.stringify({ status: 'pass', scope: 'loopback_server_hold_controls', cases: 3, httpRequests: 3, sdkRequests: 0, positiveGenerationTasksAwarded: 0 }) + '\n')
  } catch (error) {
    const observed = server.observe()
    process.stdout.write(JSON.stringify({ status: 'failed', scope: 'loopback_server_hold_controls', attempts: observed.attempts, records: observed.records.length, activeRequests: observed.activeRequests, maxActiveRequests: observed.maxActiveRequests, errors: observed.errors }) + '\n')
    throw error
  } finally { for (const req of clients) req.destroy(); await server.close() }
}
main().catch(() => { process.stdout.write(JSON.stringify({ status: 'failed', scope: 'creative_pilot_controls', checks, sdkRequests: 0, positiveGenerationTasksAwarded: 0 }) + '\n'); process.exitCode = 1 })
