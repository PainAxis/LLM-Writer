/** Pure Node fixture regression. No browser, network, production mutation, or raw error output. */
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { installCampaignPageBootstrap } from './fixtures/writer-campaign-browser-bootstrap.mjs'
import { classifyCampaignPageError } from './lib/writer-campaign-browser-diagnostics.mjs'

const appOrigin = 'http://127.0.0.1:4173'
const opaqueFailureHash = '6129dc9a9e20cf2b93c30ff5b701163504d2c1a36cab2093cc2701acbac68b94'
let passed = 0, activeCase = 'none'
function document(origin, denyLocalStorage = false) {
  let accesses = 0, writes = 0
  class Storage {
    values = new Map()
    getItem(key) { return this.values.get(String(key)) ?? null }
    setItem(key, value) { writes++; this.values.set(String(key), String(value)) }
  }
  const local = new Storage(), session = new Storage()
  const originalGetItem = Storage.prototype.getItem
  const sandbox = vm.createContext({ location: { origin }, URL, Storage, Date, DOMException,
    __bootstrapInput: { expectedOrigin: appOrigin }, __localStorage: local, __denyLocalStorage: denyLocalStorage,
    __recordStorageAccess: () => { accesses++ } })
  // Define the accessor inside the VM realm: Node's context proxy otherwise converts
  // a throwing host-defined global accessor into an unrelated ReferenceError.
  vm.runInContext(`Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() {
    __recordStorageAccess();
    if (__denyLocalStorage) throw new DOMException("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.", 'SecurityError');
    return __localStorage;
  } })`, sandbox)
  return { sandbox, local, session, Storage, originalGetItem, accesses: () => accesses, writes: () => writes,
    run(fn = installCampaignPageBootstrap) { return vm.runInContext(`(${fn.toString()})(__bootstrapInput)`, sandbox, { timeout: 1_000 }) } }
}
function check(name, run) { activeCase = name; run(); passed++ }
try {
  check('original-opaque-origin-failure-matches-ci-hash', () => {
    const env = document('null', true)
    // Exact formerly unguarded announcement write, not a production action.
    assert.throws(() => env.run(function () { localStorage.setItem('lastReadAnnouncementVersion', '1.0.0') }), error => {
      const diagnostic = classifyCampaignPageError(error)
      return diagnostic.category === 'other' && diagnostic.sha256 === opaqueFailureHash
    })
    assert.ok(env.accesses() > 0)
  })
  check('opaque-about-blank-does-not-touch-origin-apis', () => {
    const env = document('null', true)
    env.run()
    assert.equal(env.accesses(), 0); assert.equal(env.writes(), 0)
    assert.equal(env.Storage.prototype.getItem, env.originalGetItem)
    assert.equal(env.sandbox.__campaignConfigReadCount, undefined)
  })
  check('other-http-origin-remains-untouched', () => {
    const env = document('http://127.0.0.1:9999', true)
    env.run()
    assert.equal(env.accesses(), 0); assert.equal(env.writes(), 0)
    assert.equal(env.Storage.prototype.getItem, env.originalGetItem)
  })
  check('expected-origin-seeds-and-observes-config-reads', () => {
    const env = document(appOrigin)
    env.run()
    assert.equal(env.writes(), 2)
    assert.equal(env.local.getItem('lastReadAnnouncementVersion'), '1.0.0')
    assert.ok(Number.isFinite(Number(env.local.getItem('lastReadAnnouncementDate'))))
    assert.equal(env.sandbox.__campaignConfigReadCount, 0)
    for (const key of ['apiConfig', 'customApiConfig', 'officialApiConfig']) env.local.getItem(key)
    assert.equal(env.sandbox.__campaignConfigReadCount, 3)
    env.local.getItem('ordinary-key'); env.session.getItem('apiConfig')
    assert.equal(env.sandbox.__campaignConfigReadCount, 3)
    env.sandbox.__campaignOracleRead = true; env.local.getItem('apiConfig')
    assert.equal(env.sandbox.__campaignConfigReadCount, 3)
  })
  check('expected-origin-storage-errors-are-not-suppressed', () => {
    const env = document(appOrigin, true)
    assert.throws(() => env.run(), error => classifyCampaignPageError(error).sha256 === opaqueFailureHash)
    assert.ok(env.accesses() > 0)
  })
  check('invalid-origin-configuration-is-not-suppressed', () => {
    const env = document(appOrigin)
    env.sandbox.__bootstrapInput.expectedOrigin = 'file:///tmp/test.html'
    assert.throws(() => env.run(), error => error?.message === 'invalid_campaign_bootstrap_origin')
    assert.equal(env.accesses(), 0)
  })
  console.log(JSON.stringify({ suite: 'writer-campaign-browser-bootstrap', passed, originalCiErrorHashMatched: true, browserRun: false }))
} catch {
  console.error(JSON.stringify({ suite: 'writer-campaign-browser-bootstrap', passed, failedCase: activeCase, category: 'check_failed' }))
  process.exitCode = 1
}
