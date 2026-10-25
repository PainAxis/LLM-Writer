/** Deterministic evidence-classifier smoke only. Does not launch a browser,
 * access IndexedDB, create a campaign, invoke a provider, or use a network. */
import assert from 'node:assert/strict'
import { CampaignProtocolError } from '../src/services/writerCampaign/protocol'
import { requireCampaignIntegrityRefusal } from './fixtures/writer-campaign-action-proof-browser'

async function main() {
  let passed = 0, invoked = 0
  await requireCampaignIntegrityRefusal(async () => { invoked++; throw new CampaignProtocolError('integrity', 'controlled') }); passed++
  const wrongCodes = ['unsupported_schema', 'conflict', 'operation_conflict', 'budget', 'storage_unknown', 'legacy_read_only'] as const
  const wrongFailures: unknown[] = [new TypeError('controlled'), new Error('controlled'), null, undefined,
    { name: 'CampaignProtocolError', code: 'integrity' }, ...wrongCodes.map(code => new CampaignProtocolError(code, 'controlled'))]
  const closedFailure = (error: unknown) => error instanceof Error && error.message === 'action_proof_boundary_failed'
  for (const failure of wrongFailures) {
    await assert.rejects(requireCampaignIntegrityRefusal(async () => { invoked++; throw failure }), closedFailure); passed++
  }
  await assert.rejects(requireCampaignIntegrityRefusal(async () => { invoked++; return null }), closedFailure); passed++
  assert.equal(invoked, passed)
  console.log(`Campaign action proof browser classifier: ${passed} checks passed; native browser cases NOT_RUN.`)
}
void main().catch(() => { console.error('Campaign action proof browser classifier: failed'); process.exitCode = 1 })
