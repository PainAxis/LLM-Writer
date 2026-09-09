import type { Ref } from 'vue'
import type { GenerateOptions, StreamCallback } from '@/types/api'

export interface WriterBatchGenerationStream {
  isStreaming: Readonly<Ref<boolean>>
  streamingContent: Readonly<Ref<string>>
  generate(
    prompt: string,
    options?: GenerateOptions,
    onChunk?: StreamCallback | null,
  ): Promise<string>
  reset(): void
}

export interface WriterBatchGenerationNotifications {
  success(message: string): unknown
  warning(message: string): unknown
  error(message: string): unknown
}
