/** Local, synthetic OpenAI/Anthropic + MCP business fixture. Never proxies traffic. */
import http from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

export const CHAPTER_EVIDENCE = '林遥在第一章把银钥匙交给沈青，约定三日后在灯塔重逢。'
export const SKILL_EVIDENCE = '参考约束：重逢时先核对银钥匙，再解释三日之约。'
export const MCP_EVIDENCE = '资料库证据：灯塔位于城北，钥匙属于林遥。'
export const FINAL_REPLY = '依据第一章与资料：银钥匙由林遥交给沈青，两人约定三日后在城北灯塔重逢。'

const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
async function publicFiles(directory, prefix = '') {
  const files = new Map()
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
    const local = join(directory, entry.name)
    const url = `${prefix}/${entry.name}`
    if (entry.isDirectory()) for (const [name, file] of await publicFiles(local, url)) files.set(name, file)
    else if (entry.isFile() && types[extname(entry.name)]) files.set(url, { body: await readFile(local), type: types[extname(entry.name)] })
  }
  if (!prefix && files.has('/index.html')) files.set('/', files.get('/index.html'))
  return files
}

export async function startExtensionFixture({ distDir, mcpEvidence = MCP_EVIDENCE } = {}) {
  const files = distDir ? await publicFiles(distDir) : new Map()
  const captured = []
  const mcpRequests = []
  const pending = new Set()
  const metrics = { toolCalls: 0, forbiddenCalls: 0, closedSessions: 0, cancelledCalls: 0 }
  const toolDefinitions = [
    { name: 'get_evidence', description: 'Read the synthetic novel source.', annotations: { title: '读取灯塔资料', readOnlyHint: true }, inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['ok', 'delay', 'error'] } }, required: ['mode'], additionalProperties: false } },
    { name: 'write_forbidden', description: 'This tool must remain unauthorized.', inputSchema: { type: 'object', properties: {} }, annotations: { title: '禁止写入资料', readOnlyHint: false, destructiveHint: true } },
  ]

  const server = http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store')
    const path = (req.url || '/').split('?')[0]
    const send = (status, value, contentType = 'application/json') => {
      res.writeHead(status, { 'content-type': contentType })
      res.end(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    }
    if (req.method === 'GET' && files.has(path)) { const file = files.get(path); send(200, file.body, file.type); return }
    if (path === '/__test/mcp') {
      if (req.method === 'DELETE') { metrics.closedSessions++; send(204, ''); return }
      if (req.method === 'GET') { send(405, ''); return }
    }
    if (req.method === 'GET' && path === '/__test/v1/models') { send(200, { data: ['extension-writing', 'extension-mcp-delay', 'extension-loop'].map(id => ({ id })) }); return }
    let body
    try { const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); body = JSON.parse(Buffer.concat(chunks).toString()) }
    catch { send(400, { error: 'Invalid fixture request' }); return }
    if (path === '/__test/mcp') {
      mcpRequests.push({ body, headers: req.headers })
      const result = value => send(200, { jsonrpc: '2.0', id: body.id, result: value })
      const error = message => send(200, { jsonrpc: '2.0', id: body.id, error: { code: -32601, message } })
      if (body.method === 'server/discover') { error('Legacy fixture'); return }
      if (body.method === 'initialize') { res.setHeader('mcp-session-id', 'extension-fixture-session'); result({ protocolVersion: '2025-11-25', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'Extension business fixture', version: '1.0.0' } }); return }
      if (body.id === undefined) { send(202, ''); return }
      if (body.method === 'tools/list') { result({ tools: toolDefinitions }); return }
      if (body.method === 'resources/list') { result({ resources: [{ uri: 'novel://lighthouse', name: '灯塔档案', mimeType: 'text/plain' }] }); return }
      if (body.method === 'prompts/list') { result({ prompts: [{ name: 'review-lighthouse', description: '核对灯塔约定', arguments: [{ name: 'character', required: true }] }] }); return }
      if (body.method === 'resources/read') { result({ contents: [{ uri: 'novel://lighthouse', text: mcpEvidence }] }); return }
      if (body.method === 'prompts/get') { result({ messages: [{ role: 'user', content: { type: 'text', text: `核对 ${body.params.arguments.character} 的银钥匙与三日之约。` } }] }); return }
      if (body.method === 'tools/call') {
        metrics.toolCalls++
        if (body.params.name === 'write_forbidden') metrics.forbiddenCalls++
        const reply = () => { if (!res.destroyed) result(body.params.arguments?.mode === 'error' ? { isError: true, content: [{ type: 'text', text: '合成资料查询失败' }] } : { content: [{ type: 'text', text: mcpEvidence }] }) }
        if (body.params.arguments?.mode === 'delay') {
          pending.add(reply)
          res.on('close', () => { metrics.cancelledCalls++; pending.delete(reply) })
          return
        }
        reply(); return
      }
      error('Unknown synthetic MCP method'); return
    }
    const anthropic = path === '/__test/anthropic/messages'
    if (!anthropic && path !== '/__test/v1/chat/completions') { send(404, { error: 'Unknown synthetic endpoint' }); return }
    captured.push({ path, body, headers: req.headers })
    const messages = body.messages || []
    const toolResults = anthropic ? messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'tool_result') : []) : messages.filter(message => message.role === 'tool')
    const second = toolResults.length > 0
    const model = body.model
    if (model === 'extension-second-fail' && second) { send(503, { ...(anthropic ? { type: 'error' } : {}), error: { type: 'api_error', message: 'Synthetic second step failure' } }); return }
    let call
    if ((!second || model === 'extension-loop') && model !== 'extension-context-only') {
      const available = anthropic ? (body.tools || []).map(tool => ({ name: tool.name, schema: tool.input_schema })) : (body.tools || []).map(tool => ({ name: tool.function.name, schema: tool.function.parameters }))
      if (model.startsWith('extension-mcp') || model === 'extension-loop') {
        const selected = available.find(tool => tool.name.includes('get_evidence'))
        call = { name: selected?.name || 'mcp_unknown', args: { mode: model.endsWith('-delay') ? 'delay' : model.endsWith('-error') ? 'error' : 'ok' } }
      } else if (model.startsWith('extension-skill') || model === 'extension-budget-result') {
        const selected = available.find(tool => tool.name === 'writing_skill_read_reference')
        call = { name: 'writing_skill_read_reference', args: { skillId: selected?.schema.properties.skillId.enum[0], path: 'references/evidence.md', maxChars: 8000 } }
      } else if (model === 'extension-denied') call = { name: 'writing_read_material', args: { id: 1, kind: 'characters' } }
      else call = { name: 'writing_read_chapter', args: { id: Number(/chapter-id=(\d+)/.exec(JSON.stringify(messages))?.[1] || 11) } }
    }
    const input = second ? 17 : 11
    const output = second ? 5 : 3
    const id = `fixture-${captured.length}`
    const finalReply = model === 'extension-denied' ? '所请求工具未获授权，无法读取该创作材料。' : FINAL_REPLY
    if (!body.stream) {
      if (anthropic) send(200, { id, type: 'message', role: 'assistant', model, content: call ? [{ type: 'tool_use', id: `call-${id}`, name: call.name, input: call.args }] : [{ type: 'text', text: finalReply }], stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: input, output_tokens: output } })
      else send(200, { id, object: 'chat.completion', created: 1, model, choices: [{ index: 0, message: { role: 'assistant', content: call ? null : finalReply, ...(call ? { tool_calls: [{ id: `call-${id}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : {}) }, finish_reason: call ? 'tool_calls' : 'stop' }], ...(model === 'extension-no-usage' ? {} : { usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } }) })
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const emit = (event, data) => res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`)
    if (anthropic) {
      emit('message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: input, output_tokens: 0 } } })
      emit('content_block_start', { type: 'content_block_start', index: 0, content_block: call ? { type: 'tool_use', id: `call-${id}`, name: call.name, input: {} } : { type: 'text', text: '' } })
      emit('content_block_delta', { type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(call.args) } : { type: 'text_delta', text: finalReply } })
      emit('content_block_stop', { type: 'content_block_stop', index: 0 })
      emit('message_delta', { type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: output } })
      emit('message_stop', { type: 'message_stop' })
      res.end()
    } else {
      const common = { id, object: 'chat.completion.chunk', created: 1, model }
      emit('', { ...common, choices: [{ index: 0, delta: call ? { tool_calls: [{ index: 0, id: `call-${id}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: finalReply }, finish_reason: null }] })
      emit('', { ...common, choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }], ...(model === 'extension-no-usage' ? {} : { usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output } }) })
      res.end('data: [DONE]\n\n')
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return {
    origin: `http://127.0.0.1:${server.address().port}`, captured, mcpRequests, metrics,
    releasePending() { for (const reply of pending) reply(); pending.clear() },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) },
  }
}
