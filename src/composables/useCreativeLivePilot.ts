import { shallowRef, ref, markRaw } from 'vue'
import type { CreativeBriefV1, CreativeLanguage, CreativeLiveGrantV1, CreativePilotEngine, CreativeRepository, CreativeRuntimeIdentity } from '@/types/creativePilot'
import { createCreativePilotEngine } from '@/services/writerCampaign/creativePilotEngine'
import { createCreativeLiveSdkHost } from '@/services/writerCampaign/creativePilotTransport'
import { CREATIVE_LIVE_GRANT_DEFAULTS, CreativePilotError, sealCreativeLiveGrant, validateCreativeBrief } from '@/services/writerCampaign/creativePilotProtocol'
import { hashCampaignValue } from '@/services/writerCampaign/protocol'

const languages = ['zh', 'en'] as const
const id = (kind: string) => `live-${kind}-${crypto.randomUUID()}`
export function parsePilotUsd(value: string): number {
  if (!/^\d{1,6}(?:\.\d{1,6})?$/.test(value)) throw new CreativePilotError('input_invalid')
  const [whole, fraction = ''] = value.split('.')
  const result = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, '0'))
  if (!Number.isSafeInteger(result) || result < CREATIVE_LIVE_GRANT_DEFAULTS.reservedCostMicroUsd) throw new CreativePilotError('budget')
  return result
}

/** Credentials exist only in this session closure. Durable records hold the
 * fixed pair and budget, never a credential or restored execution authority. */
