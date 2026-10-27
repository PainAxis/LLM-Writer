/** Report-only regressions: actual retained maps and real SDK failures, never positive-task credit. */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { inspect } from 'node:util'
import type { CreativeSnapshot } from '../../src/types/creativePilot'
import type { CreativeHttpObservation } from './creative-pilot-control'
import { creativePilotBriefs } from './creative-pilot-briefs'
import { emptyCreativeReport, validateCreativeReport } from './creative-pilot-report'
import { creativeSchemaSource } from './creative-pilot-report-fixtures'
import { fillCreativePositive } from './creative-pilot-runner'
import { createCreativeMemoryIO } from './creative-pilot-io'
import { runCreativeFaultSeed, preserveCreativePrivateRows } from './creative-pilot-engine-controls'
import { runCreativeMetamorphicControls } from './creative-pilot-metamorphic'
import { runCreativeDurabilityControls, type CreativeFaultSeed } from './creative-pilot-faults'
import { canonicalOracle, controlAssert, rowMapOracle } from './creative-pilot-oracles'
async function refused(run: () => Promise<unknown>) { let failed = false; try { await run() } catch { failed = true }; controlAssert(failed) }
export async function runCreativeReceiptProjectionControls(snapshot: CreativeSnapshot, rows: ReadonlyMap<string, string>, http: CreativeHttpObservation) {
  const row = emptyCreativeReport(creativeSchemaSource, 'node').positiveNode[0]!
  await fillCreativePositive(row, snapshot, http, rows)
  const accepted = snapshot.checkpoint.tasks.filter(task => task.status === 'accepted'), receipts = [...rows].filter(([key]) => key.includes(':v4:receipt:')).map(([key, raw]) => ({ key, value: JSON.parse(raw) }))
  for (const task of accepted) {
    const index = snapshot.checkpoint.requests.find(index => index.requestHash === task.requestHash)!, phase = snapshot.phases.get(index.phaseHash)!
    const receipt = receipts.find(({ value }) => value.kind === 'resolve' && value.event.phaseHash === phase.hash)!.value
    controlAssert(receipt.event.requestHash === null && phase.requestHash === task.requestHash && row.tasks.find(item => item.id === task.taskId)!.receiptHash === receipt.hash)
  }
  controlAssert(new Set(row.tasks.filter(task => task.outcome === 'accepted').map(task => task.receiptHash)).size === accepted.length)
  const first = receipts.find(({ value }) => value.kind === 'resolve')!; controlAssert(first)
  for (const edit of [
    (value: any) => { value.kind = 'reserve' },
    (value: any) => { value.hash = '0'.repeat(64) },
    (value: any) => { value.event.requestHash = snapshot.checkpoint.requests[0]!.requestHash },
    (value: any) => { value.event.phaseHash = snapshot.checkpoint.requests.at(-1)!.phaseHash },
  ]) {
    const value = structuredClone(first.value); edit(value)
    if (canonicalOracle(value) === canonicalOracle(first.value)) continue
    const changed = new Map(rows); changed.set(first.key, canonicalOracle(value))
    await refused(() => fillCreativePositive(emptyCreativeReport(creativeSchemaSource, 'node').positiveNode[0]!, snapshot, http, changed))
  }
  return { acceptedTasks: accepted.length, distinctTerminalReceipts: accepted.length, sdkCalls: 0 }
}
export async function runCreativeSecondSeedFailureControls(privateRoot: string) {
  const blockedCapture = path.join(privateRoot, 'not-a-directory'); await writeFile(blockedCapture, 'private write refusal witness', { flag: 'wx', mode: 0o600 })
  let captureFailures = 0
  const before = new Set(await readdir(privateRoot)), outcomes: Array<{ population: string; httpAttempts: number; successfulCas: number; outstandingBytes: number }> = []
  const brief = creativePilotBriefs()[0]!.brief
  for (const population of ['metamorphic', 'durability'] as const) {
    const report = emptyCreativeReport(creativeSchemaSource, 'node'); let calls = 0
    const runSeed: typeof runCreativeFaultSeed = async (...args) => {
      calls++
      if (calls === 2) {
        try { return await runCreativeFaultSeed(args[0] + '-forced-unknown', args[1], 'lost_response', false, snapshot => {
          controlAssert(snapshot.checkpoint.tasks[0]!.status === 'outcome_unknown')
          if (population === 'durability') process.env.CREATIVE_PILOT_PRIVATE_DIR = blockedCapture
          throw new Error('controlled_second_seed_failure')
        }) } catch (error) {
          process.env.CREATIVE_PILOT_PRIVATE_DIR = privateRoot
          if (population === 'durability') {
            const failure = error as { creativePrivateCapture?: string; creativeControlEvidence?: { rows: Map<string, string>; http: { attempts: number }; io: { successfulCas: number }; snapshot: CreativeSnapshot } }
            controlAssert(failure.creativePrivateCapture === 'failed' && failure.creativeControlEvidence?.http.attempts === 1 && failure.creativeControlEvidence.io.successfulCas === 4 && failure.creativeControlEvidence.snapshot.checkpoint.tasks[0]!.status === 'outcome_unknown')
            controlAssert(Object.getOwnPropertyDescriptor(error, 'creativeControlEvidence')?.enumerable === false && !JSON.stringify(error).includes('creativeControlEvidence') && !inspect(error).includes('creativeControlEvidence') && !inspect(error).includes(brief.premise))
            await preserveCreativePrivateRows('write-failure-recovered-exact-map', failure.creativeControlEvidence.rows); captureFailures++
          }
          throw error
        }
      }
      return runCreativeFaultSeed(...args)
    }
    if (population === 'metamorphic') await refused(() => runCreativeMetamorphicControls(report.metamorphic, { snapshot: { candidate: { brief } } } as CreativeFaultSeed, runSeed))
    else await refused(() => runCreativeDurabilityControls(report.durability, undefined, undefined, runSeed))
    const row = population === 'metamorphic' ? report.metamorphic[0]! : report.durability[0]!
    const httpAttempts = population === 'metamorphic' ? row.exerciseHttpAttempts : row.setupHttpAttempts, successfulCas = population === 'metamorphic' ? row.successfulCas : row.setupSuccessfulCas
    controlAssert(calls === 2 && row.status === 'failed' && httpAttempts === 2 && successfulCas === 9 && row.observation === 'unconfirmed')
    controlAssert(row.obligations.length === 1 && row.obligations[0]!.status === 'outcome_unknown' && row.obligations[0]!.outstandingBytes > 0)
    if (population === 'durability') controlAssert(row.successfulCas === 0 && report.durability.slice(1).every(item => item.status === 'not_run'))
    validateCreativeReport(report)
    outcomes.push({ population, httpAttempts, successfulCas, outstandingBytes: row.obligations[0]!.outstandingBytes })
  }
  const files = (await readdir(privateRoot)).filter(file => !before.has(file)); controlAssert(files.length === 4)
  const { createCreativePilotRepository } = await import('../../src/services/writerCampaign/creativePilotStore')
  let accepted = 0, unknown = 0
  const hashes: string[] = []
  for (const file of files) {
    const target = path.join(privateRoot, file); controlAssert(((await stat(target)).mode & 0o777) === 0o600)
    const saved = JSON.parse(await readFile(target, 'utf8')), rows = new Map<string, string>(saved.rows)
    const head = [...rows].find(([key]) => key.endsWith(':head'))!; controlAssert(head)
    const memory = createCreativeMemoryIO(rows), snapshot = await createCreativePilotRepository({ io: memory.io }).read(JSON.parse(head[1]).campaignId); controlAssert(snapshot)
    if (snapshot.checkpoint.tasks[0]!.status === 'accepted') accepted++
    else { controlAssert(snapshot.checkpoint.tasks[0]!.status === 'outcome_unknown'); unknown++ }
    hashes.push(await rowMapOracle(rows)); controlAssert(memory.observe().successfulCas === 0)
  }
  controlAssert(accepted === 2 && unknown === 2 && captureFailures === 1)
  return { outcomes, captureFailures, privateMaps: files.length, privateMapHashes: hashes, sdkCalls: 4, acceptedSetupMaps: accepted, unknownSetupMaps: unknown }
}
export async function runCreativeBoundaryFailureControls(baseline: CreativeFaultSeed) {
  const { runCreativeEngineBoundaries } = await import('./creative-pilot-engine-boundaries')
  const outcomes: Array<{ id: string; successfulCas: number; outstandingBytes: number }> = []
  for (const id of ['E05', 'E19']) {
    const report = emptyCreativeReport(creativeSchemaSource, 'node'), row = report.engine.find(row => row.id === id)!
    let cut = false
    await refused(() => runCreativeEngineBoundaries([row], baseline, (caseId, count) => { if (caseId === id && count === 1 && !cut) { cut = true; throw new Error('controlled_after_committed_cas') } }))
    controlAssert(cut && row.status === 'failed' && row.successfulCas === 1 && row.observation === 'unconfirmed' && row.exerciseHttpAttempts === 0)
    if (id === 'E19') controlAssert(row.obligations.length === 1 && row.obligations[0]!.status === 'outcome_unknown' && row.obligations[0]!.outstandingBytes > 0)
    validateCreativeReport(report)
    outcomes.push({ id, successfulCas: row.successfulCas, outstandingBytes: row.obligations.reduce((sum, item) => sum + item.outstandingBytes, 0) })
  }
  return { outcomes, sdkCalls: 0 }
}
export async function runCreativeDurabilitySetupAccountingControl() {
  const report = emptyCreativeReport(creativeSchemaSource, 'node'); let observed = false
  await refused(() => runCreativeDurabilityControls(report.durability, undefined, row => {
    if (row.status === 'pass' && !observed) {
      controlAssert(row.id === 'B:D01' && row.setupHttpAttempts === 2 && row.setupSuccessfulCas === 11 && row.successfulCas === 0 && row.obligations.some(item => item.status === 'outcome_unknown' && item.outstandingBytes > 0))
      observed = true; throw new Error('controlled_stop_after_setup_accounting')
    }
  }))
  const row = report.durability[0]!
  controlAssert(observed && row.status === 'failed' && row.setupHttpAttempts === 2 && row.setupSuccessfulCas === 11 && row.successfulCas === 0 && report.durability.slice(1).every(item => item.status === 'not_run'))
  validateCreativeReport(report)
  return { sdkCalls: 2, setupSuccessfulCas: row.setupSuccessfulCas, exercisedSuccessfulCas: row.successfulCas, remainingCases: 'not_run' }
}
