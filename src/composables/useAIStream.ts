import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import apiService from '@/services/api'
import type { GenerateOptions } from '@/types/api'

export interface RunStreamOptions {
  /** 流式类型标识（content / optimize / continue 等） */
  type: string
  /** 完整提示词 */
  prompt: string
  /** 传给 API 的生成参数 */
  generateOptions?: GenerateOptions
  /** 增量回调 */
  onChunk?: (chunk: string, fullContent: string) => void
  /** 成功提示，传空字符串则不提示 */
  successMessage?: string
  /** 错误提示前缀 */
  errorPrefix?: string
}

/**
 * 流式 AI 生成 composable：
 * 统一管理流式状态、增量内容、中断与错误提示，
 * 替代散落在各视图中的重复样板代码。
 */
export function useAIStream() {
  const isStreaming = ref(false)
  const streamingContent = ref('')
  const streamingType = ref('')

  async function run(options: RunStreamOptions): Promise<string | null> {
    isStreaming.value = true
    streamingType.value = options.type
    streamingContent.value = ''

    try {
      const result = await apiService.generateTextStream(
        options.prompt,
        options.generateOptions ?? {},
        (chunk, fullContent) => {
          streamingContent.value = fullContent
          options.onChunk?.(chunk, fullContent)
        },
      )

      if (!result.trim()) {
        throw new Error('AI返回内容为空')
      }

      if (options.successMessage !== '') {
        ElMessage.success(options.successMessage ?? '生成成功')
      }
      return result
    } catch (error) {
      console.error(`[${options.type}] 流式生成失败:`, error)
      ElMessage.error(`${options.errorPrefix ?? '生成'}失败: ${(error as Error).message}`)
      return null
    } finally {
      isStreaming.value = false
    }
  }

  /** 中断当前流式请求（真正取消网络请求） */
  function stop(message = '已停止生成'): void {
    apiService.abortActiveRequests()
    isStreaming.value = false
    if (message) {
      ElMessage.info(message)
    }
  }

  /** 仅清理状态（不中断请求） */
  function reset(): void {
    isStreaming.value = false
    streamingContent.value = ''
  }

  return {
    isStreaming,
    streamingContent,
    streamingType,
    run,
    stop,
    reset,
  }
}
