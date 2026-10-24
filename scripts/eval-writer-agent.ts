/** Default command is offline-only. Live mode is an explicit, separately approved
 * invocation with a frozen local plan and one credential line from non-TTY stdin. */
import { readFile, stat } from 'node:fs/promises'
import { loadWriterAgentEvalFixture } from './lib/writer-agent-eval-fixture'
import { EvaluationError, validateCredential, validateLivePlan, parseLivePlanJSON } from './lib/writer-agent-eval-network'
import { runWriterAgentEvaluation, writePrivatePacket, evaluationFailed } from './lib/writer-agent-evaluation'

async function readCredentialLine(): Promise<string> {
  if (process.stdin.isTTY) throw new EvaluationError('invalid_credential')
  let timer: ReturnType<typeof setTimeout> | undefined
  const read = async () => {
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of process.stdin) {
      const buffer = Buffer.from(chunk)
      bytes += buffer.byteLength
      if (bytes > 514) throw new EvaluationError('invalid_credential')
      chunks.push(buffer)
    }
    const raw = Buffer.concat(chunks).toString('utf8')
    if (!/^[^\r\n]+\r?\n$/.test(raw)) throw new EvaluationError('invalid_credential')
    return validateCredential(raw.replace(/\r?\n$/, ''))
  }
  try {
    return await Promise.race([read(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { process.stdin.destroy(); reject(new EvaluationError('invalid_credential')) }, 30_000)
    })])
  } finally { clearTimeout(timer); process.stdin.destroy() }
}
async function main() {
  let live = false, planPath: string | undefined, packetPath: string | undefined
  const seen = new Set<string>()
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!
    if (seen.has(flag)) throw new EvaluationError('invalid_plan')
    seen.add(flag)
    if (flag === '--live') live = true
    else if (flag === '--plan' || flag === '--private-packet') {
      const path = args[++index]
      if (!path || path.startsWith('--')) throw new EvaluationError('invalid_plan')
      if (flag === '--plan') planPath = path
      else packetPath = path
    } else throw new EvaluationError('invalid_plan')
  }
  if (live !== !!planPath) throw new EvaluationError('invalid_plan')
  let plan: unknown, credential: string | undefined
  if (live) {
    const info = await stat(planPath!)
    if (!info.isFile() || info.size > 8_192) throw new EvaluationError('invalid_plan')
    plan = parseLivePlanJSON(await readFile(planPath!, 'utf8'))
    const { fixture, sha256 } = await loadWriterAgentEvalFixture()
    validateLivePlan(plan, sha256, fixture.cases.map(row => row.id))
    // Only after validating the explicit plan. No env, browser, saved key or config lookup.
    credential = await readCredentialLine()
  }
  const result = await runWriterAgentEvaluation(live ? { mode: 'live', livePlan: plan, credential } : { mode: 'mock' })
  credential = undefined
  if (packetPath) await writePrivatePacket(packetPath, result.privatePacket)
  process.stdout.write(`${JSON.stringify(result.publicSummary, null, 2)}\n`)
  // An expected negative control is visible, not rebranded as model quality success.
  if (evaluationFailed(result.publicSummary)) process.exitCode = 1
}
main().catch(error => {
  process.stderr.write(`${JSON.stringify({ schemaVersion: 1, kind: 'writer-agent-evaluation-error', errorCategory: error instanceof EvaluationError ? error.code : 'internal' })}\n`)
  process.exitCode = 1
})
