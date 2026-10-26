/** CI-only host for the actual App/router/CampaignLab, never a production entry. */
import { watch, type App } from 'vue'
import { bodyProducerEngineKey } from '../../src/composables/bodyProducerHost'
import { getCampaignBuildIdentity } from '../../src/services/writerCampaign/buildIdentity'
import { createBodyProducerEngine } from '../../src/services/writerCampaign/bodyProducerEngine'
import { createOfflineSdkBodyProducer } from '../../src/services/writerCampaign/bodyProducerTransport'
import { createProducerCampaignRepository } from '../../src/services/writerCampaign/producerStore'
import { idbCompareAndSwapMany, idbGetMany } from '../../src/services/blobStore'
import type { CampaignRepositoryIO } from '../../src/types/writerCampaign'
import { configureProducerLoopback, producerControlIdentity } from './writer-body-producer-control'

type VerificationHoldMode = 'before_io' | 'after_io'
interface VerificationHold {
  mode: VerificationHoldMode
  progressEvents: number
  minimumVerifiedOperations: number
  maxVerifiedOperations: number
  rawReadCalls: number
  entered: boolean
  released: boolean
  gate: Promise<void>
  release(): void
}
// Test-module-local controls only. They are never attached to window, persisted,
// imported by production main, or used to manufacture results or progress.
let activeControl: { hold: VerificationHold | null; activeOwners(): number } | null = null
export function armBodyProducerVerificationHold(mode: VerificationHoldMode, minimumVerifiedOperations = 0): void {
  if (!activeControl || !['before_io', 'after_io'].includes(mode) || !Number.isSafeInteger(minimumVerifiedOperations)
    || minimumVerifiedOperations < 0 || minimumVerifiedOperations > 2048 || activeControl.hold && !activeControl.hold.released) throw new Error('producer_app_hold_unavailable')
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const hold: VerificationHold = { mode, progressEvents: 0, minimumVerifiedOperations, maxVerifiedOperations: 0, rawReadCalls: 0, entered: false, released: false, gate,
    release() { hold.released = true; release() } }
  activeControl.hold = hold
}
export function releaseBodyProducerVerificationHold(): void { activeControl?.hold?.release() }
export function observeBodyProducerVerificationHold() {
  const hold = activeControl?.hold
  return { armed: Boolean(hold && !hold.released), mode: hold?.mode ?? null, entered: hold?.entered ?? false,
    released: hold?.released ?? false, progressEvents: hold?.progressEvents ?? 0, rawReadCalls: hold?.rawReadCalls ?? 0,
    minimumVerifiedOperations: hold?.minimumVerifiedOperations ?? 0, maxVerifiedOperations: hold?.maxVerifiedOperations ?? 0,
    activeOwners: activeControl?.activeOwners() ?? null }
}

export async function installBodyProducerApp(app: App, endpoint: string): Promise<{ dispose(): void }> {
  if (activeControl) throw new Error('producer_app_host_already_installed')
  const identity = getCampaignBuildIdentity()
  let revision = `app-control-${crypto.randomUUID()}`, disposed = false
  // Construction rejects non-loopback destinations before touching any config.
  const adapter = createOfflineSdkBodyProducer({
    identity: { ...producerControlIdentity(endpoint), configurationRevision: revision },
    currentConfigurationRevision: () => revision,
  })
  await configureProducerLoopback(endpoint)
  const { useApiConfig } = await import('../../src/services/apiConfig')
  const control: NonNullable<typeof activeControl> = { hold: null, activeOwners() {
    const stats = engine.getExecutionStats?.()
    if (!stats) throw new Error('producer_app_owner_observation_unavailable')
    return stats.activeOwners
  } }
  const io: CampaignRepositoryIO = {
    async getMany(keys) {
      const hold = control.hold
      if (hold && !hold.released) hold.rawReadCalls++
      const enter = Boolean(hold && !hold.released && !hold.entered && hold.progressEvents > 0 && hold.maxVerifiedOperations >= hold.minimumVerifiedOperations)
      if (enter && hold!.mode === 'before_io') { hold!.entered = true; await hold!.gate }
      const rows = await idbGetMany(keys)
      if (enter && hold!.mode === 'after_io') { hold!.entered = true; await hold!.gate }
      return rows
    },
    compareAndSwapMany: idbCompareAndSwapMany,
  }
  const engine = createBodyProducerEngine({ identity, repository: createProducerCampaignRepository({ io }), adapters: [adapter] })
  const stopProgress = engine.subscribeVerification?.(event => {
    if (event.status === 'progress' && event.progress && control.hold && !control.hold.released) {
      control.hold.progressEvents++
      control.hold.maxVerifiedOperations = Math.max(control.hold.maxVerifiedOperations, event.progress.verifiedOperations)
    }
  })
  activeControl = control
  const revoke = () => { revision = `app-control-${crypto.randomUUID()}`; engine.cancelLocal() }
  const stop = watch(useApiConfig().activeConfig, revoke, { deep: true, flush: 'sync' })
  const dispose = () => {
    if (disposed) return
    disposed = true; revoke(); stop(); stopProgress?.(); control.hold?.release()
    if (activeControl === control) activeControl = null
  }
  app.provide(bodyProducerEngineKey, engine)
  app.onUnmount(dispose)
  return { dispose }
}
