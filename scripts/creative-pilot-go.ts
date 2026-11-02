/** Explicit Node-only OpenCode Go pilot. Default action is private local preview. */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createCreativePilotEngine } from '../src/services/writerCampaign/creativePilotEngine'
import { createCreativePilotRepository } from '../src/services/writerCampaign/creativePilotStore'
import { createCreativeGoSdkHost } from '../src/services/writerCampaign/creativePilotTransport'
import { CREATIVE_GO_GRANT_DEFAULTS, CreativePilotError, sealCreativeGoGrant, validateCreativeGoGrant } from '../src/services/writerCampaign/creativePilotProtocol'
import { hashCampaignValue, canonicalStringify } from '../src/services/writerCampaign/protocol'
import type { CreativeBriefV1, CreativeGoGrantV1, CreativeLanguage, CreativePilotEngine, CreativeRuntimeIdentity, CreativeSnapshot } from '../src/types/creativePilot'
import { creativeIdentity } from './lib/creative-pilot-identity.mjs'
import { GoCliError, openGoPrivateStorage } from './creative-pilot-go-storage'

const root = fileURLToPath(new URL('../', import.meta.url)), languages = ['zh', 'en'] as const
const briefs: Record<CreativeLanguage, CreativeBriefV1> = {
  zh: { protocol: 'creative-brief-v1', language: 'zh', premise: '海边档案馆的年轻馆员寻找一段丢失的潮汐录音；三章内交代线索、一次选择及其后果。', constraints: ['写原创虚构故事，不引用现实人物或私密资料。'] },
  en: { protocol: 'creative-brief-v1', language: 'en', premise: 'A young archivist at a seaside archive searches for a lost recording of the tide. Across three chapters, develop a clue, a choice, and its consequence.', constraints: ['Write original fiction without real people or private information.'] },
}
export function parseGoArguments(args: string[]) {
  const result = { directory: '', execute: false, language: null as CreativeLanguage | null, maxTasks: 1, maxCostMicroUsd: null as number | null, extraUsageOff: false, transmission: false }
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!
    if (seen.has(flag)) throw new GoCliError('arguments')
    seen.add(flag)
    if (flag === '--execute') result.execute = true
    else if (flag === '--confirm-extra-usage-off') result.extraUsageOff = true
    else if (flag === '--confirm-transmission') result.transmission = true
    else {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new GoCliError('arguments')
      if (flag === '--state-dir') result.directory = value
      else if (flag === '--language' && (value === 'zh' || value === 'en')) result.language = value
      else if (flag === '--max-tasks' && /^[1-9]$/.test(value)) result.maxTasks = Number(value)
      else if (flag === '--max-usd' && /^\d{1,6}(?:\.\d{1,6})?$/.test(value)) {
        const [whole, decimal = ''] = value.split('.')
        result.maxCostMicroUsd = Number(whole) * 1_000_000 + Number(decimal.padEnd(6, '0'))
      } else throw new GoCliError('arguments')
    }
  }
  if (!result.directory || (result.execute && (!result.language || !result.extraUsageOff || !result.transmission || result.maxCostMicroUsd === null))
    || (!result.execute && seen.has('--max-tasks')) || (result.maxCostMicroUsd !== null && result.maxCostMicroUsd < CREATIVE_GO_GRANT_DEFAULTS.reservedCostMicroUsd)) throw new GoCliError('authorization')
  return result
}
interface Pair {
  protocol: 'creative-go-private-pair-v1'; directory: string; briefVersion: 'synthetic-go-brief-v1'
  identity: CreativeRuntimeIdentity; grant: CreativeGoGrantV1
}
export interface GoCliSummary {
  protocol: 'creative-go-cli-summary-v1'; mode: 'preview' | 'execute'; status: 'authorization_required' | 'prepared' | 'advanced' | 'blocked'
  tasks: { zh: number; en: number }; attempts: { zh: number; en: number }; unknown: { zh: number; en: number }
  requestedTasks: number; reservedCostMicroUsd: number; extraUsageOff: 'user_confirmed' | 'not_confirmed'
  literaryAcceptance: 'NOT_RUN'; executionEvidence: 'durable_reservations_not_http_receipts'
}
function counts(snapshot: CreativeSnapshot) {
  return { tasks: snapshot.checkpoint.tasks.filter(row => row.status === 'accepted').length, attempts: snapshot.checkpoint.budget.attempts,
    unknown: [...snapshot.phases.values()].filter(row => row.status === 'dispatch_intent' || row.status === 'outcome_unknown').filter(row => snapshot.checkpoint.requests.some(request => request.phaseHash === row.hash)).length }
}
export function goPreviewUnavailableReason(snapshot: CreativeSnapshot, now: number): 'unknown_outcome' | 'terminal' | 'expired' | 'retained_response' | 'not_ready' | null {
  if (snapshot.checkpoint.tasks.some(task => task.status === 'dispatch_intent' || task.status === 'outcome_unknown')) return 'unknown_outcome'
  if (['blocked', 'cancelled', 'completed'].includes(snapshot.checkpoint.status)) return 'terminal'
  if (now >= snapshot.manifest.expiresAt) return 'expired'
  const task = snapshot.checkpoint.tasks.find(row => row.status !== 'accepted')
  if (task?.status === 'response_retained') return 'retained_response'
  if (task?.status === 'pending') return null
  if (task?.status === 'reserved') {
    const request = task.requestHash ? snapshot.requests.get(task.requestHash) : null
    return request && now < request.expiresAt ? null : 'expired'
  }
  return 'not_ready'
}
async function runtimeIdentity(repositoryRoot: string): Promise<CreativeRuntimeIdentity> {
  const provenance = await creativeIdentity(repositoryRoot)
  const files = ['scripts/creative-pilot-go.ts', 'scripts/creative-pilot-go-storage.ts']
  const digest = createHash('sha256').update(JSON.stringify([provenance.source.coreSha256, await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(path.join(repositoryRoot, file))).digest('hex')]))])).digest('hex')
  return { runtimeIdentity: `campaign-core-sha256:${digest}`, source: provenance.identity.source }
}
export async function runGoPilot(args: string[], environment: NodeJS.ProcessEnv = process.env, repositoryRoot = root): Promise<GoCliSummary> {
  const options = parseGoArguments(args)
  const summary: GoCliSummary = { protocol: 'creative-go-cli-summary-v1', mode: options.execute ? 'execute' : 'preview', status: 'authorization_required',
    tasks: { zh: 0, en: 0 }, attempts: { zh: 0, en: 0 }, unknown: { zh: 0, en: 0 }, requestedTasks: options.execute ? options.maxTasks : 0,
    reservedCostMicroUsd: CREATIVE_GO_GRANT_DEFAULTS.reservedCostMicroUsd, extraUsageOff: options.extraUsageOff ? 'user_confirmed' : 'not_confirmed', literaryAcceptance: 'NOT_RUN', executionEvidence: 'durable_reservations_not_http_receipts' }
  const disk = await openGoPrivateStorage(options.directory, repositoryRoot)
  let engine: CreativePilotEngine | null = null, credential: string | null = null, activeGrant: CreativeGoGrantV1 | null = null
  let interrupted = false
  const checkActive = () => { if (interrupted) throw new CreativePilotError('cancelled') }
  const interrupt = () => { interrupted = true; activeGrant = null; credential = null; engine?.stop() }
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
  try {
    const identity = await runtimeIdentity(repositoryRoot), repository = createCreativePilotRepository({ io: disk.io })
    checkActive()
    let pair = await disk.read('pair.json') as Pair | null
    if (!pair) {
      for (const file of ['records.json', 'inspection-zh.json', 'inspection-en.json', 'preview-zh.json', 'preview-en.json']) if (await disk.read(file) !== null) throw new GoCliError('private_state')
      if (!options.extraUsageOff || !options.transmission || options.maxCostMicroUsd === null) return summary
      const grant = await sealCreativeGoGrant({ ...CREATIVE_GO_GRANT_DEFAULTS, grantId: `go-grant-${crypto.randomUUID()}`,
        campaignIds: { zh: `go-zh-${crypto.randomUUID()}`, en: `go-en-${crypto.randomUUID()}` },
        briefHashes: { zh: await hashCampaignValue('creative-brief-v1', briefs.zh), en: await hashCampaignValue('creative-brief-v1', briefs.en) },
        maxCostMicroUsd: options.maxCostMicroUsd, transmissionConsent: true, expiresAt: Math.min(Date.now() + 86_400_000, CREATIVE_GO_GRANT_DEFAULTS.pricingValidUntil) })
      pair = { protocol: 'creative-go-private-pair-v1', directory: disk.directory, briefVersion: 'synthetic-go-brief-v1', identity, grant }
      checkActive()
      await disk.write('pair.json', pair, () => !interrupted)
    }
    if (pair.protocol !== 'creative-go-private-pair-v1' || pair.directory !== disk.directory || pair.briefVersion !== 'synthetic-go-brief-v1'
      || canonicalStringify(pair.identity) !== canonicalStringify(identity)) throw new GoCliError('source_changed')
    await validateCreativeGoGrant(pair.grant)
    checkActive()
    if (options.maxCostMicroUsd !== null && options.maxCostMicroUsd !== pair.grant.maxCostMicroUsd) throw new GoCliError('authorization')
    for (const language of languages) if (await hashCampaignValue('creative-brief-v1', briefs[language]) !== pair.grant.briefHashes[language]) throw new GoCliError('private_state')
    engine = createCreativePilotEngine({ repository, identity, liveGrant: pair.grant, maxTasksPerRun: options.maxTasks })
    const snapshots = {} as Record<CreativeLanguage, CreativeSnapshot>
    for (const language of languages) {
      const campaignId = pair.grant.campaignIds[language]
      let snapshot = await engine.inspect(campaignId)
      checkActive()
      if (!snapshot) {
        try { snapshot = await engine.prepare({ campaignId, operationId: `prepare-${language}-${pair.grant.grantId}`, brief: briefs[language] }) }
        catch (error) { snapshot = await engine.inspect(campaignId); if (!snapshot) throw error }
      }
      if (snapshot.manifest.policy.protocol !== 'creative-pilot-go-policy-v1' || snapshot.manifest.policy.grant.hash !== pair.grant.hash || snapshot.candidate.briefHash !== pair.grant.briefHashes[language]) throw new GoCliError('private_state')
      checkActive()
      snapshots[language] = snapshot
    }
    checkActive()
    if (options.execute) {
      credential = environment.OPENCODE_GO_API_KEY ?? null
      if (!credential || !credential.trim()) throw new GoCliError('credential')
      const language = options.language!, snapshot = snapshots[language]
      if (counts(snapshot).unknown) throw new GoCliError('unknown_outcome')
      activeGrant = pair.grant
      const host = await createCreativeGoSdkHost({ grant: pair.grant, readCredential: () => interrupted ? null : credential, currentGrant: () => interrupted ? null : activeGrant })
      checkActive()
      engine.dispose(); engine = createCreativePilotEngine({ repository, identity, liveGrant: pair.grant, host, maxTasksPerRun: options.maxTasks })
      const command = { campaignId: snapshot.manifest.campaignId, operationId: `go-run-${crypto.randomUUID()}`, expectedRawHead: snapshot.rawHead, expectedCandidateHash: snapshot.candidate.hash }
      try { snapshots[language] = snapshot.checkpoint.budget.attempts ? await engine.resume(command) : await engine.start(command) }
      finally { activeGrant = null; credential = null }
      summary.status = 'advanced'
    } else summary.status = 'prepared'
    for (const language of languages) {
      const snapshot = await engine.inspect(pair.grant.campaignIds[language])
      if (!snapshot) throw new GoCliError('private_state')
      const count = counts(snapshot)
      summary.tasks[language] = count.tasks; summary.attempts[language] = count.attempts; summary.unknown[language] = count.unknown
      if (count.unknown || snapshot.checkpoint.status === 'blocked') summary.status = 'blocked'
      // These files contain source material; they stay in the locked private directory.
      await disk.write(`inspection-${language}.json`, { manifest: snapshot.manifest, candidate: snapshot.candidate, checkpoint: snapshot.checkpoint,
        artifacts: [...snapshot.artifacts.values()], responses: [...snapshot.responses.values()] })
      const unavailable = goPreviewUnavailableReason(snapshot, Date.now())
      if (unavailable) await disk.write(`preview-${language}.json`, { status: 'unavailable', reason: unavailable, checkpointHash: snapshot.checkpoint.hash })
      else {
        // A host-free engine exposes exact local input, without credential access.
        const previewer = createCreativePilotEngine({ repository, identity, liveGrant: pair.grant })
        try {
          const preview = await previewer.dryPrepare(snapshot.manifest.campaignId)
          if (preview.rawHead !== snapshot.rawHead) throw new GoCliError('source_changed')
          await disk.write(`preview-${language}.json`, { status: 'available', checkpointHash: snapshot.checkpoint.hash, preview })
        } finally { previewer.dispose() }
      }
    }
    return summary
  } finally { activeGrant = null; credential = null; engine?.dispose(); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); await disk.close() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runGoPilot(process.argv.slice(2)))) }
  catch (error) {
    const code = error instanceof GoCliError || error instanceof CreativePilotError ? error.code : 'private_state'
    console.log(JSON.stringify({ protocol: 'creative-go-cli-error-v1', code })); process.exitCode = 1
  }
}
