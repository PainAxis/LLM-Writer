/** Bounded local HTTP control; import has no server, SDK, credential or network side effect. */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { CREATIVE_CONTROL_MODES, creativeControlReply, type CreativeControlMode, type CreativeHttpObservation } from './creative-pilot-control'
import { controlAssert } from './creative-pilot-oracles'

export interface CreativeControlServer {
  origin: string; endpoint: string
  observe(): CreativeHttpObservation
  setMode(mode: CreativeControlMode): void
  release(): void
  close(): Promise<void>
}
export async function createCreativeControlServer(options: {
  maxAttempts?: number; guardNodeFetch?: boolean
  serve?: (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void>
} = {}): Promise<CreativeControlServer> {
  const maximum = options.maxAttempts ?? 128
  controlAssert(Number.isInteger(maximum) && maximum > 0 && maximum <= 256)
  const observation: CreativeHttpObservation = { activeRequests: 0, maxActiveRequests: 0, attempts: 0, errors: 0, blockedExternalRequests: 0, records: [] }
  let mode: CreativeControlMode = 'normal', releaseHold: (() => void) | null = null, closed = false, origin = ''
  const originalFetch = globalThis.fetch
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && options.serve) { try { await options.serve(req, res) } catch { res.writeHead(404); res.end() }; return }
    if (req.method === 'POST') { observation.attempts++; observation.activeRequests++; observation.maxActiveRequests = Math.max(observation.maxActiveRequests, observation.activeRequests) }
    try {
      controlAssert(req.method === 'POST' && req.url === '/v1/chat/completions' && observation.attempts <= maximum)
      const chunks: Uint8Array[] = []; let bytes = 0
      for await (const chunk of req) { bytes += chunk.length; controlAssert(bytes <= 65536); chunks.push(chunk) }
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
      const capturedMode = mode, reply = await creativeControlReply(raw, capturedMode)
      controlAssert(observation.records.length < maximum)
      observation.records.push(reply.record)
      if (capturedMode === 'hold') {
        controlAssert(releaseHold === null)
        await new Promise<void>(resolve => { releaseHold = resolve })
        releaseHold = null
      }
      if (capturedMode === 'lost_response') { res.destroy(); return }
      if (capturedMode === 'http_redirect') { res.writeHead(302, { location: 'https://example.invalid/must-not-follow' }); res.end(); return }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      if (capturedMode === 'http_invalid_utf8') res.end(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]))
      else res.end(reply.body)
    } catch { observation.errors++; res.destroy() } finally { if (req.method === 'POST') observation.activeRequests-- }
  })
  const close = async () => {
    if (closed) return
    closed = true; releaseHold?.(); releaseHold = null
    if (options.guardNodeFetch !== false) globalThis.fetch = originalFetch
    server.closeAllConnections()
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
  }
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    if (options.guardNodeFetch !== false) globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      if (url.origin !== origin || url.pathname !== '/v1/chat/completions' || url.search || url.hash) { observation.blockedExternalRequests++; return Promise.reject(new Error('creative_control_external_request')) }
      controlAssert(init?.redirect === 'error' && init.method === 'POST')
      return originalFetch(input, init)
    }
    return { origin, endpoint: origin + '/v1', observe: () => structuredClone(observation), setMode(next) { controlAssert((CREATIVE_CONTROL_MODES as readonly string[]).includes(next) && releaseHold === null); mode = next }, release() { releaseHold?.() }, close }
  } catch (error) { await close(); throw error }
}
/** A private Node storage namespace, installed before any lazy production import. */
export function installCreativeNodeStorage() {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), rows = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, String(value)) }, removeItem: (key: string) => { rows.delete(key) }, clear: () => rows.clear(), key: (index: number) => [...rows.keys()][index] ?? null, get length() { return rows.size } } })
  return { rows, dispose() { if (old) Object.defineProperty(globalThis, 'localStorage', old); else Reflect.deleteProperty(globalThis, 'localStorage') } }
}
