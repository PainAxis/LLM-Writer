import type { WriterNovel } from './writer'
import type { WritingSkill } from './skills'
import type { RemoteMcpServer } from './mcp'
import type { WritingToolId } from './writingTools'

export interface ToolActivityEvent {
  toolCallId: string
  toolName: string
  status: 'running' | 'success' | 'error'
}

/** Request-local snapshot; credentials never belong to persisted settings. */
export interface ExtensionRequest {
  novel?: WriterNovel
  writingToolIds: WritingToolId[]
  skills: WritingSkill[]
  servers: Array<{ config: RemoteMcpServer; bearerToken?: string }>
  maxSteps: number
  contextTokenBudget?: number
  onToolActivity?: (event: ToolActivityEvent) => void
}
