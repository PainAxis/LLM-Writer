import type { MCPClient, ListToolsResult, CallToolResult } from '@ai-sdk/mcp'
import type { ToolSet, JSONSchema7 } from 'ai'
import type {
  McpConnectionOptions, McpContentPreview, McpDiscovery, McpRequestOptions,
  RemoteMcpConnection, RemoteMcpServer,
} from '@/types/mcp'

export const MCP_CONNECTION_TIMEOUT_MS = 15_000
export const MCP_REQUEST_TIMEOUT_MS = 30_000
export const MCP_MAX_RESULT_CHARS = 24_000
const MAX_RESPONSE_BYTES = 1_000_000
const MAX_DISCOVERY_PAGES = 5
const MAX_TOOLS = 64
const MAX_RESOURCES = 100
const MAX_PROMPTS = 50
const MAX_SCHEMA_CHARS = 16_000
const MAX_TOOL_DEFINITION_CHARS = 100_000

export class McpConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpConnectionError'
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpConnectionError('MCP 服务器配置无效')
  }
  return value as Record<string, unknown>
}

/** Validate persisted metadata and omit all unknown fields, including credentials. */
export function normalizeRemoteMcpServer(value: unknown): RemoteMcpServer {
  const source = record(value)
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  const name = typeof source.name === 'string' ? source.name.trim() : ''
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new McpConnectionError('MCP 服务器 ID 无效')
  if (!name || name.length > 80) throw new McpConnectionError('MCP 服务器名称须为 1 至 80 个字符')
  if (typeof source.url !== 'string' || source.url.length > 2048) {
    throw new McpConnectionError('MCP 地址无效')
  }
  let url: URL
  try { url = new URL(source.url.trim()) } catch { throw new McpConnectionError('请输入完整的 MCP HTTP 地址') }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\./.test(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new McpConnectionError('远程 MCP 地址须使用 HTTPS；本机服务可使用 HTTP')
  }
  if (url.username || url.password || url.hash) {
    throw new McpConnectionError('MCP 地址不能包含用户名、密码或片段')
  }
  for (const key of url.searchParams.keys()) {
    if (/^(api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|token|key|secret|authorization|password)$/i.test(key)) {
      throw new McpConnectionError('请通过本次会话的 Bearer Token 输入鉴权信息')
    }
  }
  const allowedTools = Array.isArray(source.allowedTools)
    ? [...new Set(source.allowedTools.filter((tool): tool is string => typeof tool === 'string'))]
    : []
  if (allowedTools.length > MAX_TOOLS || allowedTools.some(tool => !tool || tool.length > 128)) {
    throw new McpConnectionError('MCP 工具选择无效或超过数量限制')
  }
  return { id, name, url: url.href, enabled: source.enabled === true, allowedTools }
}

