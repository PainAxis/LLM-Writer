/** Offline Node CLI/native-file acceptance. Synthetic intercepted SDK replies only. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { runGoPilot, parseGoArguments, goPreviewUnavailableReason } from './creative-pilot-go'
import { openGoPrivateStorage } from './creative-pilot-go-storage'
import { creativeControlText } from './lib/creative-pilot-control'
import { createCreativePilotRepository } from '../src/services/writerCampaign/creativePilotStore'
import { CREATIVE_GO_GRANT_DEFAULTS, sealCreativeGoGrant } from '../src/services/writerCampaign/creativePilotProtocol'
import type { CreativePromptPayloadV1, CreativeRequest } from '../src/types/creativePilot'

const root = fileURLToPath(new URL('../', import.meta.url)), directory = await mkdtemp(path.join(tmpdir(), 'creative-go-cli-'))
const originalFetch = globalThis.fetch, originalNow = Date.now
Date.now = () => Date.UTC(2026, 10, 2, 18)
const key = 'synthetic-go-cli-key-never-a-real-credential'
let requests = 0, lostResponse = false, blockRequest: (() => Promise<void>) | null = null
const confirmations = ['--confirm-no-prepaid-balance', '--confirm-transmission', '--max-usd', '2.663064']
function argumentsFor(dir: string, language?: 'zh' | 'en', maxTasks?: number) {
  return ['--state-dir', dir, ...confirmations, ...(language ? ['--execute', '--language', language] : []), ...(maxTasks ? ['--max-tasks', String(maxTasks)] : [])]
}
function child(args: string[]) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const environment = { ...globalThis.process.env }
    delete environment.OPENCODE_GO_API_KEY
    const process = spawn(globalThis.process.execPath, ['--import', 'tsx', 'scripts/creative-pilot-go.ts', ...args], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    process.stdout.on('data', value => { output += value.toString() })
    // Provider/raw errors must not become test output; the public CLI emits codes.
    process.stderr.on('data', () => {})
    process.on('error', reject); process.on('close', code => resolve({ code, output }))
  })
}
async function assertPrivate(dir: string) {
  assert.equal((await stat(dir)).mode & 0o077, 0)
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name)
    assert.equal((await stat(file)).mode & 0o077, 0)
    assert.equal((await readFile(file, 'utf8')).includes(key), false)
  }
}
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), 'https://opencode.ai/inference/go/openai/v1/chat/completions')
  assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error')
  assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${key}`)
  const body = JSON.parse(String(init?.body))
  assert.equal(body.model, 'mimo-v2.6-flash'); assert.equal(body.max_completion_tokens, 4096)
  requests++
  if (blockRequest) await blockRequest()
  if (lostResponse) throw new Error('synthetic_lost_response')
  const packet = JSON.parse(body.messages[1].content) as CreativePromptPayloadV1
  return new Response(JSON.stringify({ id: 'synthetic-go-response', object: 'chat.completion', created: 1, model: 'mimo-v2.6-flash',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: await creativeControlText(packet) } }],
    usage: { prompt_tokens: 100, completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0,
      opencode: { billing_source: 'go', allowance: 0.0001, list_cost: 0.0001, tokens: { reasoning: 0 } } } }), { headers: { 'content-type': 'application/json' } })
}
try {
  const casDirectory = await mkdtemp(path.join(tmpdir(), 'creative-go-cas-'))
  try {
    const disk = await openGoPrivateStorage(casDirectory, root)
    try {
      const outcomes = await Promise.all(['first', 'second'].map(value => disk.io.compareAndSwapMany([{ key: 'row', expectedValue: null, value }])))
      assert.equal(outcomes.filter(Boolean).length, 1)
      const prior = (await disk.io.getMany(['row'])).get('row')!
      let guards = 0
      assert.equal(await disk.io.compareAndSwapMany([{ key: 'row', expectedValue: prior, value: 'revoked' }], () => ++guards === 1), false)
      assert.equal((await disk.io.getMany(['row'])).get('row'), prior)
      assert.equal(await disk.io.compareAndSwapMany([{ key: 'row', expectedValue: null, value: 'stale' }]), false)
      await assert.rejects(disk.read('../outside.json'))
    } finally { await disk.close() }
    const reopened = await openGoPrivateStorage(casDirectory, root)
    try { assert.equal((await reopened.io.getMany(['row'])).get('row'), 'first') } finally { await reopened.close() }
    await mkdir(path.join(casDirectory, '.execution-lock'), { mode: 0o700 })
    await assert.rejects(openGoPrivateStorage(casDirectory, root), error => (error as { code?: string }).code === 'locked')
    assert.equal((await stat(path.join(casDirectory, '.execution-lock'))).isDirectory(), true)
  } finally { await rm(casDirectory, { recursive: true, force: true }) }
  for (const args of [[], ['--state-dir', directory, '--execute'], ['--state-dir', directory, '--max-tasks', '1'], ['--state-dir', directory, '--key', key], argumentsFor(directory, 'zh', 10), argumentsFor(directory, 'zh').map(flag => flag === '--confirm-no-prepaid-balance' ? '--confirm-extra-usage-off' : flag)]) assert.throws(() => parseGoArguments(args))
  assert.equal(parseGoArguments(argumentsFor(directory, 'zh')).maxTasks, 1)
  const noCredential = Object.defineProperty({}, 'OPENCODE_GO_API_KEY', { get() { throw new Error('credential_read_in_preview') } })
  const preflight = await runGoPilot(['--state-dir', directory], noCredential)
  assert.equal(preflight.status, 'authorization_required'); assert.equal(requests, 0)
  assert.equal(preflight.protocol, 'creative-go-cli-summary-v2'); assert.equal(preflight.noPrepaidBalance, 'not_confirmed')
  assert.equal(Object.hasOwn(preflight, 'extraUsageOff'), false)
  const missingBalance = await runGoPilot(['--state-dir', directory, '--confirm-transmission', '--max-usd', '2.663064'], noCredential)
  assert.equal(missingBalance.status, 'authorization_required'); assert.equal(requests, 0)
  assert.deepEqual(await readdir(directory), [])
  const prepared = await runGoPilot(argumentsFor(directory), noCredential)
  assert.equal(prepared.status, 'prepared'); assert.equal(requests, 0)
  assert.equal(prepared.noPrepaidBalance, 'user_confirmed'); assert.equal(prepared.reservedCostMicroUsd, 2663064)
  const originalPair = await readFile(path.join(directory, 'pair.json'), 'utf8')
  const parsedPair = JSON.parse(originalPair)
  assert.equal(parsedPair.protocol, 'creative-go-private-pair-v2')
  assert.equal(parsedPair.grant.protocol, 'creative-pilot-go-grant-v2'); assert.equal(parsedPair.grant.noPrepaidBalance, true)
  assert.equal(Object.hasOwn(parsedPair.grant, 'extraUsageDisabled'), false)
  // Neither legacy pairs nor relabelled v1 grants can gain a new attestation.
  const legacyDir = await mkdtemp(path.join(tmpdir(), 'creative-go-legacy-'))
  try {
    const legacyGrant = await sealCreativeGoGrant({ ...CREATIVE_GO_GRANT_DEFAULTS, grantId: parsedPair.grant.grantId,
      campaignIds: parsedPair.grant.campaignIds, briefHashes: parsedPair.grant.briefHashes, maxCostMicroUsd: 2663064,
      transmissionConsent: true, expiresAt: parsedPair.grant.expiresAt })
    for (const protocol of ['creative-go-private-pair-v1', 'creative-go-private-pair-v2']) {
      const legacyDisk = await openGoPrivateStorage(legacyDir, root)
      try { await legacyDisk.write('pair.json', { ...parsedPair, protocol, directory: legacyDir, grant: legacyGrant }) }
      finally { await legacyDisk.close() }
      const before = await readFile(path.join(legacyDir, 'pair.json'), 'utf8')
      await assert.rejects(runGoPilot(argumentsFor(legacyDir, 'zh'), noCredential), error =>
        ['source_changed', 'private_state'].includes((error as { code: string }).code))
      assert.equal(await readFile(path.join(legacyDir, 'pair.json'), 'utf8'), before)
      assert.deepEqual(await readdir(legacyDir), ['pair.json']); assert.equal(requests, 0)
    }
  } finally { await rm(legacyDir, { recursive: true, force: true }) }
  const snapshotDisk = await openGoPrivateStorage(directory, root)
  try {
    const snapshot = (await createCreativePilotRepository({ io: snapshotDisk.io }).read(JSON.parse(originalPair).grant.campaignIds.zh))!
    assert.equal(snapshot.manifest.policy.protocol, 'creative-pilot-go-policy-v2')
    assert.equal(goPreviewUnavailableReason(snapshot, Date.now()), null)
    assert.equal(goPreviewUnavailableReason(snapshot, snapshot.manifest.expiresAt), 'expired')
    const retained = structuredClone(snapshot); retained.checkpoint.tasks[0]!.status = 'response_retained'
    assert.equal(goPreviewUnavailableReason(retained, Date.now()), 'retained_response')
    const reserved = structuredClone(snapshot); reserved.checkpoint.tasks[0]!.status = 'reserved'; reserved.checkpoint.tasks[0]!.requestHash = 'a'.repeat(64)
    reserved.requests.set('a'.repeat(64), { expiresAt: Date.now() } as CreativeRequest)
    assert.equal(goPreviewUnavailableReason(reserved, Date.now()), 'expired')
    const unknown = structuredClone(snapshot); unknown.checkpoint.tasks[0]!.status = 'outcome_unknown'
    assert.equal(goPreviewUnavailableReason(unknown, Date.now()), 'unknown_outcome')
    const blocked = structuredClone(snapshot); blocked.checkpoint.status = 'blocked'
    assert.equal(goPreviewUnavailableReason(blocked, Date.now()), 'terminal')
  } finally { await snapshotDisk.close() }
  assert.equal(JSON.stringify(prepared).includes(directory), false)
  const inspected = await runGoPilot(['--state-dir', directory], noCredential)
  assert.equal(inspected.attempts.zh, 0); assert.equal(inspected.noPrepaidBalance, 'not_confirmed')
  await assertPrivate(directory)
  await assert.rejects(openGoPrivateStorage(path.join(root, 'private-go-prohibited'), root))
  const broad = path.join(path.dirname(directory), `go-broad-${crypto.randomUUID()}`)
  await mkdir(broad, { mode: 0o755 })
  try { await assert.rejects(openGoPrivateStorage(broad, root)) } finally { await rm(broad, { recursive: true }) }
  const alias = `${directory}-alias`
  await symlink(directory, alias)
  try { await assert.rejects(openGoPrivateStorage(alias, root)) } finally { await rm(alias) }
  let release!: () => void, seen!: () => void
  const held = new Promise<void>(resolve => { release = resolve }), reached = new Promise<void>(resolve => { seen = resolve })
  blockRequest = () => { seen(); return held }
  const first = runGoPilot(argumentsFor(directory, 'zh'), { OPENCODE_GO_API_KEY: key })
  await Promise.race([reached, first.then(() => { throw new Error('request_hold_not_reached') })])
  try {
    const concurrent = await child(['--state-dir', directory])
    assert.equal(concurrent.code, 1); assert.deepEqual(JSON.parse(concurrent.output), { protocol: 'creative-go-cli-error-v1', code: 'locked' })
    assert.equal(requests, 1)
  } finally { release(); blockRequest = null }
  const firstResult = await first
  assert.equal(firstResult.tasks.zh, 1); assert.equal(firstResult.attempts.zh, 1); assert.equal(requests, 1)
  await assert.rejects(runGoPilot(['--state-dir', directory, '--execute', '--language', 'zh', '--confirm-transmission', '--max-usd', '2.663064'], noCredential))
  assert.equal(requests, 1)
  assert.equal((await runGoPilot(['--state-dir', directory], noCredential)).tasks.zh, 1)
  assert.equal(requests, 1)
  const zh = await runGoPilot(argumentsFor(directory, 'zh', 8), { OPENCODE_GO_API_KEY: key })
  assert.equal(zh.tasks.zh, 9); assert.equal(zh.attempts.zh, 9)
  const en = await runGoPilot(argumentsFor(directory, 'en', 9), { OPENCODE_GO_API_KEY: key })
  assert.deepEqual(en.tasks, { zh: 9, en: 9 }); assert.deepEqual(en.attempts, { zh: 9, en: 9 }); assert.equal(requests, 18)
  assert.equal(await readFile(path.join(directory, 'pair.json'), 'utf8'), originalPair)
  for (const language of ['zh', 'en']) {
    const preview = JSON.parse(await readFile(path.join(directory, `preview-${language}.json`), 'utf8'))
    const inspection = JSON.parse(await readFile(path.join(directory, `inspection-${language}.json`), 'utf8'))
    assert.deepEqual(preview, { status: 'unavailable', reason: 'terminal', checkpointHash: inspection.checkpoint.hash })
  }
  await assertPrivate(directory)
  const interruptedDir = await mkdtemp(path.join(tmpdir(), 'creative-go-interrupt-'))
  const originalDigest = crypto.subtle.digest
  try {
    await runGoPilot(argumentsFor(interruptedDir), noCredential)
    for (const phase of ['state_validation', 'before_host', 'host_validation', 'after_host'] as const) {
      let armed = phase === 'state_validation', digests = 0, interrupted = false, credentialReads = 0
      const threshold = phase === 'after_host' ? 2 : 1
      crypto.subtle.digest = async function (algorithm, data) {
        const result = await originalDigest.call(this, algorithm, data)
        if (armed && ++digests === threshold) { interrupted = true; process.emit('SIGINT') }
        return result
      }
      const environment = Object.defineProperty({}, 'OPENCODE_GO_API_KEY', { get() {
        credentialReads++
        if (phase === 'before_host') { interrupted = true; process.emit('SIGINT') }
        else armed = true
        return key
      } })
      const before = requests
      await assert.rejects(runGoPilot(argumentsFor(interruptedDir, 'zh'), environment))
      crypto.subtle.digest = originalDigest
      assert.equal(interrupted, true); assert.equal(requests, before)
      if (phase === 'state_validation') assert.equal(credentialReads, 0)
      const inspected = await runGoPilot(['--state-dir', interruptedDir], noCredential)
      assert.deepEqual(inspected.attempts, { zh: 0, en: 0 })
    }
    const beforeExpiry = await readFile(path.join(interruptedDir, 'records.json'), 'utf8'), inWindowNow = Date.now
    Date.now = () => Date.UTC(2026, 10, 2, 19)
    try {
      await runGoPilot(['--state-dir', interruptedDir], noCredential)
      const preview = JSON.parse(await readFile(path.join(interruptedDir, 'preview-zh.json'), 'utf8'))
      const inspection = JSON.parse(await readFile(path.join(interruptedDir, 'inspection-zh.json'), 'utf8'))
      assert.deepEqual(preview, { status: 'unavailable', reason: 'expired', checkpointHash: inspection.checkpoint.hash })
      assert.equal(await readFile(path.join(interruptedDir, 'records.json'), 'utf8'), beforeExpiry)
    } finally { Date.now = inWindowNow }
    await assertPrivate(interruptedDir)
  } finally { crypto.subtle.digest = originalDigest; await rm(interruptedDir, { recursive: true, force: true }) }
  const unknownDir = await mkdtemp(path.join(tmpdir(), 'creative-go-unknown-'))
  try {
    lostResponse = true
    await assert.rejects(runGoPilot(argumentsFor(unknownDir, 'zh'), { OPENCODE_GO_API_KEY: key }))
    assert.equal(requests, 19)
    const unknown = await runGoPilot(['--state-dir', unknownDir], noCredential)
    assert.equal(unknown.unknown.zh, 1); assert.equal(unknown.attempts.zh, 1)
    const preview = JSON.parse(await readFile(path.join(unknownDir, 'preview-zh.json'), 'utf8'))
    const inspection = JSON.parse(await readFile(path.join(unknownDir, 'inspection-zh.json'), 'utf8'))
    assert.deepEqual(preview, { status: 'unavailable', reason: 'unknown_outcome', checkpointHash: inspection.checkpoint.hash })
    await assert.rejects(runGoPilot(argumentsFor(unknownDir, 'zh'), { OPENCODE_GO_API_KEY: key }))
    assert.equal(requests, 19); await assertPrivate(unknownDir)
  } finally { await rm(unknownDir, { recursive: true, force: true }) }
  console.log(JSON.stringify({ status: 'pass', scope: 'offline_go_cli_native_files_sdk_interception', syntheticRequests: requests, providerCalls: 0,
    tasks: 18, defaultTaskLimit: 1, crossProcessExclusive: true, interruptZeroDispatchCases: 4, unknownNotReplayed: true, credentialPersisted: false, balanceAttestation: 'user_confirmed', accountVerification: 'NOT_PERFORMED', legacyPairsNotRelabelled: true }))
} finally { globalThis.fetch = originalFetch; Date.now = originalNow; await rm(directory, { recursive: true, force: true }) }