export function useCreativeLivePilot(options: { repository?: CreativeRepository; identity?: CreativeRuntimeIdentity } = {}) {
  const grant = shallowRef<CreativeLiveGrantV1 | null>(null)
  const engines = shallowRef<Partial<Record<CreativeLanguage, CreativePilotEngine>>>({})
  const briefs = shallowRef<Partial<Record<CreativeLanguage, CreativeBriefV1>>>({})
  const prepared = shallowRef({ zh: false, en: false })
  const busy = ref(false), authorized = ref(false), error = ref('')
  const generation = ref(0)
  let credential: string | null = null, owner = 0, disposed = false
  function revoke() {
    owner++; credential = null; authorized.value = false; busy.value = false
    for (const engine of Object.values(engines.value)) { engine.stop(); engine.dispose() }
    engines.value = {}; generation.value++
  }
  const makeEngine = (liveGrant?: CreativeLiveGrantV1) => markRaw(createCreativePilotEngine({ ...options, ...(liveGrant ? { liveGrant } : {}) }))
  const safeError = (cause: unknown) => cause instanceof CreativePilotError ? cause.code : 'input_invalid'
  function installReaders(value: CreativeLiveGrantV1) {
    engines.value = { zh: makeEngine(value), en: makeEngine(value) }; generation.value++
  }
  function verifySnapshot(snapshot: Awaited<ReturnType<CreativePilotEngine['inspect']>>, value: CreativeLiveGrantV1, language: CreativeLanguage) {
    if (!snapshot || snapshot.manifest.policy.protocol !== 'creative-pilot-live-policy-v1'
      || snapshot.manifest.policy.grant.hash !== value.hash || snapshot.candidate.briefHash !== value.briefHashes[language]
      || snapshot.manifest.language !== language) throw new CreativePilotError('integrity')
    return snapshot
  }
  async function completePair(value: CreativeLiveGrantV1, token: number) {
    for (const language of languages) {
      const engine = engines.value[language]!
      let existing = await engine.inspect(value.campaignIds[language])
      if (!existing) {
        const brief = briefs.value[language]
        if (!brief || await hashCampaignValue('creative-brief-v1', brief) !== value.briefHashes[language]) throw new CreativePilotError('input_invalid')
        try { existing = await engine.prepare({ campaignId: value.campaignIds[language], operationId: `prepare-${language}-${value.grantId}`, brief }) }
        catch (cause) {
          // A lost acknowledgement never justifies a second create or new ID.
          existing = await engine.inspect(value.campaignIds[language])
          if (!existing) throw cause
        }
      }
      verifySnapshot(existing, value, language)
      if (disposed || token !== owner) return false
      prepared.value = { ...prepared.value, [language]: true }
    }
    return true
  }
  async function complete(input: Partial<Record<CreativeLanguage, CreativeBriefV1>> = {}) {
    if (disposed || busy.value || !grant.value) return false
    revoke(); const token = ++owner; busy.value = true; error.value = ''
    const value = grant.value
    try {
      for (const language of languages) if (input[language]) {
        validateCreativeBrief(input[language])
        if (input[language]!.language !== language || await hashCampaignValue('creative-brief-v1', input[language]) !== value.briefHashes[language]) throw new CreativePilotError('input_invalid')
        briefs.value = { ...briefs.value, [language]: structuredClone(input[language]) }
      }
      if (disposed || token !== owner) return false
      installReaders(value)
      return await completePair(value, token)
    } catch (cause) { if (token === owner) error.value = safeError(cause); return false }
    finally { if (token === owner) busy.value = false }
  }
  async function prepare(input: { zh: CreativeBriefV1; en: CreativeBriefV1; maxUsd: string; consent: boolean }) {
    if (disposed || busy.value || grant.value) return false
    busy.value = true; error.value = ''; const token = ++owner
    try {
      if (!input.consent || input.zh.language !== 'zh' || input.en.language !== 'en') throw new CreativePilotError('input_invalid')
      validateCreativeBrief(input.zh); validateCreativeBrief(input.en)
      const maxCostMicroUsd = parsePilotUsd(input.maxUsd)
      const candidate = await sealCreativeLiveGrant({ ...CREATIVE_LIVE_GRANT_DEFAULTS,
        grantId: id('grant'), campaignIds: { zh: id('zh'), en: id('en') },
        briefHashes: { zh: await hashCampaignValue('creative-brief-v1', input.zh), en: await hashCampaignValue('creative-brief-v1', input.en) },
        maxCostMicroUsd, transmissionConsent: true, expiresAt: Math.min(Date.now() + 86_400_000, CREATIVE_LIVE_GRANT_DEFAULTS.pricingValidUntil) })
      if (disposed || token !== owner) return false
      grant.value = candidate; briefs.value = structuredClone({ zh: input.zh, en: input.en })
      installReaders(candidate)
      return await completePair(candidate, token)
    } catch (cause) { if (token === owner) error.value = safeError(cause); return false }
    finally { if (token === owner) busy.value = false }
  }
  async function restore(campaignId: string) {
    if (disposed || busy.value) return false
    revoke(); busy.value = true; error.value = ''; const token = ++owner, reader = makeEngine()
    try {
      const selected = await reader.inspect(campaignId)
      if (!selected || selected.manifest.policy.protocol !== 'creative-pilot-live-policy-v1') throw new CreativePilotError('input_invalid')
      const candidate = selected.manifest.policy.grant
      const pair = { zh: await reader.inspect(candidate.campaignIds.zh), en: await reader.inspect(candidate.campaignIds.en) }
      for (const language of languages) if (pair[language]) verifySnapshot(pair[language], candidate, language)
      if (disposed || token !== owner) return false
      grant.value = candidate; briefs.value = {}; prepared.value = { zh: false, en: false }
      for (const language of languages) if (pair[language]) {
        briefs.value[language] = pair[language]!.candidate.brief
        prepared.value[language] = true
      }
      installReaders(candidate)
      return true
    } catch (cause) { if (token === owner) error.value = safeError(cause); return false }
    finally { reader.dispose(); if (token === owner) busy.value = false }
  }
  async function authorize(key: string, consent: boolean) {
    if (disposed || busy.value || !grant.value || !prepared.value.zh || !prepared.value.en || !consent || !key.trim()) return false
    const value = grant.value
    revoke(); busy.value = true; error.value = ''; const token = ++owner
    credential = key; authorized.value = true
    try {
      const host = await createCreativeLiveSdkHost({ grant: value, readCredential: () => credential,
        currentGrant: () => !disposed && authorized.value && owner === token ? value : null })
      if (disposed || token !== owner) return false
      engines.value = { zh: markRaw(createCreativePilotEngine({ ...options, liveGrant: value, host })), en: markRaw(createCreativePilotEngine({ ...options, liveGrant: value, host })) }
      generation.value++; return true
    } catch (cause) {
      if (token === owner) {
        error.value = safeError(cause)
        // revoke clears busy as well as the credential; it invalidates this token.
        revoke(); installReaders(value)
      }
      return false
    }
    finally { if (token === owner) busy.value = false }
  }
  function dispose() { revoke(); disposed = true; busy.value = false }
  return { grant, briefs, prepared, engines, busy, authorized, error, generation, prepare, complete, restore, authorize, revoke, dispose }
}