/** Stable provider-safe names distinguish identical tool names on different servers. */
export function namespacedMcpToolName(serverId: string, toolName: string): string {
  const value = `${serverId}:${toolName}`
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  const safe = (text: string, length: number) => text.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, length)
  return `mcp_${safe(serverId, 16)}_${safe(toolName, 24)}_${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function timeoutMs(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(120_000, Math.max(10, value)) : fallback
}

function cancelled(): DOMException { return new DOMException('MCP 请求已取消', 'AbortError') }
function timedOut(): DOMException { return new DOMException('MCP 请求超时，请检查服务后重试', 'TimeoutError') }

function safeError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted) return signal.reason?.name === 'TimeoutError' ? timedOut() : cancelled()
  if (error instanceof McpConnectionError) return error
  // Do not expose server-controlled errors, response bodies, headers or credentials.
  let candidate: unknown = error
  for (let depth = 0; depth < 4 && candidate && typeof candidate === 'object'; depth++) {
    const details = candidate as Record<string, unknown>
    if (details.statusCode === 401 || details.statusCode === 403) {
      return new McpConnectionError('MCP 鉴权失败，请检查本次会话的 Token')
    }
    candidate = details.cause
  }
  return new McpConnectionError('MCP 请求失败，请检查地址、鉴权及服务器的浏览器 CORS 配置')
}

function clip(text: string): McpContentPreview {
  return text.length <= MCP_MAX_RESULT_CHARS ? { text, truncated: false } : {
    text: `${text.slice(0, MCP_MAX_RESULT_CHARS)}\n[MCP 内容超过预览预算，已截断]`, truncated: true,
  }
}

function normalizeJinaSearchAuthError(
  server: RemoteMcpServer, toolName: string, args: Record<string, unknown>, result: CallToolResult,
): CallToolResult {
  if (toolName !== 'search_web' || result.isError || result.structuredContent !== undefined || !Array.isArray(result.content)) return result
  const url = new URL(server.url)
  if (url.origin !== 'https://mcp.jina.ai' || !['/v1', '/sse'].includes(url.pathname)) return result
  const queries = typeof args.query === 'string' ? [args.query] : args.query
  if (!Array.isArray(queries) || !queries.length || queries.length > 5 ||
      queries.some(query => typeof query !== 'string') || result.content.length !== queries.length) return result
  // Jina's search formatter currently omits isError for failed upstream searches.
  // Match its complete auth envelope against the actual queries, never prose that
  // merely mentions an error, another tool's document, or another MCP server.
  const authenticationFailed = result.content.every((part, index) => part && typeof part === 'object' && part.type === 'text' &&
    ['Unauthorized', 'Forbidden'].some(status => part.text === `Error: Search failed for query "${queries[index]}": ${status}`))
  return authenticationFailed ? {
    content: [{ type: 'text', text: 'MCP 鉴权失败，请检查本次会话的 Token' }], isError: true,
  } : result
}

function boundedToolResult(result: CallToolResult): CallToolResult {
  const serialized = JSON.stringify(result)
  if (serialized.length <= MCP_MAX_RESULT_CHARS) return result
  const text = Array.isArray(result.content)
    ? result.content.flatMap(part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n')
    : ''
  return {
    content: [{ type: 'text', text: clip(text || serialized).text }],
    ...(result.isError ? { isError: true } : {}),
  }
}

/** Maintained SDK handles protocol negotiation, JSON-RPC and transport semantics. */
export async function connectRemoteMcp(
  input: RemoteMcpServer, options: McpConnectionOptions = {},
): Promise<RemoteMcpConnection> {
  const server = normalizeRemoteMcpServer(input)
  if (options.signal?.aborted) throw cancelled()
  const token = options.bearerToken?.trim()
  if (token && (token.length > 8192 || /[\r\n]/.test(token))) {
    throw new McpConnectionError('Bearer Token 格式无效')
  }
  const lifetime = new AbortController()
  let client: MCPClient | undefined
  let closed = false
  let closePromise: Promise<void> | undefined
  const close = (): Promise<void> => {
    if (closePromise) return closePromise
    closed = true
    lifetime.abort(cancelled())
    clearTimeout(setupTimer)
    options.signal?.removeEventListener('abort', abortFromCaller)
    closePromise = client?.close().catch(() => undefined) ?? Promise.resolve()
    return closePromise
  }
  const abortFromCaller = () => {
    lifetime.abort(options.signal?.reason?.name === 'TimeoutError' ? timedOut() : cancelled())
    void close()
  }
  if (options.signal?.aborted) abortFromCaller()
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const setupTimer = setTimeout(() => { lifetime.abort(timedOut()); void close() },
    timeoutMs(options.timeoutMs, MCP_CONNECTION_TIMEOUT_MS))

  const run = async <T>(
    task: (scope: { signal: AbortSignal; timeout: number }) => Promise<T>,
    requestOptions: McpRequestOptions = {},
  ): Promise<T> => {
    if (closed || lifetime.signal.aborted) throw safeError(cancelled(), lifetime.signal)
    const controller = new AbortController()
    const requestTimeout = timeoutMs(requestOptions.timeoutMs, MCP_REQUEST_TIMEOUT_MS)
    const abort = () => {
      controller.abort(requestOptions.signal?.reason?.name === 'TimeoutError' ? timedOut() : cancelled())
      void close()
    }
    if (requestOptions.signal?.aborted) abort()
    else requestOptions.signal?.addEventListener('abort', abort, { once: true })
    const signal = AbortSignal.any([lifetime.signal, controller.signal])
    const timer = setTimeout(() => { controller.abort(timedOut()); void close() }, requestTimeout)
    try {
      signal.throwIfAborted()
      const result = await task({ signal, timeout: requestTimeout })
      signal.throwIfAborted()
      return result
    } catch (error) {
      throw safeError(error, signal)
    } finally {
      clearTimeout(timer)
      requestOptions.signal?.removeEventListener('abort', abort)
    }
  }

  // Bound JSON and SSE response bodies before the SDK parses them. Never forward cookies.
  const boundedFetch: typeof fetch = async (url, init) => {
    // Legacy session termination must still run after cancelling active requests.
    const baseSignal = init?.method === 'DELETE' ? AbortSignal.timeout(2_000) : lifetime.signal
    const signal = AbortSignal.any([baseSignal, ...(init?.signal ? [init.signal] : [])])
    const response = await fetch(url, { ...init, signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })
    if (!response.body) return response
    const reader = response.body.getReader()
    let bytes = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read()
          if (chunk.done) { controller.close(); return }
          bytes += chunk.value.byteLength
          if (bytes > MAX_RESPONSE_BYTES) {
            await reader.cancel()
            controller.error(new McpConnectionError('MCP 响应超过大小限制'))
            return
          }
          controller.enqueue(chunk.value)
        } catch (error) { controller.error(error) }
      },
      cancel(reason) { return reader.cancel(reason) },
    })
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }

  try {
    lifetime.signal.throwIfAborted()
    const { createMCPClient } = await import('@ai-sdk/mcp')
    const { dynamicTool, jsonSchema } = await import('ai')
    lifetime.signal.throwIfAborted()
    client = await createMCPClient({
      transport: { type: 'http', url: server.url, headers: token ? { Authorization: `Bearer ${token}` } : undefined, fetch: boundedFetch },
      clientName: 'LLM-Writer', version: '1.0.2', maxRetries: 0,
      initializationOptions: { signal: lifetime.signal, timeout: timeoutMs(options.timeoutMs, MCP_CONNECTION_TIMEOUT_MS) },
      onUncaughtError: () => { /* Public operations sanitize server-controlled errors. */ },
    })
    lifetime.signal.throwIfAborted()
    const activeClient = client
    let truncated = false
    const paginate = async <T>(limit: number, load: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>): Promise<T[]> => {
      const items: T[] = []
      const seen = new Set<string>()
      let cursor: string | undefined
      for (let page = 0; page < MAX_DISCOVERY_PAGES; page++) {
        const result = await load(cursor)
        const remaining = limit - items.length
        items.push(...result.items.slice(0, remaining))
        if (result.items.length > remaining) truncated = true
        cursor = result.nextCursor
        if (!cursor) return items
        if (items.length >= limit || seen.has(cursor)) { truncated = true; return items }
        seen.add(cursor)
      }
      truncated = true
      return items
    }
    const capabilities = activeClient.initializeResult.capabilities
    const definitions = capabilities.tools ? await paginate(MAX_TOOLS, cursor => run(async request => {
      const result = await activeClient.listTools({ params: cursor ? { cursor } : undefined, options: request })
      return { items: result.tools, nextCursor: result.nextCursor }
    })) : []
    const resources = capabilities.resources ? await paginate(MAX_RESOURCES, cursor => run(async request => {
      const result = await activeClient.listResources({ params: cursor ? { cursor } : undefined, options: request })
      return { items: result.resources, nextCursor: result.nextCursor }
    })) : []
    const prompts = capabilities.prompts ? await paginate(MAX_PROMPTS, cursor => run(async request => {
      const result = await activeClient.experimental_listPrompts({ params: cursor ? { cursor } : undefined, options: request })
      return { items: result.prompts, nextCursor: result.nextCursor }
    })) : []
    const toolNames = new Set<string>()
    for (const definition of definitions) {
      if (!definition.name || definition.name.length > 128 || toolNames.has(definition.name)) {
        throw new McpConnectionError('MCP 返回了重复或无效的工具名称')
      }
      toolNames.add(definition.name)
      if (JSON.stringify(definition.inputSchema).length > MAX_SCHEMA_CHARS) {
        throw new McpConnectionError('MCP 工具参数定义超过大小限制')
      }
    }
    const boundedDefinitions: ListToolsResult = { tools: definitions.map(definition => ({
      ...definition, description: definition.description?.slice(0, 2048),
    })) }
    if (JSON.stringify(boundedDefinitions).length > MAX_TOOL_DEFINITION_CHARS) {
      throw new McpConnectionError('MCP 工具定义总量超过上下文预算')
    }
    const discovery: McpDiscovery = {
      serverId: server.id, serverName: (activeClient.serverInfo.name || server.name).slice(0, 80),
      protocolVersion: activeClient.initializeResult.protocolVersion,
      tools: boundedDefinitions.tools.map(definition => ({
        name: definition.name, namespacedName: namespacedMcpToolName(server.id, definition.name),
        description: definition.description, inputSchema: definition.inputSchema,
        annotations: definition.annotations,
      })),
      resources: resources.map(item => ({ uri: item.uri, name: item.name.slice(0, 128), description: item.description?.slice(0, 2048), mimeType: item.mimeType })),
      prompts: prompts.map(item => ({ name: item.name, description: item.description?.slice(0, 2048), arguments: item.arguments })),
      truncated,
    }
    const allowed = new Set(server.enabled ? server.allowedTools : [])
    if ([...allowed].some(name => !toolNames.has(name))) {
      throw new McpConnectionError('已选择的 MCP 工具不可用，请重新测试连接并选择工具')
    }
    const tools: ToolSet = Object.create(null)
    for (const definition of boundedDefinitions.tools.filter(item => allowed.has(item.name))) {
      const name = definition.name
      const key = namespacedMcpToolName(server.id, name)
      if (Object.hasOwn(tools, key)) throw new McpConnectionError('MCP 工具命名冲突')
      // Use the application's AI SDK types; MCP can depend on a newer provider patch.
      tools[key] = dynamicTool({
        description: definition.description,
        title: definition.title ?? definition.annotations?.title,
        inputSchema: jsonSchema(definition.inputSchema as JSONSchema7),
        metadata: {
          clientName: 'LLM-Writer', toolName: name,
          ...(definition.annotations ? { annotations: {
            ...(definition.annotations.title !== undefined ? { title: definition.annotations.title } : {}),
            ...(definition.annotations.readOnlyHint !== undefined ? { readOnlyHint: definition.annotations.readOnlyHint } : {}),
            ...(definition.annotations.destructiveHint !== undefined ? { destructiveHint: definition.annotations.destructiveHint } : {}),
            ...(definition.annotations.idempotentHint !== undefined ? { idempotentHint: definition.annotations.idempotentHint } : {}),
            ...(definition.annotations.openWorldHint !== undefined ? { openWorldHint: definition.annotations.openWorldHint } : {}),
          } } : {}),
        },
        execute: async (args, execution) => run(async request => {
          if (!allowed.has(name)) throw new McpConnectionError('该 MCP 工具未获授权')
          if (!args || typeof args !== 'object' || Array.isArray(args) || JSON.stringify(args).length > 32_000) {
            throw new McpConnectionError('MCP 工具参数无效或超过大小限制')
          }
          const result = await activeClient.callTool({ name, arguments: args as Record<string, unknown>, options: request })
          return boundedToolResult(normalizeJinaSearchAuthError(server, name, args as Record<string, unknown>, result))
        }, { signal: execution.abortSignal }),
        toModelOutput: ({ output }) => ({ type: 'text', value: clip(JSON.stringify(output)).text }),
      })
    }
    const connection: RemoteMcpConnection = {
      discovery, tools,
      readResource: (uri, requestOptions) => run(async request => {
        if (!discovery.resources.some(resource => resource.uri === uri)) throw new McpConnectionError('请先选择已发现的 MCP 资源')
        const result = await activeClient.readResource({ uri, options: request })
        return clip(result.contents.flatMap(content => typeof content.text === 'string' ? [content.text] : ['[二进制资源不在文本预览中显示]']).join('\n'))
      }, requestOptions),
      getPrompt: (name, args, requestOptions) => run(async request => {
        const prompt = discovery.prompts.find(item => item.name === name)
        if (!prompt) throw new McpConnectionError('请先选择已发现的 MCP 提示词')
        if (prompt.arguments?.some(argument => argument.required && !args?.[argument.name]?.trim())) {
          throw new McpConnectionError('请填写 MCP 提示词的必填参数')
        }
        const result = await activeClient.experimental_getPrompt({ name, arguments: args, options: request })
        return clip(result.messages.map(message => `${message.role}: ${message.content.type === 'text' ? message.content.text : '[非文本内容]'}`).join('\n\n'))
      }, requestOptions),
      close,
    }
    clearTimeout(setupTimer)
    return connection
  } catch (error) {
    const sanitized = safeError(error, lifetime.signal)
    clearTimeout(setupTimer)
    await close()
    // A caller may have cancelled while the SDK was returning its initialized client.
    await client?.close().catch(() => undefined)
    throw sanitized
  }
}

/** Probe only discovers metadata; it never executes a server tool. */
export async function probeRemoteMcp(server: RemoteMcpServer, options?: McpConnectionOptions): Promise<McpDiscovery> {
  const connection = await connectRemoteMcp({ ...server, enabled: false }, options)
  try { return connection.discovery } finally { await connection.close() }
}
