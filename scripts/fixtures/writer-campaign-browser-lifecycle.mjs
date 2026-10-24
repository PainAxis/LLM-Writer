/** Runner-only projections and navigation barriers. Never imported into production. */
export function ordinaryStorageProjection(value) {
  return {
    idb: Object.fromEntries(Object.entries(value.idb).filter(([key]) => !key.startsWith('writer-campaign:'))),
    // Campaign never uses localStorage; retain every key, including unexpected ones.
    local: { ...value.local },
  }
}

export async function campaignDocumentIdentity(page) {
  return page.evaluate(() => {
    globalThis.__campaignDocumentIdentity ??= crypto.randomUUID()
    return { timeOrigin: performance.timeOrigin, documentId: globalThis.__campaignDocumentIdentity }
  })
}

/** waitForLoadState can accept the OLD document. Subscribe before clicking instead. */
export async function waitForFreshCampaignReload(page, click) {
  const before = await campaignDocumentIdentity(page)
  const loaded = page.waitForEvent('load')
  await Promise.all([loaded, click()])
  const after = await campaignDocumentIdentity(page)
  if (before.timeOrigin === after.timeOrigin || before.documentId === after.documentId) {
    throw new Error('reload_document_unchanged')
  }
}
