import assert from 'node:assert/strict'
import http from 'node:http'
import {
  connectRemoteMcp, probeRemoteMcp, normalizeRemoteMcpServer,
  namespacedMcpToolName, MCP_MAX_RESULT_CHARS,
} from '../src/services/mcp'
import type { RemoteMcpServer } from '../src/types/mcp'

type RequestBody = { id?: number | string; method: string; params?: Record<string, unknown> }
const requests: { path: string; body: RequestBody; auth?: string; protocol?: string; methodHeader?: string }[] = []
let terminated = 0
let abortedRequests = 0
let jinaResult: Record<string, unknown> = {}
const tool = (name: string, readOnly = true) => ({
  name, description: `Mock ${name}`, inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly },
})
const definitions = [tool('lookup_character'), tool('write_note', false), tool('throw_error'), tool('hang'), tool('big_result'), tool('is_error')]

const mock = http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(405).end(); return }
  if (req.method === 'DELETE') { terminated++; res.writeHead(204).end(); return }
  let raw = ''
  req.on('data', chunk => { raw += chunk })
  req.on('end', () => {
    const body = JSON.parse(raw) as RequestBody
    const path = req.url ?? ''
    requests.push({ path, body, auth: req.headers.authorization, protocol: req.headers['mcp-protocol-version'] as string, methodHeader: req.headers['mcp-method'] as string })
    const result = (data: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(200, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: path === '/modern' ? {
        resultType: 'complete', ttlMs: 0, cacheScope: 'private', ...data as Record<string, unknown>,
      } : data }))
    }
    const error = (code: number, message: string) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code, message } }))
    }
    if (path === '/unauthorized') {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `Token ${req.headers.authorization}` }))
      return
    }
    if (path === '/hang-init') { res.on('close', () => { abortedRequests++ }); return }
    if (body.method === 'server/discover') {
      if (path !== '/modern') { error(-32601, 'Method not found'); return }
      result({
        supportedVersions: ['2026-07-28'], capabilities: { tools: {}, resources: {}, prompts: {} },
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Mock modern', version: '1.0.0' } },
      })
      return
    }
    if (body.method === 'initialize') {
      result({ protocolVersion: '2025-11-25', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'Mock legacy', version: '1.0.0' } }, { 'mcp-session-id': 'smoke-session' })
      return
    }
    if (body.id === undefined) { res.writeHead(202).end(); return }
    if (body.method === 'tools/list') {
      if (path === '/jina-compat') {
        result({ tools: [tool('search_web'), tool('read_url')] })
      } else if (path === '/endless') {
        const page = Number(body.params?.cursor ?? '0')
        result({ tools: [tool(`page_${page}`)], nextCursor: String(page + 1) })
      } else if (path === '/oversize') {
        result({ tools: [tool('huge'), ...Array.from({ length: 70 }, (_, index) => tool(`extra_${index}`))] })
      } else result({ tools: definitions })
      return
    }
    if (body.method === 'resources/list') {
      result({ resources: [{ uri: 'novel://facts', name: '人物资料', mimeType: 'text/plain' }] }); return
    }
    if (body.method === 'prompts/list') {
      result({ prompts: [{ name: 'character-review', description: 'Review facts', arguments: [{ name: 'character', required: true }] }] }); return
    }
    if (body.method === 'resources/read') {
      result({ contents: [{ uri: 'novel://facts', text: '林遥：第一章目击灯塔失火。' }] }); return
    }
    if (body.method === 'prompts/get') {
      result({ messages: [{ role: 'user', content: { type: 'text', text: `检查 ${(body.params?.arguments as Record<string, string>)?.character} 的人物一致性` } }] }); return
    }
    if (body.method === 'tools/call') {
      if (path === '/jina-compat') { result(jinaResult); return }
      if (body.params?.name === 'throw_error') { error(-32603, `Server error containing ${req.headers.authorization}`); return }
      if (body.params?.name === 'hang') { res.on('close', () => { abortedRequests++ }); return }
      if (body.params?.name === 'big_result') {
        const args = body.params?.arguments as Record<string, unknown>
        result({ content: [{ type: 'text', text: '文'.repeat(args?.name === 'overflow' ? 400_000 : 40_000) }] }); return
      }
      if (body.params?.name === 'is_error') { result({ content: [{ type: 'text', text: '人物不存在' }], isError: true }); return }
      result({ content: [{ type: 'text', text: '林遥：目击者' }], structuredContent: { character: '林遥', role: '目击者' } }); return
    }
    error(-32601, 'Method not found')
  })
})

