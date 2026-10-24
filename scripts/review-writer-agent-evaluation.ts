/** Local-only human review workflow. No model calls, keys or manuscript writes.
 * --template --packet /outside/repo/packet.json --output /outside/repo/ratings.json
 * --ratings /outside/repo/ratings.json --packet /outside/repo/packet.json --output /outside/repo/review-summary.json */
import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AgentReviewError, createHumanReviewTemplate, parseReviewJSON, summarizeHumanReview, validateReviewPacket } from './lib/writer-agent-eval-review'
import { loadWriterAgentEvalFixture } from './lib/writer-agent-eval-fixture'

async function readJSON(path: string) {
  const info = await stat(path)
  if (!info.isFile() || info.size > 2_097_152) throw new AgentReviewError('input_file_size')
  return parseReviewJSON(await readFile(path, 'utf8'))
}
try {
  const args = process.argv.slice(2)
  const values = new Map<string, string>()
  let template = false
  for (let at = 0; at < args.length; at++) {
    const flag = args[at]!
    if (flag === '--template' && !template) { template = true; continue }
    if (!['--packet', '--ratings', '--output'].includes(flag) || values.has(flag)
      || !args[at + 1] || args[at + 1]!.startsWith('--')) throw new AgentReviewError('arguments')
    values.set(flag, args[++at]!)
  }
  if (!values.has('--packet') || !values.has('--output') || template === values.has('--ratings')) throw new AgentReviewError('arguments')
  // Neither the detailed packet nor handwritten ratings belong in repository/CI output.
  const root = await realpath(fileURLToPath(new URL('../', import.meta.url)))
  const output = resolve(values.get('--output')!)
  const parent = await realpath(dirname(output))
  const within = relative(root, parent)
  if (!within || (!within.startsWith('..' + '/') && within !== '..' && !isAbsolute(within))) throw new AgentReviewError('output_must_be_outside_repository')
  const packet = await readJSON(values.get('--packet')!)
  validateReviewPacket(packet)
  const { fixture, sha256 } = await loadWriterAgentEvalFixture()
  if (packet.fixtureSha256 !== sha256 || packet.cases.some(row => !fixture.cases.some(item => item.id === row.caseId))) throw new AgentReviewError('fixture_identity')
  const result = template ? createHumanReviewTemplate(packet)
    : summarizeHumanReview(packet, await readJSON(values.get('--ratings')!), { sha256, cases: fixture.cases })
  // Never silently replace the original packet, a prior review, or another output.
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  process.stdout.write(JSON.stringify({ status: 'written', kind: template ? 'local-review-template' : 'source-free-human-review-summary',
    overwrite: false, modelCalls: 0, qualityAutomaticallyScored: false }) + '\n')
} catch (error) {
  process.stderr.write(JSON.stringify({ status: 'failed', category: error instanceof AgentReviewError ? error.category : 'file_or_fixture_error' }) + '\n')
  process.exitCode = 1
}
