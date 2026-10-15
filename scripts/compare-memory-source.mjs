/** Compare unchanged-source browser work before/after transaction batching. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const argumentsFor = name => process.argv.filter(value => value.startsWith(`--${name}=`)).map(value => value.slice(name.length + 3))
const argument = (name, fallback) => argumentsFor(name).at(-1) ?? fallback
const output = path.resolve(argument('output', 'artifacts/memory-capacity/comparison.json'))
const baselineCommit = argument('baseline-commit', '760042683405760428688d1a7d7f0346e2ff77d3')
const expectedOrder = argument('order', 'ABBA')
assert.match(baselineCommit, /^[0-9a-f]{40}$/)
assert.equal(expectedOrder, 'ABBA', 'This comparison requires two runs per implementation, in ABBA order')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const rounded = value => Number(value.toFixed(3))
const caseKey = scenario => `${scenario.profile}/unrelated-${scenario.unrelatedNovels}`
const changedSourceFile = 'src/services/novelPersistence.ts'
const environmentIdentity = ({ loadAverage: _loadAverage, ...identity }) => identity
const immutableMeasurement = ({ durationMs: _durationMs, heapBeforeBytes: _heapBeforeBytes, heapAfterBytes: _heapAfterBytes, io: _io, ...immutable }) => immutable
const transactionFields = new Set(['transactions', 'readonlyTransactions'])
const immutableIo = io => Object.fromEntries(Object.entries(io).filter(([key]) => !transactionFields.has(key)))

async function inputFiles(input) {
  const resolved = path.resolve(input)
  if (!(await stat(resolved)).isDirectory()) return [{ file: resolved, explicit: true }]
  const files = []
  for (const entry of await readdir(resolved, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...await inputFiles(path.join(resolved, entry.name)))
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push({ file: path.join(resolved, entry.name), explicit: false })
  }
  return files
}
async function loadInputs(name, kind) {
  const inputs = argumentsFor(name)
  assert.ok(inputs.length, `At least one --${name}=report.json or directory is required`)
  const files = (await Promise.all(inputs.map(inputFiles))).flat()
  const reports = []
  for (const { file, explicit } of files) {
    const raw = await readFile(file, 'utf8')
    const report = JSON.parse(raw)
    const isSourceReport = report.schemaVersion === 1 && report.sourceHashes && report.harnessHashes && Array.isArray(report.scenarios)
    if (!isSourceReport && !explicit) continue
    assert.ok(isSourceReport, `Not a browser source report: ${file}`)
    reports.push({ file, kind, report, sha256: sha256(raw) })
  }
  assert.equal(reports.length, 2, `ABBA needs exactly two ${name} reports`)
  return reports
}

function validateIo(measurement, splitChapters, kind, context) {
  const { io } = measurement
  const expectedKeys = ['bodyGets', 'bodyReturnedChars', 'gets', 'graphGets', 'readonlyTransactions', 'readwriteTransactions', 'returnedChars', 'transactions']
  assert.deepEqual(Object.keys(io).sort(), expectedKeys, `${context}: counter fields changed`)
  for (const [name, value] of Object.entries(io)) assert.ok(Number.isSafeInteger(value) && value >= 0, `${context}: invalid ${name}`)
  assert.equal(io.readwriteTransactions, 0, `${context}: measured source checks must not write storage`)
  assert.equal(io.gets, io.bodyGets + io.graphGets, `${context}: unexpected or omitted reads`)
  assert.equal(io.transactions, io.readonlyTransactions, `${context}: transaction accounting differs`)
  assert.equal(io.bodyGets % splitChapters, 0, `${context}: source read skipped or duplicated body requests`)
  const sourceReads = io.bodyGets / splitChapters
  assert.equal(io.readonlyTransactions, kind === 'A' ? io.bodyGets + io.graphGets : sourceReads + io.graphGets,
    `${context}: expected one baseline transaction per body, one candidate transaction per full hydration, and unchanged graph reads`)
  if (measurement.sourceReads !== undefined) assert.equal(measurement.sourceReads, sourceReads, `${context}: guard/read count changed`)
  if (!io.gets) assert.equal(io.returnedChars, 0, `${context}: returned characters without requests`)
  if (!io.bodyGets) assert.equal(io.bodyReturnedChars, 0, `${context}: body characters without body requests`)
  assert.ok(io.returnedChars >= io.bodyReturnedChars, `${context}: body chars exceed total chars`)
  assert.ok(Number.isFinite(measurement.durationMs) && measurement.durationMs >= 0, `${context}: invalid duration`)
  for (const key of ['heapBeforeBytes', 'heapAfterBytes']) assert.ok(measurement[key] === null || (Number.isSafeInteger(measurement[key]) && measurement[key] >= 0), `${context}: invalid heap observation`)
}

const files = [...await loadInputs('baseline', 'A'), ...await loadInputs('candidate', 'B')]
assert.equal(new Set(files.map(input => input.file)).size, 4, 'A report cannot be used more than once')
files.sort((left, right) => Date.parse(left.report.startedAt) - Date.parse(right.report.startedAt))
assert.equal(files.map(input => input.kind).join(''), expectedOrder, 'Run timestamps must demonstrate ABBA order')
const first = files[0].report
const baselineSources = first.sourceHashes
const candidateSources = files.find(input => input.kind === 'B').report.sourceHashes
assert.deepEqual(Object.keys(baselineSources).sort(), Object.keys(candidateSources).sort(), 'Production dependency manifests differ')
assert.deepEqual(Object.keys(baselineSources).filter(file => baselineSources[file] !== candidateSources[file]), [changedSourceFile],
  'Only novelPersistence.ts may differ in this focused optimization')
const expectedCases = ['million/unrelated-0', 'million/unrelated-1', 'ten-million/unrelated-0', 'ten-million/unrelated-1']
const referenceCases = new Map(first.scenarios.map(scenario => [caseKey(scenario), scenario]))
const cases = new Map()
let comparedMeasurements = 0
let comparedSamples = 0
let comparedEvidence = 0
let previousEnd = 0

for (const [run, input] of files.entries()) {
  const { report, kind } = input
  const context = `${kind}${run + 1} ${path.basename(input.file)}`
  const start = Date.parse(report.startedAt)
  const end = Date.parse(report.finishedAt)
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && end >= start && start >= previousEnd, `${context}: runs overlap or have invalid timestamps`)
  previousEnd = end
  assert.equal(report.status, 'passed', `${context}: source measurement did not pass`)
  assert.equal(report.sourceWorkingTreeChanged, false, `${context}: source checkout was dirty`)
  assert.equal(report.sourceCommit, kind === 'A' ? baselineCommit : files.find(file => file.kind === 'B').report.sourceCommit, `${context}: source commit changed`)
  assert.deepEqual(report.sourceHashes, kind === 'A' ? baselineSources : candidateSources, `${context}: production dependency hashes changed`)
  assert.deepEqual(report.harnessHashes, first.harnessHashes, `${context}: harness or fixture generator changed`)
  assert.deepEqual(environmentIdentity(report.environment), environmentIdentity(first.environment), `${context}: browser/Node/hardware environment differs`)
  assert.deepEqual(report.blockedRequests, [], `${context}: external request attempted`)
  assert.deepEqual(report.browserErrors, [], `${context}: browser errors present`)
  assert.equal(report.samples, 3, `${context}: expected three new-page source samples`)
  assert.deepEqual(report.scenarios.map(caseKey).sort(), expectedCases, `${context}: missing/duplicate fixture cases`)

  for (const scenario of report.scenarios) {
    const key = caseKey(scenario)
    const reference = referenceCases.get(key)
    const scenarioContext = `${context} ${key}`
    assert.deepEqual(scenario.fixture, reference.fixture, `${scenarioContext}: immutable fixture/source hashes differ`)
    assert.deepEqual(scenario.seed, reference.seed, `${scenarioContext}: committed collection size differs`)
    assert.equal(scenario.seed.novels, 1 + scenario.unrelatedNovels, `${scenarioContext}: unrelated novel coverage differs`)
    assert.equal(scenario.seed.splitChapters, scenario.fixture.splitChapters * scenario.seed.novels, `${scenarioContext}: split body count differs`)
    assert.ok(scenario.seed.splitChapters > 1, `${scenarioContext}: fixture does not exercise transaction batching`)
    assert.equal(scenario.samples.length, 3, `${scenarioContext}: missing new-page source samples`)
    if (!cases.has(key)) cases.set(key, { profile: scenario.profile, unrelatedNovels: scenario.unrelatedNovels, fixture: scenario.fixture, seed: scenario.seed, phases: new Map() })
    const resultCase = cases.get(key)

    for (const [sampleIndex, sample] of scenario.samples.entries()) {
      const referenceSample = reference.samples[sampleIndex]
      const sampleContext = `${scenarioContext} sample ${sampleIndex}`
      assert.equal(sample.sample, sampleIndex, `${sampleContext}: missing/reordered sample`)
      assert.deepEqual(sample.validation, referenceSample.validation, `${sampleContext}: source, disclosure or validation work changed`)
      assert.equal(sample.validation.sourceSha256, scenario.fixture.sourceSha256, `${sampleContext}: read source differs from fixture`)
      assert.equal(sample.validation.chapterRevisionChecks, scenario.fixture.chapters, `${sampleContext}: incomplete chapter validation`)
      assert.equal(sample.validation.convertedChapterChecks, scenario.fixture.chapters, `${sampleContext}: incomplete conversion validation`)
      const expectedWriter = scenario.profile === 'million' && sampleIndex < 2
      assert.equal(!!sample.writer, expectedWriter, `${sampleContext}: Writer coverage changed`)
      comparedSamples++

      function compareSequence(measurements, originals, scope) {
        assert.equal(measurements.length, originals.length, `${sampleContext} ${scope}: phase/call count changed`)
        for (const [call, measurement] of measurements.entries()) {
          const original = originals[call]
          const phaseContext = `${sampleContext} ${scope} ${call} ${measurement.operation}`
          validateIo(measurement, scenario.seed.splitChapters, kind, phaseContext)
          assert.deepEqual(immutableMeasurement(measurement), immutableMeasurement(original), `${phaseContext}: evidence, selection, assessment or validation work changed`)
          assert.deepEqual(immutableIo(measurement.io), immutableIo(original.io), `${phaseContext}: reads, returned characters or graph checks changed`)
          const phaseKey = scope === 'nested' ? `nested.${measurement.operation}` : measurement.operation
          if (!resultCase.phases.has(phaseKey)) resultCase.phases.set(phaseKey, { operation: phaseKey, baseline: [], candidate: [] })
          resultCase.phases.get(phaseKey)[kind === 'A' ? 'baseline' : 'candidate'].push({
            run: run + 1, label: report.label, sample: sampleIndex, call, durationMs: measurement.durationMs,
            io: measurement.io, ...(measurement.sourceReads !== undefined ? { sourceReads: measurement.sourceReads } : {}),
            heapBeforeBytes: measurement.heapBeforeBytes, heapAfterBytes: measurement.heapAfterBytes,
          })
          comparedMeasurements++
          comparedEvidence += measurement.evidence?.length ?? 0
        }
      }
      compareSequence(sample.measurements, referenceSample.measurements, 'source')
      if (expectedWriter) {
        assert.equal(sample.writer.totalSourceReads, referenceSample.writer.totalSourceReads, `${sampleContext}: Writer source guard count changed`)
        assert.equal(sample.writer.nestedCalls.filter(call => call.operation === 'writer.committedSourceRead').length, sample.writer.totalSourceReads, `${sampleContext}: nested source accounting incomplete`)
        compareSequence(sample.writer.measurements, referenceSample.writer.measurements, 'writer')
        compareSequence(sample.writer.nestedCalls, referenceSample.writer.nestedCalls, 'nested')
      }
    }
  }
}

function summarize(samples) {
  const values = samples.map(sample => sample.durationMs).sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2
  return { count: values.length, medianMs: rounded(median), minMs: values[0], maxMs: values.at(-1) }
}
const result = {
  schemaVersion: 1, status: 'passed', order: expectedOrder, baselineCommit,
  candidateCommit: files.find(input => input.kind === 'B').report.sourceCommit,
  createdAt: new Date().toISOString(), environment: environmentIdentity(first.environment),
  sourceHashes: { baseline: baselineSources, candidate: candidateSources }, harnessHashes: first.harnessHashes,
  reports: files.map((input, index) => ({ run: index + 1, implementation: input.kind === 'A' ? 'baseline' : 'candidate', label: input.report.label,
    file: path.relative(path.dirname(output), input.file), sha256: input.sha256, startedAt: input.report.startedAt, finishedAt: input.report.finishedAt, loadAverage: input.report.environment.loadAverage })),
  validation: { comparedSamples, comparedMeasurements, comparedEvidence, changedProductionFiles: [changedSourceFile],
    sameSourceAndDisclosure: true, sameEvidenceAndSelection: true, sameReadAndGuardCounts: true, sameReturnedCharacters: true,
    baselineTransactionsPerHydration: 'one per split body', candidateTransactionsPerHydration: 1, graphReadsUnchanged: true },
  cases: [...cases.values()].map(({ phases, ...scenario }) => ({ ...scenario, phases: [...phases.values()].map(phase => {
    const baseline = summarize(phase.baseline)
    const candidate = summarize(phase.candidate)
    return { operation: phase.operation, baseline, candidate, medianChangeMs: rounded(candidate.medianMs - baseline.medianMs),
      medianChangePercent: baseline.medianMs > 0 ? rounded((candidate.medianMs / baseline.medianMs - 1) * 100) : null,
      samples: { baseline: phase.baseline, candidate: phase.candidate } }
  }) })),
  notes: [
    'All wall-clock observations are retained, including regressions. No timing pass threshold or percentile claim is used; positive median change means slower.',
    'Each implementation has two ABBA runs and three fresh-page source samples per case. Writer cold and new-page-restore each have one observation per run; repeated nested source reads are correlated calls, not independent trials.',
    'Matching browser/Node/hardware fields and non-overlapping ABBA timestamps are checked. The CI job enforces one runner; these metadata fields alone are not a unique physical-machine identity.',
    'Immutable novel/source digests and metadata character/body counts are compared. Random contentRef UUID values are intentionally not identities; all source bytes and read counts must remain unchanged.',
    'Only transaction batching changes: source requests and returned characters, current-revision/disclosure validation, evidence, conservative assessments, selected prompt hashes, and all source/graph checks match.',
    'Source and Writer phase durations overlap by design and must not be summed. Heap snapshots are observations, not peak browser memory or retained-cache size.',
  ],
}
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
process.stdout.write(`Source comparison passed: ${comparedSamples} samples, ${comparedMeasurements} measurements; ${output}\n`)
