export interface CampaignBuildIdentity {
  runtimeIdentity: string
  source: { commit: string | null; tree: string | null }
}

// Replaced by the build, never read from localStorage or a Campaign manifest.
// Node tests must inject an explicit controlled identity into the engine.
declare const __WRITER_CAMPAIGN_BUILD_IDENTITY__: CampaignBuildIdentity

export function getCampaignBuildIdentity(): CampaignBuildIdentity {
  if (typeof __WRITER_CAMPAIGN_BUILD_IDENTITY__ === 'undefined') {
    throw new Error('Campaign build identity is unavailable')
  }
  const value = __WRITER_CAMPAIGN_BUILD_IDENTITY__
  if (!/^campaign-core-sha256:[a-f0-9]{64}$/.test(value.runtimeIdentity)
    || !((value.source.commit === null && value.source.tree === null)
      || (typeof value.source.commit === 'string' && /^[a-f0-9]{40}$/.test(value.source.commit)
        && typeof value.source.tree === 'string' && /^[a-f0-9]{40}$/.test(value.source.tree)))) {
    throw new Error('Campaign build identity is invalid')
  }
  return { runtimeIdentity: value.runtimeIdentity, source: { ...value.source } }
}
