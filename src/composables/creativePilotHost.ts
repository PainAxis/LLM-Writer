import type { InjectionKey } from 'vue'
import type { CreativeRepository, CreativeProgressEvent } from '@/types/creativePilot'
import type { CreativeOfflineHost } from '@/services/writerCampaign/creativePilotTransport'

/** Optional app-local capabilities. Normal main supplies neither key.
 * A key, saved descriptor or repository never registers a transport or grant. */
export const creativePilotHostKey: InjectionKey<CreativeOfflineHost> = Symbol('creative-pilot-offline-host')
export const creativePilotRepositoryKey: InjectionKey<CreativeRepository> = Symbol('creative-pilot-repository')
/** Read-only observer; never a command, engine replacement or runtime grant. */
export const creativePilotProgressObserverKey: InjectionKey<(event: Readonly<CreativeProgressEvent>) => void> = Symbol('creative-pilot-progress-observer')
