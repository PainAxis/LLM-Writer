/** Compare the cold-index scoring optimization without weakening retrieval contracts. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const values = name => process.argv.filter(value => value.startsWith(`--${name}=`)).map(value => value.slice(name.length + 3))
const argument = (name, fallback) => values(name).at(-1) ?? fallback
const baselineCommit = argument('baseline-commit', '7739cb0f6d020e4e05d0bff8d9d18f59f3d903c0')
const output = path.resolve(argument('output', 'artifacts/memory-cold-index/comparison.json'))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const round = value => Number(value.toFixed(3))
const changedFiles = ['src/services/memory/engine.ts', 'src/services/memory/tokenScoreIndex.ts'].sort()
const sourceFiles = ['package-lock.json', 'src/services/memory/engine.ts', 'src/services/memory/identifiers.ts',
  'src/services/memory/matchSignals.ts', 'src/services/memory/providers.ts', 'src/services/memory/revision.ts',
  'src/services/memory/tokenScoreIndex.ts'].sort()
const environmentIdentity = ({ loadAverage: _load, ...identity }) => identity
const immutablePhase = phase => Object.fromEntries(Object.entries(phase).filter(([key]) =>
  !['wallMs', 'cpuUserMs', 'cpuSystemMs', 'heapBeforeMiB', 'heapAfterMiB', 'rssBeforeMiB', 'rssAfterMiB', 'processMaxRssMiB', 'engineBuildMs'].includes(key)))
const immutableQuery = ({ searchMs: _searchMs, ...query }) => query
const median = input => {
  const sorted = [...input].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const summary = values => ({ count: values.length, median: round(median(values)), min: Math.min(...values), max: Math.max(...values), observations: values })

async function readInputs(name, kind) {
  const files = values(name)
  assert.equal(files.length, 2, `Exactly two --${name} reports are required for ABBA`)
  return Promise.all(files.map(async filename => {
    const raw = await readFile(filename, 'utf8')
    return { file: path.resolve(filename), sha256: sha256(raw), kind, report: JSON.parse(raw) }
  }))
}
const inputs = [...await readInputs('baseline', 'A'), ...await readInputs('candidate', 'B')]
assert.equal(new Set(inputs.map(input => input.file)).size, 4, 'Each run must be a distinct report')
inputs.sort((a, b) => Date.parse(a.report.startedAt) - Date.parse(b.report.startedAt))
assert.equal(inputs.map(input => input.kind).join(''), 'ABBA', 'Runs must use ABBA order')
const first = inputs[0].report
const candidate = inputs.find(input => input.kind === 'B').report
assert.match(baselineCommit, /^[a-f0-9]{40}$/)
assert.ok(['million', 'ten-million'].includes(first.profile), 'This comparator only covers local index profiles')
assert.deepEqual(Object.keys(first.implementationHashes).sort(), sourceFiles, 'The complete production dependency manifest is required')
assert.deepEqual(Object.keys(candidate.implementationHashes).sort(), sourceFiles)
assert.deepEqual(Object.keys(first.harnessHashes).sort(), ['fixture', 'revision', 'script'])
assert.equal(first.environment.explicitGc, true)
assert.match(candidate.engineCommit, /^[a-f0-9]{40}$/)
assert.deepEqual(Object.keys(first.implementationHashes).filter(key => first.implementationHashes[key] !== candidate.implementationHashes[key]).sort(), changedFiles,
  'The measured optimization changes only the engine component wiring and token-score component')
assert.equal(first.implementationHashes['src/services/memory/tokenScoreIndex.ts'], null)
assert.match(candidate.implementationHashes['src/services/memory/tokenScoreIndex.ts'], /^[a-f0-9]{64}$/)
assert.deepEqual(first.phases.map(phase => phase.operation), ['fixture-generation', 'whole-source-json-clone',
  'whole-source-structured-clone', 'independent-all-chapter-hashes', 'cold-full-sync', 'unchanged-sync',
  'retained-baseline-recovery', 'old-chapter-incremental-sync', 'new-instance-full-recovery'])
assert.equal(first.searches.length, 240, 'The fixed workload must retain every query')
assert.equal(first.searches.filter(query => query.operation.endsWith(':natural-query')).length, 24)
assert.equal(first.searches.filter(query => query.operation.endsWith(':known-unanswered')).length, 16)
assert.ok(Number.isSafeInteger(first.exactSourceChecks) && first.exactSourceChecks > 0)
const immutableQueries = first.searches.map(immutableQuery)
let previousEnd = 0
for (const { report, kind, file } of inputs) {
  const name = path.basename(file)
  const start = Date.parse(report.startedAt)
  const end = Date.parse(report.finishedAt)
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && end >= start && start >= previousEnd, `${name}: overlapping or invalid run times`)
  previousEnd = end
  assert.equal(report.status, 'passed', `${name}: incomplete or failed run`)
  assert.equal(report.profile, first.profile)
  assert.equal(report.engineWorkingTreeChanged, false, `${name}: dirty production source`)
  assert.equal(report.engineCommit, kind === 'A' ? baselineCommit : candidate.engineCommit)
  assert.deepEqual(report.implementationHashes, kind === 'A' ? first.implementationHashes : candidate.implementationHashes)
  assert.deepEqual(report.harnessHashes, first.harnessHashes)
  assert.deepEqual(environmentIdentity(report.environment), environmentIdentity(first.environment))
  assert.deepEqual(report.fixture, first.fixture)
  assert.equal(report.initialSourceHash, first.initialSourceHash)
  assert.equal(report.networkAttempts, 0)
  assert.equal(report.sourceGuardChecks, 0)
  assert.equal(report.exactSourceChecks, first.exactSourceChecks)
  assert.equal(report.provider.requestsCount, 0)
  assert.deepEqual(report.provider.requests, [])
  assert.equal(report.provider.passageItems, 0)
  assert.equal(report.provider.queryItems, 0)
  assert.deepEqual(report.phases.map(immutablePhase), first.phases.map(immutablePhase), `${name}: source, work or fingerprint changed`)
  assert.deepEqual(report.searches.map(immutableQuery), immutableQueries, `${name}: result, ranking, scores, source or assessment changed`)
  for (const query of report.searches) {
    assert.match(query.resultSha256, /^[a-f0-9]{64}$/, `${name}: full result including returned scores must be hashed`)
    assert.equal(query.assessment.answerability, 'unverified')
    assert.ok(Number.isFinite(query.searchMs) && query.searchMs >= 0, `${name}: invalid search timing`)
  }
  for (const phase of report.phases) {
    for (const field of ['wallMs', 'cpuUserMs', 'cpuSystemMs', 'heapBeforeMiB', 'heapAfterMiB', 'rssBeforeMiB', 'rssAfterMiB', 'processMaxRssMiB']) {
      assert.ok(Number.isFinite(phase[field]) && phase[field] >= 0, `${name}: invalid ${field}`)
    }
  }
}
const grouped = kind => inputs.filter(input => input.kind === kind).map(input => input.report)
const phaseSummaries = first.phases.map((phase, position) => {
  const baseline = summary(grouped('A').map(report => report.phases[position].wallMs))
  const optimized = summary(grouped('B').map(report => report.phases[position].wallMs))
  return { ...immutablePhase(phase), baseline, candidate: optimized,
    medianChangePercent: baseline.median ? round((optimized.median / baseline.median - 1) * 100) : null,
    observations: inputs.map(({ kind, report }) => ({ kind, label: report.label, ...report.phases[position] })) }
})
const result = {
  schemaVersion: 1, status: 'passed', scope: 'Single-pass token-score accounting; unchanged tokenization, source validation and ranking',
  profile: first.profile, order: 'ABBA', baselineCommit, candidateCommit: candidate.engineCommit,
  environment: environmentIdentity(first.environment), fixture: first.fixture, initialSourceHash: first.initialSourceHash,
  implementationHashes: { baseline: first.implementationHashes, candidate: candidate.implementationHashes }, harnessHashes: first.harnessHashes,
  reports: inputs.map(({ kind, file, sha256, report }) => ({ kind, file: path.basename(file), sha256,
    startedAt: report.startedAt, finishedAt: report.finishedAt, loadAverage: report.environment.loadAverage, memory: report.memory })),
  validation: { comparedRuns: 4, queriesPerRun: first.searches.length, exactSourceChecksPerRun: first.exactSourceChecks,
    sameCompleteResultsIncludingScores: true, sameSourcesFingerprintsAndIndexWork: true, sameConservativeAssessments: true, networkAttempts: 0 },
  phases: phaseSummaries, referenceQueries: immutableQueries,
  notes: [
    'Two independent processes per implementation, sequential ABBA on one runner. No machine-dependent timing pass threshold and no percentile claim.',
    'Queries include exact identifiers, mixed Chinese, author clues, natural questions, known unanswered questions, old-fact exclusion and disclosure boundaries. Existing misses are retained.',
    'Result hashes cover the complete result except searchMs, including evidence, exact ranges, revisions, ordering, returned fusion scores, reasons, diagnostics and assessments. Raw Orama BM25 state and scores are compared independently by smoke:memory-token-scores.',
    'CPU/RSS/heap observations include instrumentation and the complete process. They are not isolated retained-index memory; endpoint and interval sampling can miss synchronous peaks.',
    'Node engine measurements exclude browser storage, Worker transfer, rendering and live model latency. Product browser and stress suites are separate acceptance evidence.',
    'The baseline is fixed for this scoring experiment. The earlier hydration ABBA experiment remains pinned to its own unchanged production pair.',
  ],
}
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
console.log(`Cold-index comparison passed: ${first.profile}, 4 runs, ${first.searches.length} queries and ${first.exactSourceChecks} source checks per run; ${output}`)
