/** Single-use fresh-process read. Private raw rows arrive only over IPC, never evidence files. */
import { createCreativePilotRepository } from '../../src/services/writerCampaign/creativePilotStore'
import { createCreativeMemoryIO } from './creative-pilot-io'
import { controlAssert } from './creative-pilot-oracles'
import { verifyCreativeFinalFence } from './creative-pilot-runner'
import { safeCreativeCode } from './creative-pilot-report'
globalThis.fetch = async () => { throw new Error('creative_cold_network_disabled') }
process.once('message', async (message: { campaignId: string; rows: Array<[string, string]> }) => {
  try {
    controlAssert(message && Array.isArray(message.rows) && message.rows.length <= 173)
    const memory = createCreativeMemoryIO(new Map(message.rows)), repo = createCreativePilotRepository({ io: memory.io }), before = new Map(memory.rows)
    memory.beginTrace(); const started = performance.now(), snapshot = await repo.read(message.campaignId), elapsedMs = performance.now() - started
    const fence = verifyCreativeFinalFence(before, message.campaignId, memory.endTrace())
    controlAssert(snapshot && fence && elapsedMs < 10000 && memory.observe().maxRawIoMs < 3000 && memory.observe().successfulCas === 0)
    process.send?.({ status: 'pass', checkpointHash: snapshot.checkpoint.hash, elapsedMs, fence, io: memory.observe(), httpAttempts: 0 }); process.disconnect?.()
  } catch (error) { process.send?.({ status: 'failed', code: safeCreativeCode(error) }); process.disconnect?.(); process.exitCode = 1 }
})
