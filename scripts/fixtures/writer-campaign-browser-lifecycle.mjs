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

/** waitForLoadState can accept the OLD document. Subscribe before clicking instead.
 * A native dialog is not the Settings success alert: fail with a bounded stage,
 * never silently accept an unsaved-data warning. Listener exists only for this restore.
 */
export async function waitForFreshCampaignReload(page, click, markStage = () => {}) {
  markStage('reload_before_identity')
  const before = await campaignDocumentIdentity(page)
  let unexpectedStage = null, rejectDialog
  const nativeDialog = new Promise((_, reject) => { rejectDialog = reject })
  // All listener/timeout promises are observed even if the click fails first.
  void nativeDialog.catch(() => {})
  const onDialog = dialog => {
    unexpectedStage ??= dialog.type() === 'beforeunload' ? 'reload_native_beforeunload' : 'reload_native_dialog'
    const fail = () => rejectDialog(new Error('reload_unexpected_native_dialog'))
    // Dismiss exactly as Playwright's default, then fail; no production protection is bypassed.
    void Promise.resolve().then(() => dialog.dismiss()).then(fail, fail)
  }
  page.on('dialog', onDialog)
  const loaded = page.waitForEvent('load')
  void loaded.catch(() => {})
  try {
    markStage('restore_complete_confirm')
    await Promise.race([click(), nativeDialog])
    markStage('reload_wait')
    await Promise.race([loaded, nativeDialog])
    markStage('reload_identity')
    const after = await Promise.race([campaignDocumentIdentity(page), nativeDialog])
    // Dialog observation is synchronous; dismissal may still be pending when identity resolves.
    if (unexpectedStage) throw new Error('reload_unexpected_native_dialog')
    if (before.timeOrigin === after.timeOrigin || before.documentId === after.documentId) {
      throw new Error('reload_document_unchanged')
    }
  } catch (error) {
    if (unexpectedStage) markStage(unexpectedStage)
    throw error
  } finally {
    page.off('dialog', onDialog)
  }
}
