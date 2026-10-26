/** Reusable Node-only offline control. Importing this module starts no server and runs no test.
 * All requests use the production adapter/API/SDK; the server constructs quotes from dynamic input.
 * Never archive request bodies or return them in the source-free observations. */
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { watch } from 'vue'
import type { BodyProducerAdapter } from '../../src/types/bodyProducer'
import { createOfflineSdkBodyProducer } from '../../src/services/writerCampaign/bodyProducerTransport'
import { canonicalStringify } from '../../src/services/writerCampaign/protocol'
import { CONTROL_MODEL, configureProducerLoopback, producerControlIdentity, producerControlOutput, type ProducerHttpObservation } from './writer-body-producer-control'

export interface ProducerNodeServer {
  adapter: BodyProducerAdapter
  endpoint: string
  observeHttp(): Promise<ProducerHttpObservation>
  close(): Promise<void>
}
let active = false
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
export async function createProducerNodeServer(): Promise<ProducerNodeServer> {
  if (active) throw new Error('A loopback control already owns this Node process')
  active = true
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), storage = new Map<string, string>()
  const originalFetch = globalThis.fetch
  let endpoint = '', origin = '', stopWatch: (() => void) | undefined, closed = false
  const observation: ProducerHttpObservation = { attempts: 0, inputDigests: [], windowDigests: [], errors: 0 }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, String(value)) },
    removeItem: (key: string) => { storage.delete(key) },
  } })
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST') observation.attempts++
    try {
      assert.ok(observation.attempts <= 16, 'Loopback attempt retention cap')
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/chat/completions')
      let raw = '', bytes = 0
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk)
        assert.ok(bytes <= 131_072, 'Loopback request byte cap')
        raw += chunk
      }
      const body = JSON.parse(raw), prompt = JSON.parse(body.messages[1].content)
      assert.equal(body.model, CONTROL_MODEL); assert.equal(body.max_tokens, 1200)
      assert.deepEqual(body.thinking, { type: 'disabled' }); assert.equal(body.tools, undefined); assert.equal(body.stream, undefined)
      assert.equal(body.messages.length, 2); assert.equal(body.messages[0].role, 'system'); assert.equal(body.messages[1].role, 'user')
      assert.equal(prompt.protocol, 'body-producer-input-v1'); assert.equal(typeof prompt.window.text, 'string')
      const text = prompt.window.text as string
      assert.ok(observation.inputDigests.length < 16 && observation.windowDigests.length < 16, 'Loopback digest retention cap')
      observation.inputDigests.push(hash(canonicalStringify({ system: body.messages[0].content, prompt: body.messages[1].content })))
      observation.windowDigests.push(hash(text))
      const response = producerControlOutput(text)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'synthetic-control', object: 'chat.completion', created: 1, model: CONTROL_MODEL,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: response } }],
        usage: { prompt_tokens: 37, completion_tokens: 21, total_tokens: 58 } }))
    } catch { observation.errors++; res.destroy(new Error('bounded local control failure')) }
  })
  const cleanup = async () => {
    if (closed) return; closed = true
    stopWatch?.(); globalThis.fetch = originalFetch
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
    server.closeAllConnections()
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    active = false
  }
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; endpoint = `${origin}/v1`
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      assert.equal(url.origin, origin, 'No external request is permitted by the offline control')
      assert.equal(url.pathname, '/v1/chat/completions'); assert.equal(init?.redirect, 'error')
      return originalFetch(input, init)
    }
    const { useApiConfig } = await import('../../src/services/apiConfig')
    const configuration = useApiConfig()
    await configureProducerLoopback(endpoint)
    let revision = `local-control-${randomUUID()}`
    stopWatch = watch(configuration.activeConfig, () => { revision = `local-control-${randomUUID()}` }, { deep: true, flush: 'sync' })
    const adapter = createOfflineSdkBodyProducer({ identity: { ...producerControlIdentity(endpoint), configurationRevision: revision },
    currentConfigurationRevision: () => revision })
    return { adapter, endpoint, observeHttp: async () => ({ ...observation, inputDigests: [...observation.inputDigests], windowDigests: [...observation.windowDigests] }), close: cleanup }
  } catch (error) { await cleanup(); throw error }
}
