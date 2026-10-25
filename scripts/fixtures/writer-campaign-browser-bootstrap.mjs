/** Runner-only document bootstrap. Playwright serializes this function without its module scope. */
export function installCampaignPageBootstrap({ expectedOrigin }) {
  const parsed = new URL(expectedOrigin)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== expectedOrigin) {
    throw new Error('invalid_campaign_bootstrap_origin')
  }
  // A newly created page runs init scripts on its initial opaque about:blank too.
  // Never touch origin-bound APIs there. Do not suppress failures on the app origin.
  if (location.origin !== expectedOrigin) return

  // Native read-only observer for the direct-route privacy regression. No values retained.
  const getItem = Storage.prototype.getItem
  globalThis.__campaignConfigReadCount = 0
  Storage.prototype.getItem = function (key) {
    if (!globalThis.__campaignOracleRead && this === localStorage && ['apiConfig', 'customApiConfig', 'officialApiConfig'].includes(key)) {
      globalThis.__campaignConfigReadCount++
    }
    return getItem.call(this, key)
  }
  // Suppress only the incidental release announcement, not Campaign behavior.
  localStorage.setItem('lastReadAnnouncementVersion', '1.0.0')
  localStorage.setItem('lastReadAnnouncementDate', String(Date.now()))
}
