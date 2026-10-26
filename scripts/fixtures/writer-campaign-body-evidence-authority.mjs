/** Test-only authority entry sentinels. No strings, storage values or URLs are retained. */
export function installPlanningAuthorityGuard() {
  const counters = { networkEntries: 0, credentialEntries: 0, configurationReads: 0, ordinaryWriterMutations: 0, externalToolEntries: 0 }
  const stop = kind => { counters[kind]++; throw new Error('body_evidence_authority_forbidden') }
  globalThis.__planningAuthority = { snapshot: () => ({ observed: true, ...counters }) }
  globalThis.fetch = () => { stop('networkEntries') }
  for (const name of ['WebSocket', 'EventSource']) if (typeof globalThis[name] === 'function') globalThis[name] = function () { stop('networkEntries') }
  XMLHttpRequest.prototype.open = function () { stop('networkEntries') }
  navigator.sendBeacon = () => { stop('networkEntries') }
  if (navigator.credentials) for (const name of ['get', 'create', 'store']) navigator.credentials[name] = () => { stop('credentialEntries') }
  Storage.prototype.getItem = function () { stop('configurationReads') }
  for (const name of ['setItem', 'removeItem', 'clear']) Storage.prototype[name] = function () { stop('ordinaryWriterMutations') }
  const nativeGet = IDBObjectStore.prototype.get, nativePut = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.get = function (key) {
    if (this.transaction.db.name !== 'llm-writer' || this.name !== 'kv' || !String(key).startsWith('writer-campaign:')) stop('configurationReads')
    return nativeGet.apply(this, arguments)
  }
  IDBObjectStore.prototype.put = function (_value, key) {
    if (this.transaction.db.name !== 'llm-writer' || this.name !== 'kv' || !String(key).startsWith('writer-campaign:')) stop('ordinaryWriterMutations')
    return nativePut.apply(this, arguments)
  }
  for (const name of ['getAll', 'getAllKeys', 'getKey', 'openCursor', 'openKeyCursor', 'count', 'index']) IDBObjectStore.prototype[name] = function () { stop('configurationReads') }
  for (const name of ['add', 'delete', 'clear']) IDBObjectStore.prototype[name] = function () { stop('ordinaryWriterMutations') }
  // No MCP, extension, editor or live-provider module is in the driver import graph.
  // The host has no external-tool interface; this sentinel also blocks explicit UI escapes.
  window.open = () => { stop('externalToolEntries') }
}

export function installNodeBodyEvidenceAuthorityGuard() {
  const counters = { networkEntries: 0, credentialEntries: 0, configurationReads: 0, ordinaryWriterMutations: 0, externalToolEntries: 0 }
  const descriptors = new Map(), stop = kind => { counters[kind]++; throw new Error('body_evidence_authority_forbidden') }
  const set = (name, value) => { descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }) }
  set('fetch', () => { stop('networkEntries') })
  for (const name of ['WebSocket', 'EventSource', 'XMLHttpRequest']) set(name, function () { stop('networkEntries') })
  for (const name of ['localStorage', 'sessionStorage']) set(name, { getItem() { stop('configurationReads') }, setItem() { stop('ordinaryWriterMutations') }, removeItem() { stop('ordinaryWriterMutations') }, clear() { stop('ordinaryWriterMutations') } })
  set('open', () => { stop('externalToolEntries') })
  set('navigator', { credentials: { get() { stop('credentialEntries') }, create() { stop('credentialEntries') }, store() { stop('credentialEntries') } }, sendBeacon() { stop('networkEntries') } })
  return { snapshot: () => ({ observed: true, ...counters }), restore() { for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] } } }
}
