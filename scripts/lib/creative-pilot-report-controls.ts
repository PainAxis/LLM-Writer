/** Sixteen closed-schema/archive controls. Synthetic witnesses are never execution evidence. */
import { mkdir, mkdtemp, rm, symlink, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { creativeIdentity, CREATIVE_CORE_PATHS, CREATIVE_TRANSPORT_PATHS, CREATIVE_COMPILER_PATHS, CREATIVE_UI_PATHS, CREATIVE_FIXTURE_PATHS, CREATIVE_HARNESS_PATHS, CREATIVE_LAUNCH_PATHS, CREATIVE_ARCHIVE_PATHS } from './creative-pilot-identity.mjs'
import { syntheticCreativePassReport } from './creative-pilot-report-fixtures'
import { emptyCreativeReport, validateCreativeReport, creativeReportPassed, safeCreativeCode, type CreativeControlRow } from './creative-pilot-report'
import { prepareCreativePilotEvidence, readCreativeEvidenceFile } from '../prepare-creative-pilot-evidence'
import { controlAssert } from './creative-pilot-oracles'
export async function runCreativeReportControls(rows: CreativeControlRow[]) {
  const root = await mkdtemp(path.join(tmpdir(), 'creative-report-controls-'))
  const input = path.join(root, 'artifacts/creative-pilot'), output = path.join(root, 'artifacts/ci-evidence/creative-pilot')
  const pretty = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
  const rejects = async (action: () => unknown | Promise<unknown>) => { let bad = false; try { await action() } catch { bad = true }; controlAssert(bad) }
  const verify = (row: CreativeControlRow, value: unknown) => { controlAssert(value); row.assertions++ }
  try {
    for (const file of new Set([...CREATIVE_CORE_PATHS, ...CREATIVE_TRANSPORT_PATHS, ...CREATIVE_COMPILER_PATHS, ...CREATIVE_UI_PATHS, ...CREATIVE_FIXTURE_PATHS, ...CREATIVE_HARNESS_PATHS, ...CREATIVE_LAUNCH_PATHS, ...CREATIVE_ARCHIVE_PATHS])) { const name = path.join(root, file); await mkdir(path.dirname(name), { recursive: true }); await writeFile(name, 'disposable schema-only bytes\n') }
    await mkdir(input, { recursive: true }); const { source } = await creativeIdentity(root)
    const save = async (node = emptyCreativeReport(source, 'node')) => { await writeFile(path.join(input, 'node-summary.json'), pretty(node)); await writeFile(path.join(input, 'browser-summary.json'), pretty(emptyCreativeReport(source, 'browser'))) }
    const mutations: Record<string, (value: any) => void> = {
      R01: r => { r.unknown = true }, R02: r => { r.positiveNode[0].tasks[0].body = 'forbidden' }, R03: r => { r.positiveNode[0].tasks[0].rawResponse = 'forbidden' }, R04: r => { r.source.endpoint = 'forbidden'; r.source.apiKey = 'forbidden' },
      R05: r => { r.positiveNode[0].obligations.push(r.positiveNode[0].obligations[0]) }, R06: r => { r.positiveNode[0].metrics.maxRawIoMs = Infinity }, R09: r => { r.positiveApp = syntheticCreativePassReport('browser').positiveApp }, R10: r => { r.positiveNode = syntheticCreativePassReport('node').positiveNode }, R11: r => { r.positiveNode[0].metrics.httpAttempts = 8 }, R12: r => { r.positiveNode[0].metrics.finalFenceObservedKeys-- }, R13: r => { r.compiler.pop() }, R14: r => { r.positiveNode[0].obligations[0].status = 'outcome_unknown' },
    }
    for (const row of rows) {
      row.status = 'running'; row.activeCheck = row.id
      try {
        if (mutations[row.id]) { const value = syntheticCreativePassReport(row.id === 'R10' ? 'browser' : 'node'); mutations[row.id]!(value); await rejects(() => validateCreativeReport(value)); row.assertions++ }
        else if (row.id === 'R07' || row.id === 'R08') {
          for (const key of row.id === 'R07' ? ['coreSha256'] : ['fixtureSha256', 'compilerSha256']) { const value = emptyCreativeReport(source, 'node'); (value.source as any)[key] = 'a'.repeat(64); await save(value); await rejects(() => prepareCreativePilotEvidence(root)); row.assertions++ }
        } else if (row.id === 'R15') {
          await save(); await writeFile(path.join(input, 'raw-response.json'), '{"raw":"forbidden"}'); await prepareCreativePilotEvidence(root); verify(row, JSON.stringify((await readdir(output)).sort()) === JSON.stringify(['browser-summary.json', 'manifest.json', 'node-summary.json']))
          await rejects(() => readCreativeEvidenceFile(root, '../raw-response.json' as any)); row.assertions++
          await rm(path.join(input, 'node-summary.json')); await symlink(path.join(input, 'raw-response.json'), path.join(input, 'node-summary.json')); await rejects(() => readCreativeEvidenceFile(root, 'node-summary.json')); row.assertions++; await rm(path.join(input, 'node-summary.json'))
        } else if (row.id === 'R16') {
          const value = emptyCreativeReport(source, 'node'), active = value.positiveNode[0]!; active.status = 'failed'; active.activeCheck = 'raw_to_compiled'; active.errorCode = 'storage_unknown'; active.observation = 'unconfirmed'; active.obligations = [{ requestHash: 'a'.repeat(64), phaseHash: 'b'.repeat(64), status: 'response_retained', responseHash: 'c'.repeat(64), outcome: null, resolutionReason: null, unknownReason: null, outstandingBytes: 1200000 }]
          validateCreativeReport(value); verify(row, !creativeReportPassed(value)); await save(value); await prepareCreativePilotEvidence(root)
          const actual = JSON.parse(await readFile(path.join(output, 'node-summary.json'), 'utf8')); verify(row, actual.positiveNode[0].obligations[0].outstandingBytes === 1200000 && actual.positiveNode.slice(1).every((r: any) => r.status === 'not_run') && actual.engine.every((r: any) => r.status === 'not_run'))
        }
        verify(row, row.assertions > 0); row.status = 'pass'
      } catch (error) { row.status = 'failed'; row.errorCode = safeCreativeCode(error); throw error }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
}
