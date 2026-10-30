/** Pure production-gate negatives plus one real SDK pre-intent overflow. No fake adapter. */
import { createHash } from 'node:crypto'
import { creativeControlConfiguration, creativeControlIdentity } from './creative-pilot-control'
import { createCreativeControlServer, installCreativeNodeStorage } from './creative-pilot-node-server'
import { byteOracle, canonicalOracle, controlAssert } from './creative-pilot-oracles'

export async function runCreativeDispatchControls() {
  const storage = installCreativeNodeStorage(), server = await createCreativeControlServer({ maxAttempts: 1 })
  let assertions = 0, pureCases = 0, actualSdkInvocations = 0, intentCalls = 0
  let failed: Error | null = null
  const verify = (value: unknown) => { controlAssert(value, 'creative_dispatch_control'); assertions++ }
  const failure = (error: unknown) => {
    const result = error instanceof Error ? error : new Error('creative_dispatch_control')
    Object.assign(result, { creativeControlEvidence: { snapshot: null, http: server.observe(), io: { successfulCas: 0 } } })
    return result
  }
  try {
    const { inspectCreativeDispatchRequest, createCreativeOfflineSdkHost, getCreativeOfflineSdkAdapter } = await import('../../src/services/writerCampaign/creativePilotTransport')
    const { CreativePilotError } = await import('../../src/services/writerCampaign/creativePilotProtocol')
    const endpoint = server.endpoint + '/chat/completions', config = creativeControlConfiguration(server.endpoint)
    const wire = { system: 'S', prompt: 'P' }
    const bodyObject = (input = wire) => ({ model: config.selectedModel, temperature: 0.7, max_tokens: 4096, messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.prompt }] })
    const body = JSON.stringify(bodyObject()), init = { method: 'POST', body }
    async function refused(url: unknown, supplied: { method?: string; body?: unknown } | undefined, input = wire) {
      let error: unknown
      try { await inspectCreativeDispatchRequest(url, supplied, endpoint, input, config, () => {}) } catch (caught) { error = caught }
      verify(error instanceof CreativePilotError && error.code === 'transport_wire_invalid'); pureCases++
    }
    const valid = await inspectCreativeDispatchRequest(endpoint, init, endpoint, wire, config, () => {})
    verify(valid.bodyBytes === byteOracle(body) && valid.bodyUtf16 === body.length && valid.bodyDigest === createHash('sha256').update(body).digest('hex')); pureCases++
    const urlValid = await inspectCreativeDispatchRequest(new URL(endpoint), init, endpoint, wire, config, () => {})
    verify(urlValid.bodyDigest === valid.bodyDigest); pureCases++
    await refused(new Request(endpoint, { method: 'POST', body }), init)
    await refused({ toString: () => endpoint }, init)
    await refused(endpoint + '?changed=1', init)
    await refused(endpoint, undefined)
    await refused(endpoint, { ...init, method: 'GET' })
    await refused(endpoint, { ...init, body: new Uint8Array([123, 125]) })
    await refused(endpoint, { ...init, body: new ArrayBuffer(2) })
    await refused(endpoint, { ...init, body: new ReadableStream({ start(controller) { controller.close() } }) })
    await refused(endpoint, { ...init, body: null })
    await refused(endpoint, { ...init, body: '' })
    await refused(endpoint, { ...init, body: '{' })
    await refused(endpoint, { ...init, body: body.replace('{', '{"model":"ignored",') })
    await refused(endpoint, { ...init, body: body.replace('{', '{"mo\\u0064el":"ignored",') })
    for (const change of [
      { model: 'changed' }, { temperature: 0.8 }, { max_tokens: 4095 }, { max_tokens: undefined, max_completion_tokens: 4096 },
      { max_completion_tokens: 4096 }, { stream: false }, { tools: [] }, { messages: [...bodyObject().messages, { role: 'user', content: 'extra' }] },
      { messages: [{ role: 'user', content: wire.system }, bodyObject().messages[1]] },
      { messages: [bodyObject().messages[0], { role: 'user', content: 'changed' }] },
      { messages: [bodyObject().messages[0], { role: 'user', content: [{ type: 'text', text: wire.prompt }] }] },
      { messages: [{ ...bodyObject().messages[0], name: 'extra' }, bodyObject().messages[1]] },
    ]) await refused(endpoint, { ...init, body: JSON.stringify({ ...bodyObject(), ...change }) })
    const overhead = JSON.stringify(bodyObject({ system: 'S', prompt: '' })).length
    const exactWire = { system: 'S', prompt: 'x'.repeat(65536 - overhead) }, exactBody = JSON.stringify(bodyObject(exactWire))
    const boundary = await inspectCreativeDispatchRequest(endpoint, { ...init, body: exactBody }, endpoint, exactWire, config, () => {})
    verify(boundary.bodyBytes === 65536 && boundary.bodyUtf16 === 65536); pureCases++
    const overWire = { system: 'S', prompt: exactWire.prompt + 'x' }
    await refused(endpoint, { ...init, body: JSON.stringify(bodyObject(overWire)) }, overWire)
    const byteWire = { system: 'S', prompt: 'é'.repeat(Math.floor((65536 - overhead) / 2)) + 'x'.repeat((65536 - overhead) % 2) }
    const byteBody = JSON.stringify(bodyObject(byteWire)), byteBound = await inspectCreativeDispatchRequest(endpoint, { ...init, body: byteBody }, endpoint, byteWire, config, () => {})
    verify(byteBound.bodyBytes === 65536 && byteBound.bodyUtf16 < 65536); pureCases++
    await refused(endpoint, { ...init, body: JSON.stringify(bodyObject({ ...byteWire, prompt: byteWire.prompt + 'x' })) }, { ...byteWire, prompt: byteWire.prompt + 'x' })
    await refused(endpoint, { ...init, body: body.replace('"P"', '"\ud800"') })

    // Observe only counts/hash of the actual SDK-created string. Never alter its
    // arguments, receiver or return value, and restore before any next control.
    const captured: Array<{ bytes: number; utf16: number; hash: string }> = []
    let captureCalls = 0
    const original = JSON.stringify
    const host = createCreativeOfflineSdkHost({ identity: creativeControlIdentity(server.endpoint), currentConfigurationRevision: () => 'creative-control-v1', readConfiguration: () => config })
    const adapter = getCreativeOfflineSdkAdapter(host); verify(adapter)
    const inner = canonicalOracle(overWire)
    verify(inner.length <= 65536 && byteOracle(inner) <= 65536)
    let caught: unknown
    try {
      JSON.stringify = function (this: unknown, ...args: Parameters<typeof JSON.stringify>) {
        const result = Reflect.apply(original, this, args)
        const value = args[0] as Record<string, unknown> | null
        if (value && typeof value === 'object' && value.model === config.selectedModel && Array.isArray(value.messages)
          && value.messages.length === 2 && value.messages[0]?.content === overWire.system && value.messages[1]?.content === overWire.prompt) {
          controlAssert(++captureCalls <= 4 && typeof result === 'string', 'creative_dispatch_capture_bound')
          const observed = { bytes: byteOracle(result), utf16: result.length, hash: createHash('sha256').update(result).digest('hex') }
          if (!captured.length) captured.push(observed)
          else controlAssert(captured[0]!.hash === observed.hash && captured[0]!.bytes === observed.bytes && captured[0]!.utf16 === observed.utf16, 'creative_dispatch_capture_changed')
        }
        return result
      } as typeof JSON.stringify
      actualSdkInvocations++
      await adapter!.invoke({ requestHash: 'a'.repeat(64), wire: overWire, signal: new AbortController().signal, beforeRequest: async () => { intentCalls++ } })
    } catch (error) { caught = error }
    finally { JSON.stringify = original }
    verify(caught instanceof CreativePilotError && caught.code === 'transport_wire_invalid')
    verify(captured.length === 1 && captured[0]!.bytes === 65537 && captured[0]!.utf16 === 65537 && /^[a-f0-9]{64}$/.test(captured[0]!.hash))
    verify(intentCalls === 0 && server.observe().attempts === 0 && server.observe().blockedExternalRequests === 0 && server.observe().errors === 0)
    return { assertions, pureCases, actualSdkInvocations, httpAttempts: server.observe().attempts, intentCalls }
  } catch (error) { failed = failure(error); throw failed }
  finally {
    try { await server.close() } catch (error) { throw failed ?? failure(error) }
    finally { storage.dispose() }
  }
}
