/** Test-only observers at real browser API boundaries. No application imports,
 * fabricated tool results, replacement Worker, or persisted Agent capability.
 * Install before the production application loads. Held callbacks retain the
 * real request/event/result; release never manufactures a success response. */
export function installWriterAgentProbe({ providerOrigin }) {
  const state = {
    enabled: false, actor: 'agent', sequence: 0, events: [], holds: [], rules: [],
    workerSync: 0, workerSearch: 0, workerCreated: 0, sourceReads: 0, oracleReads: 0,
    graphReads: 0, graphWrites: 0, metadataAttempts: 0, metadataCommits: 0,
    hiddenWrites: 0, contentWrites: 0, commitGates: 0, editorAppends: 0,
    savingIndicatorTransitions: 0, eof: 0, clipboard: '', clipboardRequests: 0, clipboardCompletion: null,
    clipboardAvailable: Boolean(navigator.clipboard?.writeText), lastEditor: '', lastSaving: false,
    expectedDraft: '', failMetadata: 0, afterEof: null, lastPhase: null,
  }
  const originals = { get: IDBObjectStore.prototype.get, put: IDBObjectStore.prototype.put,
    set: Storage.prototype.setItem, storageGet: Storage.prototype.getItem,
    tx: IDBDatabase.prototype.transaction, fetch: globalThis.fetch.bind(globalThis), Worker: globalThis.Worker }
  const txInfo = new WeakMap()
  const phase = () => document.querySelector('[data-testid="writer-agent-panel"]')?.getAttribute('data-phase') ?? 'closed'
  const log = (kind, extra = {}) => {
    if (!state.enabled) return
    // Deliberately metadata-only. Never add bodies, keys containing credentials,
    // full serialized seed/backup or request JSON to the browser report.
    state.events.push({ sequence: ++state.sequence, kind, phase: phase(), actor: state.actor, ...extra })
    if (state.events.length > 6000) throw new Error('Probe event budget exceeded')
  }
  const matches = (rule, kind, detail) => rule.kind === kind
    && (!rule.phase || [].concat(rule.phase).includes(phase()))
    && (!rule.workerType || rule.workerType === detail.workerType)
    && (!rule.afterAppend || state.editorAppends > 0)
  const intercept = (kind, detail, deliver) => {
    const index = state.rules.findIndex(rule => matches(rule, kind, detail))
    if (index < 0) { deliver(); return false }
    const rule = state.rules[index]
    if (rule.skip > 0) { rule.skip--; deliver(); return false }
    state.rules.splice(index, 1)
    state.holds.push({ label: rule.label, kind, detail, deliver })
    log('held', { boundary: kind, label: rule.label })
    return true
  }
  state.arm = rule => { state.rules.push({ ...rule }) }
  state.release = label => {
    const matching = state.holds.filter(hold => !label || hold.label === label)
    state.holds = state.holds.filter(hold => !matching.includes(hold))
    for (const hold of matching) { log('released', { boundary: hold.kind, label: hold.label }); hold.deliver() }
    return matching.length
  }
  state.reset = draft => {
    if (state.holds.length) throw new Error('Cannot reset a probe with held real callbacks')
    state.rules = []; state.events = []; state.sequence = 0
    for (const key of ['workerSync', 'workerSearch', 'workerCreated', 'sourceReads', 'oracleReads', 'graphReads', 'graphWrites', 'metadataAttempts', 'metadataCommits', 'hiddenWrites', 'contentWrites', 'commitGates', 'editorAppends', 'savingIndicatorTransitions', 'eof']) state[key] = 0
    state.expectedDraft = draft; state.clipboard = ''; state.clipboardRequests = 0; state.clipboardCompletion = null
    state.failMetadata = 0; state.afterEof = null
    state.lastEditor = document.querySelector('.editor-panel [contenteditable="true"]')?.textContent ?? ''
    state.lastSaving = Boolean(document.querySelector('.saving-indicator')); state.lastPhase = phase(); state.enabled = true
  }
  state.snapshot = () => Object.fromEntries(Object.entries(state).filter(([key, value]) =>
    typeof value !== 'function' && !['holds', 'rules', 'clipboard', 'expectedDraft', 'lastEditor', 'afterEof'].includes(key)))
  globalThis.__writerAgentProbe = state

  // Keep the native requests and native transaction lifetime. A delayed readonly
  // completion is safe because the real transaction is already finished. This
  // also allows another real tab to commit while its caller is suspended.
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = originals.tx.apply(this, args), info = { keys: [], mode: tx.mode, database: this.name }
    txInfo.set(tx, info)
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')
    Object.defineProperty(tx, 'oncomplete', {
      configurable: true,
      get() { return info.oncomplete ?? null },
      set(callback) {
        info.oncomplete = callback
        descriptor.set.call(tx, typeof callback !== 'function' ? callback : function (event) {
          const deliver = () => callback.call(tx, event)
          const isSource = info.mode === 'readonly' && info.keys.some(key => key.startsWith('novel:'))
          const gate = info.keys.includes('__llm_writer_commit_gate__')
          if (state.enabled && isSource) intercept('source-complete', {}, deliver)
          else if (state.enabled && gate) intercept('commit-ack', {}, deliver)
          else deliver()
        })
      },
    })
    return tx
  }
  IDBObjectStore.prototype.get = function (key) {
    const text = String(key), info = txInfo.get(this.transaction)
    if (this.transaction.__writerAgentOracle) { state.oracleReads++; return originals.get.call(this, key) }
    info?.keys.push(text)
    if (state.enabled) {
      if (text.startsWith('novel:')) state.sourceReads++
      if (text.startsWith('memory-fact-graph:')) { state.graphReads++; log('graph-read') }
      if (text === '__llm_writer_commit_gate__') { state.commitGates++; log('commit-gate') }
    }
    return originals.get.call(this, key)
  }
  IDBObjectStore.prototype.put = function (value, key) {
    if (state.enabled) {
      const text = String(key)
      if (text.startsWith('memory-fact-graph:')) { state.graphWrites++; log('graph-write') }
      else if (text.startsWith('novel:')) { state.contentWrites++; log('content-stage') }
      else if (!text.startsWith('memory-') && !text.startsWith('memory:')) { state.hiddenWrites++; log('other-idb-write') }
    }
    return originals.put.apply(this, arguments)
  }
  Storage.prototype.setItem = function (key, value) {
    if (state.enabled && this === localStorage) {
      if (key === 'novels') {
        state.metadataAttempts++; log('metadata-attempt')
        if (state.failMetadata > 0) { state.failMetadata--; log('metadata-known-failure'); throw new DOMException('Synthetic known precommit failure', 'InvalidStateError') }
      } else if (/^(?:assistantConversations|assistantSummaries|writer-agent|memory-fact-graph)/.test(key)) {
        state.hiddenWrites++; log('hidden-document-write')
      }
    }
    const result = originals.set.call(this, key, value)
    if (state.enabled && this === localStorage && key === 'novels') { state.metadataCommits++; log('metadata-committed') }
    return result
  }

  globalThis.Worker = class ObservedRealWorker extends originals.Worker {
    constructor(...args) {
      super(...args)
      if (state.enabled) { state.workerCreated++; log('worker-created') }
      let observer
      // MemoryClient uses onmessage. Delay delivery, not the worker computation.
      Object.defineProperty(this, 'onmessage', {
        configurable: true, get() { return observer ?? null },
        set(callback) { observer = callback },
      })
      this.addEventListener('message', event => {
        const deliver = () => { if (typeof observer === 'function') observer.call(this, event) }
        if (state.enabled) intercept('worker-response', { workerType: event.data?.type }, deliver)
        else deliver()
      })
    }
    postMessage(message, ...rest) {
      if (state.enabled) {
        if (message?.type === 'sync') { state.workerSync++; log('worker-sync', { chapters: message.project?.chapters?.length ?? null, projectId: message.project?.id }) }
        if (message?.type === 'search') { state.workerSearch++; log('worker-search', { remotePresent: Boolean(message.options), cutoff: message.query?.throughChapterId }) }
        if (message?.type?.startsWith('full-scan')) log('forbidden-full-scan')
      }
      return super.postMessage(message, ...rest)
    }
  }

  // SDK consumes the actual reader, not Response.json(). The EOF hook is after
  // every byte has really been consumed, before SDK parsing/publication resumes.
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const response = await originals.fetch(input, init)
    if (!url.startsWith(`${providerOrigin}/`) || !response.body) return response
    const getReader = response.body.getReader.bind(response.body)
    response.body.getReader = (...args) => {
      const reader = getReader(...args), read = reader.read.bind(reader)
      let bytes = 0, reached = false
      reader.read = async (...readArgs) => {
        const part = await read(...readArgs)
        if (!part.done) bytes += part.value.byteLength
        else if (!reached) {
          reached = true; state.eof++; log('http-reader-eof', { bytes })
          if (state.afterEof && state.eof === state.afterEof.ordinal) {
            const action = state.afterEof; state.afterEof = null
            if (action.arm) state.arm(action.arm)
            if (action.close) document.querySelector('[data-testid="writer-agent-close"]')?.click()
            if (action.stop) document.querySelector('[data-testid="writer-agent-stop"]')?.click()
          }
        }
        return part
      }
      return reader
    }
    return response
  }

  const observe = () => {
    if (!state.enabled) return
    const currentPhase = phase()
    if (currentPhase !== state.lastPhase) { state.lastPhase = currentPhase; log('phase', { value: currentPhase }) }
    const text = document.querySelector('.editor-panel [contenteditable="true"]')?.textContent ?? ''
    const count = value => state.expectedDraft ? value.split(state.expectedDraft).length - 1 : 0
    if (state.actor === 'agent' && count(text) > count(state.lastEditor)) { state.editorAppends += count(text) - count(state.lastEditor); log('editor-append') }
    state.lastEditor = text
    const saving = Boolean(document.querySelector('.saving-indicator'))
    // UI proxy only: Vue can coalesce same-tick/concurrent save state updates.
    // This is deliberately not an exact save-function entry counter.
    if (saving && !state.lastSaving) { state.savingIndicatorTransitions++; log('saving-indicator-transition') }
    state.lastSaving = saving
  }
  new MutationObserver(observe).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-phase'] })
  // Observe the genuine clipboard action while forwarding it to the native API.
  if (navigator.clipboard?.writeText) {
    const writeText = navigator.clipboard.writeText.bind(navigator.clipboard)
    navigator.clipboard.writeText = async value => {
      const requestId = ++state.clipboardRequests
      try {
        await writeText(value)
        state.clipboard = value
        state.clipboardCompletion = { requestId, status: 'fulfilled' }
        log('clipboard-write', { requestId })
      } catch (error) {
        state.clipboardCompletion = { requestId, status: 'rejected', errorName: error?.name ?? 'Error' }
        log('clipboard-write-failed', { requestId, errorName: error?.name ?? 'Error' })
        throw error
      }
    }
  }
}