await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve))
const address = mock.address()
if (!address || typeof address === 'string') throw new Error('Missing mock address')
const origin = `http://127.0.0.1:${address.port}`
const config = (path: string, overrides: Partial<RemoteMcpServer> = {}): RemoteMcpServer => ({
  id: 'library', name: '资料服务', url: `${origin}${path}`, enabled: true,
  allowedTools: ['lookup_character', 'throw_error', 'hang', 'big_result', 'is_error'], ...overrides,
})
const execution = (abortSignal?: AbortSignal) => ({ toolCallId: 'test', messages: [], context: {}, abortSignal })
const connections: Awaited<ReturnType<typeof connectRemoteMcp>>[] = []

try {
  assert.throws(() => normalizeRemoteMcpServer({ ...config('/modern'), url: 'http://example.com/mcp' }), /HTTPS/)
  assert.throws(() => normalizeRemoteMcpServer({ ...config('/modern'), url: 'https://user:secret@example.com/mcp' }), /密码/)
  assert.throws(() => normalizeRemoteMcpServer({ ...config('/modern'), url: 'https://example.com/mcp?api_key=secret' }), /Bearer/)
  const normalized = normalizeRemoteMcpServer({ ...config('/modern'), allowedTools: ['lookup_character', 'lookup_character'], bearerToken: 'secret' })
  assert.deepEqual(normalized.allowedTools, ['lookup_character'])
  assert.equal('bearerToken' in normalized, false)
  assert.match(namespacedMcpToolName('server-a', 'tool/with punctuation'), /^[a-zA-Z0-9_]{1,64}$/)
  assert.notEqual(namespacedMcpToolName('server-a', 'lookup'), namespacedMcpToolName('server-b', 'lookup'))

  for (const path of ['/modern', '/legacy']) {
    const connection = await connectRemoteMcp(config(path), { bearerToken: 'test-token' })
    connections.push(connection)
    assert.equal(connection.discovery.protocolVersion, path === '/modern' ? '2026-07-28' : '2025-11-25')
    assert.equal(connection.discovery.tools.length, 6)
    assert.equal(connection.discovery.resources[0]?.uri, 'novel://facts')
    assert.equal(connection.discovery.prompts[0]?.name, 'character-review')
    assert.equal(connection.tools[namespacedMcpToolName('library', 'write_note')], undefined, 'Annotations must not grant permission')
    const lookup = connection.tools[namespacedMcpToolName('library', 'lookup_character')]
    const beforeInvalidArgs = requests.length
    await assert.rejects(lookup.execute!('invalid', execution()) as Promise<unknown>, /参数无效/)
    await assert.rejects(lookup.execute!({ name: '文'.repeat(33_000) }, execution()) as Promise<unknown>, /大小限制/)
    assert.equal(requests.length, beforeInvalidArgs)
    const result = await lookup.execute!({ name: '林遥' }, execution()) as Record<string, unknown>
    assert.deepEqual(result.structuredContent, { character: '林遥', role: '目击者' })
    assert.match((await connection.readResource('novel://facts')).text, /灯塔失火/)
    await assert.rejects(connection.readResource('novel://unlisted'), /已发现/)
    await assert.rejects(connection.getPrompt('character-review'), /必填/)
    assert.match((await connection.getPrompt('character-review', { character: '林遥' })).text, /林遥/)
    await assert.rejects(connection.tools[namespacedMcpToolName('library', 'throw_error')].execute!({}, execution()) as Promise<unknown>, error => {
      assert.ok(error instanceof Error)
      assert.equal(error.message.includes('test-token'), false)
      return true
    })
    const large = await connection.tools[namespacedMcpToolName('library', 'big_result')].execute!({}, execution()) as { content: { text: string }[] }
    assert.ok(large.content[0].text.length < MCP_MAX_RESULT_CHARS + 100)
    assert.match(large.content[0].text, /已截断/)
    await assert.rejects(connection.tools[namespacedMcpToolName('library', 'big_result')].execute!({ name: 'overflow' }, execution()) as Promise<unknown>)
    const toolError = await connection.tools[namespacedMcpToolName('library', 'is_error')].execute!({}, execution()) as { isError: boolean }
    assert.equal(toolError.isError, true)
    await connection.close()
    await connection.close()
    await assert.rejects(lookup.execute!({}, execution()) as Promise<unknown>, { name: 'AbortError' })
  }
  assert.ok(terminated > 0, 'Legacy sessions terminate on close')
  assert.equal(requests.filter(request => request.path === '/modern' && request.body.method === 'initialize').length, 0)
  assert.ok(requests.some(request => request.path === '/legacy' && request.body.method === 'initialize'))
  assert.ok(requests.filter(request => request.path === '/modern').every(request => request.protocol === '2026-07-28'))
  assert.ok(requests.some(request => request.path === '/modern' && request.body.method === 'tools/call' && request.methodHeader === 'tools/call'))
  assert.ok(requests.filter(request => ['/modern', '/legacy'].includes(request.path)).every(request => request.auth === 'Bearer test-token'))

  // Exercise the production adapter/SDK while routing every endpoint to the
  // local fixture. No Jina credential, real search, or external request is used.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => originalFetch(`${origin}/jina-compat`, init)
  try {
    const query = 'site:nps.gov "Fresnel lens" synthetic-private-query'
    const authContent = (text: string, status = 'Unauthorized') => ({ type: 'text', text: `Error: Search failed for query "${text}": ${status}` })
    const authFailure = { content: [authContent(query)], isError: false }
    const sanitizedFailure = { content: [{ type: 'text', text: 'MCP 鉴权失败，请检查本次会话的 Token' }], isError: true }
    for (const url of ['https://mcp.jina.ai/v1?include_tools=search_web,read_url', 'https://mcp.jina.ai/sse']) {
      const jina = await connectRemoteMcp(config('/jina-compat', { url, allowedTools: ['search_web', 'read_url'] }))
      connections.push(jina)
      const search = jina.tools[namespacedMcpToolName('library', 'search_web')]
      const execute = () => search.execute!({ query }, execution()) as Promise<Record<string, unknown>>
      jinaResult = authFailure
      assert.deepEqual(await execute(), sanitizedFailure, 'Jina authentication failures must not be reported as success or echo the query')
      jinaResult = { content: [authContent(query, 'Forbidden')], isError: false }
      assert.deepEqual(await execute(), sanitizedFailure)
      jinaResult = { content: [authContent(query), authContent('second query', 'Forbidden')], isError: false }
      assert.deepEqual(await search.execute!({ query: [query, 'second query'] }, execution()), sanitizedFailure)
      for (const unchanged of [
        { content: [{ type: 'text', text: `A source discusses this message: ${authContent(query).text}` }], isError: false },
        { content: [authContent('another query')], isError: false },
        { content: [authContent(query, 'Gateway Timeout')], isError: false },
        { content: [authContent(query), { type: 'text', text: 'A successful search result' }], isError: false },
        { ...authFailure, structuredContent: { document: 'a source containing an error example' } },
        { ...authFailure, isError: true },
      ]) {
        jinaResult = unchanged
        assert.deepEqual(await execute(), unchanged, 'Only the exact unflagged auth envelope is normalized')
      }
      jinaResult = authFailure
      assert.deepEqual(await jina.tools[namespacedMcpToolName('library', 'read_url')].execute!({ query }, execution()), authFailure,
        'Document contents from other Jina tools remain unchanged')
      await jina.close()
    }
    for (const url of ['https://mcp.jina.ai.example/v1', 'https://example.com/v1', 'https://mcp.jina.ai/custom']) {
      const other = await connectRemoteMcp(config('/jina-compat', { url, allowedTools: ['search_web'] }))
      connections.push(other)
      jinaResult = authFailure
      assert.deepEqual(await other.tools[namespacedMcpToolName('library', 'search_web')].execute!({ query }, execution()), authFailure,
        'Other servers and endpoints retain standard MCP result semantics')
      await other.close()
    }
  } finally { globalThis.fetch = originalFetch }

  const disabled = await connectRemoteMcp(config('/modern', { enabled: false, allowedTools: ['write_note'] }))
  connections.push(disabled)
  assert.equal(Object.keys(disabled.tools).length, 0)
  await disabled.close()
  const explicitWrite = await connectRemoteMcp(config('/modern', { allowedTools: ['write_note'] }))
  connections.push(explicitWrite)
  assert.equal(Object.keys(explicitWrite.tools).length, 1, 'Explicit per-tool selection authorizes execution')
  await explicitWrite.close()
  await assert.rejects(connectRemoteMcp(config('/modern', { allowedTools: ['removed_tool'] })), /工具不可用/)
  assert.equal((await probeRemoteMcp(config('/modern', { allowedTools: ['removed_tool'] }))).tools.length, 6, 'Probe can recover stale selections without exposing executable tools')
  assert.equal((await probeRemoteMcp(config('/endless', { allowedTools: [] }))).tools.length, 5)
  assert.equal((await probeRemoteMcp(config('/endless', { allowedTools: [] }))).truncated, true)
  assert.equal((await probeRemoteMcp(config('/oversize', { allowedTools: [] }))).tools.length, 64)
  assert.equal((await probeRemoteMcp(config('/oversize', { allowedTools: [] }))).truncated, true)
  await assert.rejects(probeRemoteMcp(config('/unauthorized'), { bearerToken: 'private-token' }), error => {
    assert.ok(error instanceof Error)
    assert.equal(error.message.includes('private-token'), false)
    return true
  })
  await assert.rejects(probeRemoteMcp(config('/hang-init'), { timeoutMs: 40 }), { name: 'TimeoutError' })
  const alreadyCancelled = new AbortController()
  alreadyCancelled.abort()
  const beforeCancelled = requests.length
  await assert.rejects(probeRemoteMcp(config('/modern'), { signal: alreadyCancelled.signal }), { name: 'AbortError' })
  assert.equal(requests.length, beforeCancelled)

  const hanging = await connectRemoteMcp(config('/modern'))
  connections.push(hanging)
  const cancel = new AbortController()
  const task = hanging.tools[namespacedMcpToolName('library', 'hang')].execute!({}, execution(cancel.signal)) as Promise<unknown>
  setTimeout(() => cancel.abort(), 30)
  await assert.rejects(task, { name: 'AbortError' })
  await hanging.close()
  const before = requests.length
  await assert.rejects(hanging.tools[namespacedMcpToolName('library', 'lookup_character')].execute!({}, execution()) as Promise<unknown>, { name: 'AbortError' })
  assert.equal(requests.length, before, 'Cancelled connection must not execute subsequent tools')
  assert.ok(abortedRequests >= 1)
  console.log('Passed MCP modern/legacy HTTP discovery, opt-in tools, previews, limits, Jina auth compatibility, cancellation and cleanup')
} finally {
  await Promise.allSettled(connections.map(connection => connection.close()))
  mock.closeAllConnections()
  await new Promise<void>(resolve => mock.close(() => resolve()))
}
