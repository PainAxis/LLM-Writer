/** Serial Node profile only. No browser launch; stop after the first failed gate. */
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createProducerMemoryIO } from './fixtures/writer-body-producer-io'
import { runProducerProfile } from './fixtures/writer-body-producer-profile'
import { emptyProducerReport, producerReportExitCode, safeProducerCode, validateProducerReport } from './fixtures/writer-body-producer-report'
import { producerIdentity, producerIdentityMatches } from './fixtures/writer-body-producer-identity.mjs'
import { createProducerNodeServer } from './fixtures/writer-body-producer-node-server'
const root = fileURLToPath(new URL('../', import.meta.url)), target = path.join(root, 'artifacts/writer-body-producer/node-summary.json')
const provenance = await producerIdentity(root), report = emptyProducerReport(provenance.source, 'node')
const persist = async () => { validateProducerReport(report); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, `${JSON.stringify(report, null, 2)}\n`) }
await persist()
try {
  for (const [index, language] of (['zh', 'en'] as const).entries()) {
    const control = await createProducerNodeServer(), storage = createProducerMemoryIO()
    try {
      report.profiles[index] = await runProducerProfile({ language, platform: 'node', identity: provenance.identity, io: storage.io, observeIo: storage.observe, adapter: control.adapter, observeHttp: control.observeHttp,
        onProgress: async row => { report.profiles[index] = row; await persist() } })
      await persist(); console.log(JSON.stringify({ suite: 'body-producer-node', language, status: report.profiles[index]!.status, requests: report.profiles[index]!.metrics.producerRequests, semanticAcceptance: 'NOT_RUN' }))
    } finally { await control.close() }
    if (report.profiles[index]!.status !== 'pass') break
  }
  report.teardown = 'pass'
} catch (error) { report.teardown = 'fail'; console.error(JSON.stringify({ suite: 'body-producer-node', code: safeProducerCode(error) })) }
finally { report.sourceStable = await producerIdentityMatches(root, report.source) ? 'verified' : 'changed'; await persist(); process.exitCode = producerReportExitCode(report) }
