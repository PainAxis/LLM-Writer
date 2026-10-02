import type { ToolSet } from 'ai'

/** Persisted connection metadata. Credentials belong to the current session only. */
export interface RemoteMcpServer {
  id: string
  name: string
  url: string
  enabled: boolean
  allowedTools: string[]
}

export interface McpToolDescriptor {
  name: string
  namespacedName: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

export interface McpResourceDescriptor {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpPromptDescriptor {
  name: string
  description?: string
  arguments?: { name: string; description?: string; required?: boolean }[]
}

export interface McpDiscovery {
  serverId: string
  serverName: string
  protocolVersion: string
  tools: McpToolDescriptor[]
  resources: McpResourceDescriptor[]
  prompts: McpPromptDescriptor[]
  /** At least one collection exceeded the bounded discovery limit. */
  truncated: boolean
}

export interface McpRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface McpConnectionOptions extends McpRequestOptions {
  bearerToken?: string
}

export interface McpContentPreview {
  text: string
  truncated: boolean
}

export interface RemoteMcpConnection {
  discovery: McpDiscovery
  /** Only explicitly opted-in tools from an enabled server are exposed. */
  tools: ToolSet
  readResource(uri: string, options?: McpRequestOptions): Promise<McpContentPreview>
  getPrompt(name: string, args?: Record<string, string>, options?: McpRequestOptions): Promise<McpContentPreview>
  close(): Promise<void>
}
