/* global process, Buffer */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CI_EVIDENCE_GROUPS, REQUEST_PROJECTIONS } from './ci-evidence-files.mjs'
import { destinationFor, prepareEvidence, TEXT_LIMIT } from './prepare-ci-evidence.mjs'
import { CAMPAIGN_REPORT_PATH, CAMPAIGN_STORAGE_REPORT_PATH, CAMPAIGN_CAPACITY_NODE_REPORT_PATH } from './campaign-evidence.mjs'
import { campaignEvidenceCase } from './fixtures/campaign-evidence-case.mjs'
import { campaignStorageEvidenceCase } from './fixtures/campaign-storage-evidence-case.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'llm-ci-evidence-smoke-'))
const script = fileURLToPath(new URL('./prepare-ci-evidence.mjs', import.meta.url))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aun0AAAAASUVORK5CYII=', 'base64')
const secret = 'RAW_MANUSCRIPT_REQUEST_CANARY_DO_NOT_STAGE'
const rawResponse = 'RAW_RESPONSE_CANARY_DO_NOT_STAGE'
const diagnostic = 'SMALL_COMPLETE_BACKUP_CANARY_' + JSON.stringify({ data: { novels: [{ chapterList: [{ content: 'A complete tiny manuscript' }] }] } })
const longDiagnostic = diagnostic + '测'.repeat(20_000)
const body = { model: 'synthetic-model', task: 'retrieval.passage', stream: false, max_tokens: 1200,
  messages: [{ role: 'user', content: secret }], input: [secret, secret], documents: [secret], tools: [],
  unknown: { nested: secret }, unknownString: secret }
const request = { kind: 'collect', profile: 'small', scenario: 'controlled-test', caseId: 'P01', mode: 'ok',
  status: 200, cutoff: 599, novelId: 123, startedAt: 1, durationMs: 3, sourceChars: 77, inputChars: 88,
  inputBytes: 99, sourceCount: 2, candidateCount: 3, responseBytes: 111, body, response: rawResponse,
  rawResponse, hidden: { body }, unknownScalar: secret }
