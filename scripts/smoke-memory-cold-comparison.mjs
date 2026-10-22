/** Exercise report-integrity failures without a long index benchmark. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const directory = await mkdtemp(path.join(os.tmpdir(), 'memory-cold-comparison-'))
const hash = 'a'.repeat(64)
const sourceNames = ['package-lock.json', 'src/services/memory/engine.ts', 'src/services/memory/identifiers.ts',
  'src/services/memory/matchSignals.ts', 'src/services/memory/providers.ts', 'src/services/memory/revision.ts',
  'src/services/memory/tokenScoreIndex.ts']
const operations = ['fixture-generation', 'whole-source-json-clone', 'whole-source-structured-clone',
  'independent-all-chapter-hashes', 'cold-full-sync', 'unchanged-sync', 'retained-baseline-recovery',
  'old-chapter-incremental-sync', 'new-instance-full-recovery']
const baselineCommit = '7739cb0f6d020e4e05d0bff8d9d18f59f3d903c0'
function fixture(candidate, position) {
  return {
    status: 'passed', profile: 'million', label: `${candidate ? 'candidate' : 'baseline'}-${position}`,
    startedAt: new Date(position * 2000).toISOString(), finishedAt: new Date(position * 2000 + 1000).toISOString(),
    engineCommit: candidate ? 'b'.repeat(40) : baselineCommit, engineWorkingTreeChanged: false,
    implementationHashes: Object.fromEntries(sourceNames.map(name => [name, name.endsWith('tokenScoreIndex.ts') ? candidate ? hash : null
      : name.endsWith('engine.ts') && candidate ? 'b'.repeat(64) : hash])),
    harnessHashes: { script: hash, fixture: hash, revision: hash }, initialSourceHash: hash,
    environment: { node: 'synthetic', cpu: 'synthetic', explicitGc: true, loadAverage: [position, 0, 0] },
    fixture: { fixtureVersion: 2, description: 'Synthetic comparator unit fixture, not a benchmark measurement' },
    networkAttempts: 0, sourceGuardChecks: 0, exactSourceChecks: 720,
    provider: { requestsCount: 0, requests: [], passageItems: 0, queryItems: 0 }, memory: {},
    phases: operations.map(operation => ({ operation, wallMs: candidate ? 200 : 10, cpuUserMs: 1, cpuSystemMs: 0,
      heapBeforeMiB: 1, heapAfterMiB: 2, rssBeforeMiB: 3, rssAfterMiB: 4, processMaxRssMiB: 4,
      fingerprint: hash, work: { insertedDocuments: 10 } })),
    searches: Array.from({ length: 240 }, (_, i) => ({ operation: i < 24 ? 'test:natural-query' : i < 40 ? 'test:known-unanswered' : 'test:identifier',
      query: `query-${i}`, searchMs: 1, resultSha256: hash, assessment: { answerability: 'unverified' }, hitIds: [`hit-${i}`] })),
  }
}
const files = [0, 1, 2, 3].map(i => path.join(directory, `${i}.json`))
const output = path.join(directory, 'comparison.json')
async function check(name, mutation, valid = false) {
  const reports = [fixture(false, 0), fixture(true, 1), fixture(true, 2), fixture(false, 3)]
  mutation(reports)
  await Promise.all(reports.map((report, i) => writeFile(files[i], JSON.stringify(report))))
  const result = spawnSync(process.execPath, ['scripts/compare-memory-cold-index.mjs', `--baseline=${files[0]}`, `--baseline=${files[3]}`,
    `--candidate=${files[1]}`, `--candidate=${files[2]}`, `--output=${output}`], { encoding: 'utf8' })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  if (valid) {
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.status, 'passed')
    assert.equal(report.phases[0].medianChangePercent, 1900, 'Slower samples must be retained, not rejected or hidden')
  } else assert.notEqual(result.status, 0, `${name} must be rejected`)
  console.log(`✓ ${name}`)
}
try {
  await check('Equivalent reports pass even when all candidate timings regress', () => {}, true)
  await check('Incomplete report', rows => { rows[1].status = 'running' })
  await check('Dirty production source', rows => { rows[1].engineWorkingTreeChanged = true })
  await check('Changed provider dependency', rows => { rows[1].implementationHashes['src/services/memory/providers.ts'] = 'b'.repeat(64) })
  await check('Omitted dependency in every report', rows => { for (const row of rows) delete row.implementationHashes['package-lock.json'] })
  await check('Different implementation within one variant', rows => { rows[2].engineCommit = 'c'.repeat(40) })
  await check('Changed fixture', rows => { rows[2].fixture.fixtureVersion = 3 })
  await check('Changed harness', rows => { rows[1].harnessHashes.script = 'c'.repeat(64) })
  await check('Changed machine', rows => { rows[1].environment.cpu = 'other' })
  await check('Overlapping ABBA runs', rows => { rows[2].startedAt = rows[1].startedAt })
  await check('Changed source fingerprint', rows => { rows[1].phases[4].fingerprint = 'changed' })
  await check('Skipped index work', rows => { rows[2].phases[4].work.insertedDocuments-- })
  await check('Changed complete returned result hash', rows => { rows[1].searches[0].resultSha256 = 'b'.repeat(64) })
  await check('Changed hit order', rows => { rows[1].searches[0].hitIds = ['different'] })
  await check('Changed answerability', rows => { rows[1].searches[0].assessment.answerability = 'verified' })
  await check('Omitted query in every report', rows => { for (const row of rows) row.searches.pop() })
  await check('Hidden provider request', rows => { rows[1].provider.requests.push({ items: 1 }) })
  await check('Unexpected network attempt', rows => { rows[1].networkAttempts = 1 })
  await check('Invalid timing', rows => { rows[1].phases[4].wallMs = -1 })
} finally {
  await rm(directory, { recursive: true, force: true })
}
