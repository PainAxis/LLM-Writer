import type { InjectionKey } from 'vue'
import type { BodyProducerEngine } from '@/types/bodyProducer'

/** Optional app-scoped host capability. This key registers no adapter or grant. */
export const bodyProducerEngineKey: InjectionKey<BodyProducerEngine> = Symbol('body-producer-engine')
