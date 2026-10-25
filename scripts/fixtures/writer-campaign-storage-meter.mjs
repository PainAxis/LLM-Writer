/** Test build only. Observes native completed IDB transactions, never invents a
 * commit, changes a timeout, reads extra records, or exports narrative values. */
export function installCampaignStorageMeter() {
  const encode = value => new TextEncoder().encode(value).length
  const kinds = ['catalog', 'manifest', 'head', 'checkpoint', 'receipt', 'request', 'artifact']
  const kindOf = key => key === 'writer-campaign:catalog' ? 'catalog' : kinds.find(kind => key.includes(`:${kind}:`) || key.endsWith(`:${kind}`))
  const fresh = () => ({ cumulativeWrittenBytes: 0, committedTransactions: 0, liveRecordCount: 0,
    liveBytesByRecordKind: Object.fromEntries(kinds.map(kind => [kind, 0])), totalReadBytes: 0, totalReadCalls: 0,
    maxReadBatchBytes: 0, maxReadBatchKeys: 0, peakOutstandingBytes: 0, accountingMismatches: 0 })
  let totals = fresh(), latestCheckpointHash = null
  const liveSizes = new Map(), transactions = new WeakMap()
  const native = { transaction: IDBDatabase.prototype.transaction, get: IDBObjectStore.prototype.get, put: IDBObjectStore.prototype.put }
  const storageNumber = value => typeof value === 'string' && /^[0-9]{16}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : NaN
  globalThis.__campaignStorageMeter = {
    snapshot() { return structuredClone(totals) },
    // Private process-restart fence, never included in the public meter summary.
    restartIdentity() {
      if (typeof latestCheckpointHash !== 'string' || !/^[a-f0-9]{64}$/.test(latestCheckpointHash)) throw new Error('storage_restart_identity_unavailable')
      return { checkpointHash: latestCheckpointHash }
    },
    reset() { totals = fresh(); liveSizes.clear(); latestCheckpointHash = null },
  }
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = native.transaction.apply(this, args)
    if (this.name !== 'llm-writer') return tx
    const row = { writes: [], readBytes: 0, readKeys: 0, checkpoint: null, headCheckpointHash: null, receiptBytes: null, campaign: false }
    transactions.set(tx, row)
    const countReads = () => {
      if (tx.__campaignOracle || !row.campaign) return
      if (row.readKeys) {
        totals.totalReadBytes += row.readBytes; totals.totalReadCalls++
        totals.maxReadBatchBytes = Math.max(totals.maxReadBatchBytes, row.readBytes)
        totals.maxReadBatchKeys = Math.max(totals.maxReadBatchKeys, row.readKeys)
      }
    }
    tx.addEventListener('abort', countReads)
    tx.addEventListener('complete', () => {
      countReads()
      if (tx.__campaignOracle || !row.campaign || !row.writes.length) return
      // A newer completed Campaign write without a valid checkpoint must never
      // leave an older restart fence available. Aborted transactions do not enter here.
      latestCheckpointHash = null
      const bytes = row.writes.reduce((sum, item) => sum + item.bytes, 0)
      totals.cumulativeWrittenBytes += bytes; totals.committedTransactions++
      for (const item of row.writes) {
        const prior = liveSizes.get(item.key)
        if (prior) totals.liveBytesByRecordKind[prior.kind] -= prior.bytes
        liveSizes.set(item.key, item)
        if (!item.kind) totals.accountingMismatches++
        else totals.liveBytesByRecordKind[item.kind] += item.bytes
      }
      totals.liveRecordCount = liveSizes.size
      if (row.receiptBytes !== bytes || !row.checkpoint) totals.accountingMismatches++
      if (row.checkpoint) {
        const validHash = typeof row.checkpoint.hash === 'string' && /^[a-f0-9]{64}$/.test(row.checkpoint.hash) && row.checkpoint.hash === row.headCheckpointHash
        latestCheckpointHash = validHash ? row.checkpoint.hash : null
        if (!validHash) totals.accountingMismatches++
        totals.peakOutstandingBytes = Math.max(totals.peakOutstandingBytes, row.checkpoint.outstandingBytes)
        if (!Number.isSafeInteger(row.checkpoint.writtenBytes) || !Number.isSafeInteger(row.checkpoint.outstandingBytes)) totals.accountingMismatches++
        // One isolated campaign/profile per browser context. Catalog bytes belong to create.
        if (row.checkpoint.writtenBytes !== totals.cumulativeWrittenBytes) totals.accountingMismatches++
      }
    })
    return tx
  }
  IDBObjectStore.prototype.get = function (key) {
    const request = native.get.call(this, key), row = transactions.get(this.transaction), text = String(key)
    if (row && !this.transaction.__campaignOracle && text.startsWith('writer-campaign:')) {
      row.campaign = true; row.readKeys++; row.readBytes += encode(text)
      request.addEventListener('success', () => { row.readBytes += typeof request.result === 'string' ? encode(request.result) : 0 })
    }
    return request
  }
  IDBObjectStore.prototype.put = function (value, key) {
    const request = native.put.apply(this, arguments), row = transactions.get(this.transaction), text = String(key)
    if (row && !this.transaction.__campaignOracle && text.startsWith('writer-campaign:')) {
      row.campaign = true
      row.writes.push({ key: text, kind: kindOf(text), bytes: encode(text) + encode(value) })
      if (text.includes(':receipt:') || text.includes(':checkpoint:') || text.endsWith(':head')) {
        try {
          const record = JSON.parse(value)
          if (text.includes(':receipt:')) row.receiptBytes = storageNumber(record.serializedBytes)
          else if (text.includes(':checkpoint:')) row.checkpoint = { hash: record.hash, writtenBytes: storageNumber(record.storage?.writtenBytes), outstandingBytes: storageNumber(record.storage?.outstandingBytes) }
          else row.headCheckpointHash = record.checkpointHash
        } catch { /* Count a closed mismatch at completion, never retain source. */ }
      }
    }
    return request
  }
}
