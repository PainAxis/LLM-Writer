/** Runner-only instrumentation. Never imported by src, regular build, or production UI.
 * The transform wraps the real branded offline host, not the engine or repository.
 * Native IndexedDB transactions, CAS, reads and UI actions remain production code. */
export function campaignFixtureProbePlugin(root, onControlChunk = () => {}) {
  const virtual = '\0writer-campaign-test-host'
  const control = '\0writer-campaign-test-control'
  const original = `${root}/src/services/writerCampaign/fixtureAdapter.ts`
  return {
    name: 'writer-campaign-test-host', enforce: 'pre',
    resolveId(id, importer) {
      if (id === 'writer-campaign-test-control') return control
      if (importer?.replaceAll('\\', '/').endsWith('/writerCampaign/engine.ts') && /(?:^|\/)fixtureAdapter(?:\.ts)?$/.test(id)) return virtual
    },
    generateBundle(_options, bundle) {
      for (const value of Object.values(bundle)) if (value.type === 'chunk' && value.facadeModuleId === control) onControlChunk(value.fileName)
    },
    load(id) {
      if (id === control) return `
        import { createOfflineCampaignEngine } from ${JSON.stringify(`${root}/src/services/writerCampaign/engine.ts`)};
        export async function replaceOutline(campaignId) {
          const engine = createOfflineCampaignEngine();
          try { await engine.replaceCandidate(campaignId, 'outline', 'Controlled replacement outline for stale dependency rejection.'); }
          finally { engine.dispose(); }
        }
      `
      if (id !== virtual) return
      return `
        export * from ${JSON.stringify(original)};
        import { createOfflineFixtureHost as actualFactory } from ${JSON.stringify(original)};
        export function createOfflineFixtureHost(options = {}) {
          const probe = globalThis.__campaignProbe;
          if (!probe) throw new Error('Campaign fixture probe missing');
          const host = actualFactory({ ...options, onDispatch: async request => {
            await probe.dispatchEntry(request);
            await options.onDispatch?.(request);
          } });
          const dispatch = host.provider.dispatch.bind(host.provider);
          host.provider.dispatch = (...args) => dispatch(...args).then(response => probe.responseBoundary(response));
          return host;
        }
      `
    },
  }
}

/** Playwright addInitScript function. No application success or storage facts are fabricated. */
export function installCampaignProbe() {
  const txInfo = new WeakMap()
  const native = { transaction: IDBDatabase.prototype.transaction, get: IDBObjectStore.prototype.get,
    put: IDBObjectStore.prototype.put, complete: Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete') }
  const state = { rules: [], holds: [], dispatches: 0, completions: 0, transactions: 0, aborted: 0,
    ordinaryWrites: 0, campaignWrites: 0, enabled: true }
  const matches = (rule, kind, operation) => rule.kind === kind && (!rule.operation || rule.operation === operation)
  const take = (kind, operation) => {
    const index = state.rules.findIndex(rule => matches(rule, kind, operation))
    if (index < 0) return null
    const rule = state.rules[index]
    if (rule.skip > 0) { rule.skip--; return null }
    state.rules.splice(index, 1)
    return rule
  }
  const invokeAction = action => {
    if (action === 'cancel') document.querySelector('[data-testid="campaign-cancel"]')?.click()
    if (action === 'unmount') location.hash = '#/'
  }
  const deliverOrHold = (rule, deliver) => {
    const finish = () => { deliver(); invokeAction(rule?.after) }
    if (rule?.hold) state.holds.push({ label: rule.label, deliver: finish })
    else finish()
  }
  globalThis.__campaignProbe = {
    arm(rule) { state.rules.push({ ...rule }) },
    snapshot() { return { dispatches: state.dispatches, completions: state.completions, transactions: state.transactions,
      aborted: state.aborted, ordinaryWrites: state.ordinaryWrites, campaignWrites: state.campaignWrites,
      holds: state.holds.map(hold => hold.label) } },
    release(label) {
      const selected = state.holds.filter(hold => hold.label === label)
      state.holds = state.holds.filter(hold => hold.label !== label)
      selected.forEach(hold => hold.deliver())
      return selected.length
    },
    async dispatchEntry(request) {
      state.dispatches++
      // Called inside the actual adapter, after its one-use permit is validated.
      await globalThis.__campaignObserve('dispatch', { campaignId: request.campaignId, requestId: request.id,
        taskId: request.taskId, taskRevision: request.taskRevision, inputDigest: request.inputDigest })
      const rule = take('dispatch')
      if (rule) await new Promise(resolve => deliverOrHold(rule, resolve))
    },
    responseBoundary(response) {
      state.completions++
      return new Promise(resolve => deliverOrHold(take('response'), () => resolve(response)))
    },
  }
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = native.transaction.apply(this, args)
    if (this.name !== 'llm-writer') return tx
    const info = { headRead: false, campaign: false, operations: [], oncomplete: null, oracle: false }
    txInfo.set(tx, info)
    Object.defineProperty(tx, 'oncomplete', { configurable: true,
      get: () => info.oncomplete,
      set(callback) {
        info.oncomplete = callback
        native.complete.set.call(tx, typeof callback !== 'function' ? callback : event => {
          if (info.oracle || tx.__campaignOracle || !info.campaign) { callback.call(tx, event); return }
          if (info.campaign) state.transactions++
          const kind = tx.mode === 'readonly' && info.headRead ? 'read' : 'ack'
          const rule = take(kind, info.operations.at(-1))
          deliverOrHold(rule, () => callback.call(tx, event))
        })
      },
    })
    return tx
  }
  IDBObjectStore.prototype.get = function (key) {
    const info = txInfo.get(this.transaction), text = String(key)
    if (info && !this.transaction.__campaignOracle && text.startsWith('writer-campaign:')) {
      info.campaign = true
      if (text.endsWith(':head')) info.headRead = true
    }
    return native.get.call(this, key)
  }
  IDBObjectStore.prototype.put = function (value, key) {
    const info = txInfo.get(this.transaction), text = String(key)
    if (info && !this.transaction.__campaignOracle) {
      if (text.startsWith('writer-campaign:')) {
        info.campaign = true; state.campaignWrites++
        let record
        try { record = JSON.parse(value) } catch { /* Invalid record remains the production repository's concern. */ }
        if (text.includes(':receipt:') && record?.kind) {
          info.operations.push(record.kind)
          const rule = take('write', record.kind)
          if (rule?.abort) { state.aborted++; this.transaction.abort(); throw new DOMException('Controlled transaction abort', 'AbortError') }
        }
      } else state.ordinaryWrites++
    }
    return native.put.apply(this, arguments)
  }
}