const baseReport = {
  tests: [{ name: 'controlled-test', status: 'failed', durationMs: 4, error: diagnostic }],
  totals: { tests: 1, passed: 0, failed: 1 }, expected: { tests: 2 },
  semantic: [{ caseId: 'P01', validCitations: 2 }],
  longForm: { sourceChars: 1_317_800, journeys: [{ sources: [{ quote: '有限的合成引用证据。' }] }] },
  diagnostics: { bodyText: longDiagnostic, text: diagnostic, body: diagnostic, url: 'http://127.0.0.1/test' },
  error: diagnostic, browserErrors: [diagnostic], fixtureErrors: [diagnostic],
  consoleMessages: [{ type: 'error', text: diagnostic }],
  failure: diagnostic, startupFailure: { code: 'synthetic-error', message: diagnostic },
  groups: [{ scenarios: [{ failure: { code: 'synthetic-error', message: diagnostic }, failureObserved: { statusText: diagnostic, sourceReads: 7 } }] }],
  errors: [diagnostic], errorMessage: diagnostic,
  note: 'n'.repeat(6500),
}
const expectedGroups = {
  'memory-capacity': 5, 'memory-cold-index': 10, 'memory-full-scan': 7, 'memory-support': 5,
  'memory-novel-scan': 4, 'memory-stress': 6, 'memory-browser-stress': 5, 'graph-backup-mobile': 21,
  'writer-memory-browser': 23, 'writer-memory-stress': 3, 'fact-graph-review': 6, browser: 59, 'writer-agent': 4,
  'writer-campaign': 1, 'writer-campaign-storage': 2,
}
// Deliberately couple to this workflow's simple, fixed step layout. A formatting
// change must update this guard instead of silently broadening the upload scope.
function verifyWorkflow(workflow, { groups = Object.keys(CI_EVIDENCE_GROUPS), metadataPaths = [], ciJobs = 13 } = {}) {
  const steps = workflow.split(/(?=^      - )/m).filter(step => step.startsWith('      - '))
  const uploads = steps.map((step, index) => ({ step, index })).filter(({ step }) => /uses: actions\/upload-artifact@/.test(step))
  const expectedUploads = groups.length + metadataPaths.length
  assert.equal(uploads.length, expectedUploads, 'Every artifact upload must be explicitly audited')
  assert.equal((workflow.match(/actions\/upload-artifact/g) || []).length, expectedUploads, 'No extra upload may bypass the guarded layout')
  assert.equal((workflow.match(/run: node scripts\/prepare-ci-evidence\.mjs /g) || []).length, groups.length)
  if (ciJobs !== null) assert.equal((workflow.match(/^  [a-z0-9-]+:\n    name: ci-/gm) || []).length, ciJobs, 'The twelve existing CI jobs plus the separate capacity job remain intact')
  const seen = [], seenMetadata = []
  for (const { step, index } of uploads) {
    const paths = [...step.matchAll(/^          path: (.+)$/gm)]
    assert.equal(paths.length, 1, 'Each upload must have one isolated directory')
    assert.ok(!/^ {12}\S/m.test(step), 'Multiline upload paths are forbidden')
    assert.match(step, /^          if-no-files-found: error$/m)
    if (metadataPaths.includes(paths[0][1])) {
      seenMetadata.push(paths[0][1])
      continue
    }
    const group = paths[0][1].replace('artifacts/ci-evidence/', '')
    assert.ok(Object.hasOwn(CI_EVIDENCE_GROUPS, group), 'Upload must select a known evidence group')
    assert.equal(paths[0][1], `artifacts/ci-evidence/${group}`, 'Raw directories and globs are forbidden')
    const id = `archive_${group.replaceAll('-', '_')}`
    const preparation = steps[index - 1]
    assert.ok(preparation, 'Each upload needs an immediately preceding preparation')
    assert.equal(preparation.match(/^        id: (.+)$/m)?.[1], id)
    assert.equal(preparation.match(/^        run: (.+)$/m)?.[1], `node scripts/prepare-ci-evidence.mjs --group=${group}`)
    assert.equal(preparation.match(/^        if: (.+)$/m)?.[1], '${{ !cancelled() }}')
    assert.equal(step.match(/^        if: (.+)$/m)?.[1], `\${{ !cancelled() && steps.${id}.outcome == 'success' }}`)
    seen.push(group)
  }
  assert.deepEqual(seen.sort(), [...groups].sort(), 'Every approved group is uploaded exactly once')
  assert.deepEqual(seenMetadata.sort(), [...metadataPaths].sort(), 'Only exact approved metadata files may bypass evidence preparation')
}
function verifyAllWorkflows(workflows) {
  assert.ok(workflows.has('ci.yml') && workflows.has('writer-browser-tunnel.yml'))
  for (const [name, workflow] of workflows) {
    if (name === 'ci.yml') verifyWorkflow(workflow)
    else if (name === 'writer-browser-tunnel.yml') verifyWorkflow(workflow, {
      groups: ['browser'], metadataPaths: ['${{ runner.temp }}/preview-url.json'], ciJobs: null,
    })
    else verifyWorkflow(workflow, { groups: [], metadataPaths: [], ciJobs: null })
  }
}
const sources = new Map()
async function put(relative, bytes) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true })
  await writeFile(path.join(root, relative), bytes)
}
async function walk(directory, prefix = '') {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name
    if (entry.isDirectory()) result.push(...await walk(path.join(directory, entry.name), `${relative}/`))
    else { assert.equal(entry.isFile(), true); result.push(relative) }
  }
  return result.sort()
}
async function absent(relative) {
  await assert.rejects(lstat(path.join(root, relative)), { code: 'ENOENT' })
}
async function summary(group, source) {
  return JSON.parse(await readFile(path.join(root, 'artifacts/ci-evidence', group, destinationFor(source)), 'utf8'))
}
try {
  const workflowsDirectory = new URL('../.github/workflows/', import.meta.url)
  const workflows = new Map()
  for (const entry of await readdir(workflowsDirectory, { withFileTypes: true })) {
    if (!/\.ya?ml$/.test(entry.name)) continue
    assert.ok(entry.isFile(), 'Workflow files must not be symlinks or directories')
    workflows.set(entry.name, await readFile(new URL(entry.name, workflowsDirectory), 'utf8'))
  }
  verifyAllWorkflows(workflows)
  const workflow = workflows.get('ci.yml')
  for (const unsafe of [
    workflow.replace('path: artifacts/ci-evidence/memory-capacity', 'path: artifacts/memory-capacity'),
    workflow.replace('path: artifacts/ci-evidence/writer-campaign-storage', 'path: artifacts/browser-writer-campaign-storage'),
    workflow.replace(" && steps.archive_writer_campaign_storage.outcome == 'success'", ''),
    workflow.replace('--group=writer-campaign-storage', '--group=writer-campaign'),
    workflow.replace('--group=memory-capacity', '--group=browser'),
    workflow.replace(" && steps.archive_memory_capacity.outcome == 'success'", ''),
    workflow.replace("!cancelled() && steps.archive_memory_capacity", "true && steps.archive_memory_capacity"),
    workflow.replace('path: artifacts/ci-evidence/memory-capacity', 'path: |\n            artifacts/ci-evidence/memory-capacity\n            artifacts/browser'),
  ]) assert.throws(() => verifyWorkflow(unsafe), 'An unsafe upload mutation must fail the smoke')
  const tunnel = workflows.get('writer-browser-tunnel.yml')
  for (const unsafe of [
    tunnel.replace('path: artifacts/ci-evidence/browser', 'path: artifacts/browser'),
    tunnel.replace(" && steps.archive_browser.outcome == 'success'", ''),
    tunnel.replace('path: ${{ runner.temp }}/preview-url.json', 'path: ${{ runner.temp }}/*'),
    tunnel.replace('path: ${{ runner.temp }}/preview-url.json', 'path: artifacts/browser/report.json'),
  ]) assert.throws(() => verifyAllWorkflows(new Map(workflows).set('writer-browser-tunnel.yml', unsafe)))
  assert.throws(() => verifyAllWorkflows(new Map(workflows).set('future-unreviewed.yml', tunnel)), 'New workflows must not introduce unaudited uploads')
  console.log('✓ Every workflow is checked: 15 CI archives and the tunnel browser archive require successful preparation; only exact preview URL metadata is exempt')
  assert.deepEqual(Object.fromEntries(Object.entries(CI_EVIDENCE_GROUPS).map(([key, values]) => [key, values.length])), expectedGroups)
  for (const allowed of Object.values(CI_EVIDENCE_GROUPS)) {
    assert.equal(new Set(allowed).size, allowed.length)
    for (const source of allowed) {
      assert.match(source, /^artifacts\/[a-z0-9-]+\/(?:paired\/)?[a-z0-9.-]+\.(json|png)$/)
      assert.ok(!source.includes('..') && !/[*?\[\]{}]/.test(source))
      if (sources.has(source)) continue
      let bytes = png
      if (source.endsWith('.json')) {
        const report = source === CAMPAIGN_REPORT_PATH ? campaignEvidenceCase()
          : source === CAMPAIGN_STORAGE_REPORT_PATH ? campaignStorageEvidenceCase('browser-native-idb')
          : source === CAMPAIGN_CAPACITY_NODE_REPORT_PATH ? campaignStorageEvidenceCase('node-injected-atomic-io-not-browser-idb')
          : structuredClone(baseReport)
        for (const [collection, mode] of Object.entries(REQUEST_PROJECTIONS[source] || {})) {
          report[collection] = mode === 'body' ? [body, body] : [request, request]
        }
        bytes = Buffer.from(JSON.stringify(report))
      }
      sources.set(source, bytes)
      await put(source, bytes)
    }
  }
  // Every raw producer directory contains plausible future artifacts. Neither
  // broad directory uploads nor *.json/*.png globs are acceptable substitutes.
  for (const directory of new Set([...sources.keys()].map(source => path.posix.dirname(source)))) {
    for (const name of ['backup.json', 'trace.zip', 'novel.txt', 'unknown.png', '20-dark-mindmap.png', '20-light-mindmap.png']) {
      await put(`${directory}/${name}`, 'EXCLUDED_FULL_EXPORT_CANARY')
    }
  }
  for (const [group, allowed] of Object.entries(CI_EVIDENCE_GROUPS)) {
    const result = await prepareEvidence({ root, group })
    assert.equal(result.reportAvailability, 'all-present')
    assert.deepEqual(result.missing, [])
    const output = path.join(root, 'artifacts/ci-evidence', group)
    assert.deepEqual(await walk(output), ['manifest.json', ...allowed.map(destinationFor)].sort())
    assert.equal(result.files.length, allowed.length)
    for (const entry of result.files) {
      const original = sources.get(entry.source.path)
      assert.equal(entry.source.bytes, original.length)
      assert.equal(entry.source.sha256, sha256(original))
      const bytes = await readFile(path.join(root, entry.destination.path))
      assert.equal(entry.destination.bytes, bytes.length)
      assert.equal(entry.destination.sha256, sha256(bytes))
      if (entry.source.path.endsWith('.png')) { assert.deepEqual(bytes, png); continue }
      const value = JSON.parse(bytes)
      assert.equal(value.evidenceKind, 'derived-not-raw')
      assert.deepEqual(value.source, entry.source)
      assert.equal(value.transformation.policy.classification, 'derived-not-raw')
      if (entry.source.path === CAMPAIGN_REPORT_PATH) {
        assert.equal(value.transformation.closedSchema, 'campaign-browser-foundation-v2')
        assert.deepEqual(value.report, campaignEvidenceCase())
        continue
      }
      if ([CAMPAIGN_STORAGE_REPORT_PATH, CAMPAIGN_CAPACITY_NODE_REPORT_PATH].includes(entry.source.path)) {
        assert.equal(value.transformation.closedSchema, 'campaign-storage-v2')
        const environment = entry.source.path === CAMPAIGN_STORAGE_REPORT_PATH ? 'browser-native-idb' : 'node-injected-atomic-io-not-browser-idb'
        assert.deepEqual(value.report, campaignStorageEvidenceCase(environment))
        continue
      }
      assert.deepEqual(value.report.totals, baseReport.totals)
      assert.deepEqual(value.report.expected, baseReport.expected)
      assert.equal(value.report.tests.length, 1)
      assert.equal(value.report.tests[0].status, 'failed', 'Preparation must never convert failure to pass')
      assert.deepEqual(value.report.semantic, baseReport.semantic)
      assert.deepEqual(value.report.longForm, baseReport.longForm, 'Finite synthetic quotes and evidence counts must survive')
      assert.equal(value.report.note.length, TEXT_LIMIT)
      for (const field of ['bodyText', 'text', 'body']) {
        const diagnosticValue = value.report.diagnostics[field]
        assert.equal(diagnosticValue.kind, 'withheld-diagnostic-text')
        assert.equal(diagnosticValue.originalChars, baseReport.diagnostics[field].length)
        assert.equal(diagnosticValue.sha256, sha256(baseReport.diagnostics[field]))
      }
      assert.equal(value.report.tests[0].error.sha256, sha256(diagnostic))
      assert.equal(value.report.failure.sha256, sha256(diagnostic))
      assert.equal(value.report.startupFailure.message.sha256, sha256(diagnostic))
      assert.equal(value.report.startupFailure.code, 'synthetic-error')
      assert.equal(value.report.groups[0].scenarios[0].failure.message.sha256, sha256(diagnostic))
      assert.equal(value.report.groups[0].scenarios[0].failure.code, 'synthetic-error')
      assert.equal(value.report.groups[0].scenarios[0].failureObserved.statusText.sha256, sha256(diagnostic))
      assert.equal(value.report.groups[0].scenarios[0].failureObserved.sourceReads, 7)
      assert.equal(value.report.errors[0].sha256, sha256(diagnostic))
      assert.equal(value.report.errorMessage.sha256, sha256(diagnostic))
      assert.ok(value.transformation.textFields.some(item => item.path === '/diagnostics/bodyText' && item.retainedChars === 0))
      assert.ok(!bytes.includes(Buffer.from(diagnostic)) && !bytes.includes(Buffer.from(secret)) && !bytes.includes(Buffer.from(rawResponse)))
      for (const [collection, mode] of Object.entries(REQUEST_PROJECTIONS[entry.source.path] || {})) {
        const rows = value.report[collection]
        assert.equal(rows.length, 2)
        for (const row of rows) {
          assert.equal(row.body, undefined); assert.equal(row.response, undefined); assert.equal(row.rawResponse, undefined)
          assert.equal(row.hidden, undefined); assert.equal(row.unknownScalar, undefined)
          assert.equal(row.bodySummary.bytes, Buffer.byteLength(JSON.stringify(body)))
          assert.equal(row.bodySummary.sha256, sha256(JSON.stringify(body)))
          assert.equal(row.bodySummary.messageCount, 1)
          assert.equal(row.bodySummary.inputCount, 2)
          assert.equal(row.bodySummary.documentCount, 1)
          assert.equal(row.bodySummary.model, 'synthetic-model')
          assert.equal(row.bodySummary.unknown, undefined); assert.equal(row.bodySummary.unknownString, undefined)
          if (mode === 'wrapped') {
            assert.equal(row.kind, request.kind); assert.equal(row.sourceCount, 2); assert.equal(row.durationMs, 3)
            assert.equal(row.responseSummary.sha256, sha256(JSON.stringify(rawResponse)))
          } else assert.deepEqual(Object.keys(row), ['bodySummary'])
        }
        assert.ok(value.transformation.requestProjections.some(item => item.path === `/${collection}` && item.originalCount === 2 && item.retainedCount === 2))
      }
    }
  }
  console.log('✓ All 15 groups stage exactly 161 audited entries; backups, traces, unknown files and exported images stay local')
  console.log('✓ All five request schemas retain scalar counters and body hashes without raw bodies/responses; diagnostics withhold even tiny complete backups')

  const group = 'memory-novel-scan'
  const source = 'artifacts/browser-memory-novel-scan/report.json'
  const output = `artifacts/ci-evidence/${group}`
  await put(`${output}/stale-backup.json`, 'STALE_RAW_CANARY')
  await rm(path.join(root, source))
  let result = await prepareEvidence({ root, group })
  assert.equal(result.reportAvailability, 'missing-reports')
  assert.equal(result.missing.find(item => item.path === source).kind, 'report')
  await absent(`${output}/stale-backup.json`)
  await absent(`${output}/${destinationFor(source)}`)
  const missingRoot = await mkdtemp(path.join(root, 'missing-'))
  result = await prepareEvidence({ root: missingRoot, group })
  assert.equal(result.files.length, 0); assert.equal(result.missing.length, CI_EVIDENCE_GROUPS[group].length)
  assert.equal(result.reportAvailability, 'missing-reports')

  // Invalid JSON must remove an earlier successful artifact and publish nothing.
  await put(source, '{"unclosed":')
  const invalid = spawnSync(process.execPath, [script, `--group=${group}`, `--root=${root}`], { encoding: 'utf8' })
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /Invalid JSON report/)
  await absent(output)
  assert.ok(!(await readdir(path.join(root, 'artifacts/ci-evidence'))).some(name => name.startsWith(`.${group}-`)))
  await put(source, JSON.stringify({ tests: [], requests: [{ body: {}, kind: { leak: secret }, sourceCount: { leak: secret }, scenario: 's'.repeat(257), unknown: secret }] }))
  await prepareEvidence({ root, group })
  const metadata = (await summary(group, source)).report.requests[0]
  assert.equal(metadata.kind, undefined); assert.equal(metadata.sourceCount, undefined); assert.equal(metadata.scenario, undefined)
  await put(source, JSON.stringify({ requests: [{ body: 'unexpected raw body string' }] }))
  await assert.rejects(prepareEvidence({ root, group }), /expected a body object/)
  await absent(output)
  await put(source, '[]')
  await assert.rejects(prepareEvidence({ root, group }), /Invalid report root/)
  await absent(output)
  await put(source, sources.get(source))

  // Refuse allowlisted source symlinks, ancestor symlinks and output symlinks.
  const target = 'unchanged-target.json'
  await put(target, sources.get(source))
  await rm(path.join(root, source))
  await symlink(path.join(root, target), path.join(root, source))
  await assert.rejects(prepareEvidence({ root, group }), /Refusing symlink/)
  await absent(output)
  assert.deepEqual(await readFile(path.join(root, target)), sources.get(source))
  await rm(path.join(root, source)); await put(source, sources.get(source))
  const sourceDirectory = path.dirname(path.join(root, source))
  await rm(sourceDirectory, { recursive: true })
  await symlink(path.join(root, 'artifacts/browser-memory-support'), sourceDirectory)
  await assert.rejects(prepareEvidence({ root, group }), /Refusing symlink/)
  await rm(sourceDirectory)
  for (const allowed of CI_EVIDENCE_GROUPS[group]) await put(allowed, sources.get(allowed))
  await symlink(path.join(root, 'artifacts/browser-memory-support'), path.join(root, output))
  await assert.rejects(prepareEvidence({ root, group }), /Refusing symlink/)
  await rm(path.join(root, output))
  await prepareEvidence({ root, group })
  await assert.rejects(prepareEvidence({ root, group: '../browser' }), /Unknown CI evidence group/)
  for (const escape of ['../report.json', 'artifacts/../report.json', '/tmp/report.json', 'artifacts/a/*.json', 'artifacts/a/report.txt', 'artifacts\\a\\report.json']) {
    assert.throws(() => destinationFor(escape), /Unsafe evidence path|Unaudited evidence file type/)
  }
  for (const [name, bytes] of sources) assert.deepEqual(await readFile(path.join(root, name)), bytes, `Source must remain unchanged: ${name}`)
  console.log('✓ Missing/failed/cancelled runs are explicit; invalid reports fail closed, stale output is cleared and source bytes never change')
  console.log('✓ File/directory/output symlinks and path escapes are refused; bounded diagnostics preserve original lengths/hashes')
} finally {
  await rm(root, { recursive: true, force: true })
}
