import { StorageKeys, storageGet, storageSet } from '@/utils/storage'
import { estimateTokens as estimateTokenCount } from '@/utils/tokenBudget'

export interface BillingRecord {
  id: number
  timestamp: string
  type: string
  model: string
  content: string
  response: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  status: 'success' | 'failed'
}

export interface UsageStats {
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
  lastResetDate?: string
  lastUpdateDate?: string
}

export interface UsageTrendItem {
  date: string
  tokenCount: number
  cost: number
  requestCount: number
}

export interface RecordAPICallParams {
  type?: string
  model: string
  content?: string
  response?: string
  inputTokens: number
  outputTokens: number
  status?: 'success' | 'failed'
}

interface ModelPricing {
  input: number
  output: number
}

const MAX_RECORDS = 1000
const RECORD_RETENTION_DAYS = 30

/** 模型价格配置（每1000个token的价格，单位：人民币，为公开榜单价格的近似折算） */
function getModelPricing(): Record<string, ModelPricing> {
  return {
    'gpt-5.5': { input: 0.036, output: 0.108 },
    'gpt-5.4': { input: 0.018, output: 0.054 },
    'gpt-5.4-mini': { input: 0.003, output: 0.009 },
    'claude-opus-4.8': { input: 0.036, output: 0.108 },
    'claude-sonnet-4.6': { input: 0.022, output: 0.065 },
    'gemini-3.1-pro': { input: 0.014, output: 0.043 },
    'gemini-3.6-flash': { input: 0.004, output: 0.011 },
    'deepseek-v4-pro': { input: 0.004, output: 0.011 },
    'deepseek-v4-flash': { input: 0.001, output: 0.002 },
    'grok-4.3': { input: 0.022, output: 0.065 },
    'kimi-k2-6': { input: 0.011, output: 0.032 },
    'qwen3.6-plus': { input: 0.007, output: 0.021 },
    'glm-5.1': { input: 0.007, output: 0.022 },
    default: { input: 0.007, output: 0.014 },
  }
}

const DEFAULT_STATS: UsageStats = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCost: 0,
  lastResetDate: new Date().toISOString(),
}

/**
 * 本地模拟计费服务：Token 用量统计与成本台账（非真实扣费）。
 */
class BillingService {
  constructor() {
    this.initializeStorage()
  }

  private initializeStorage(): void {
    if (storageGet<string | null>(StorageKeys.accountBalance, null) === null) {
      storageSet(StorageKeys.accountBalance, '0.00')
    }
    if (storageGet<unknown[] | null>(StorageKeys.billingRecords, null) === null) {
      storageSet(StorageKeys.billingRecords, [])
    }
    if (storageGet<UsageStats | null>(StorageKeys.tokenUsageStats, null) === null) {
      storageSet(StorageKeys.tokenUsageStats, { ...DEFAULT_STATS, lastResetDate: new Date().toISOString() })
    }
  }

  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = getModelPricing()
    const modelPricing = pricing[model] ?? pricing.default

    const inputCost = (inputTokens / 1000) * modelPricing.input
    const outputCost = (outputTokens / 1000) * modelPricing.output

    return inputCost + outputCost
  }

  /** 粗略估算 token 数量（1个中文字符 ≈ 1.5 token） */
  estimateTokens(text: string): number {
    return estimateTokenCount(text)
  }

  getAccountBalance(): number {
    return parseFloat(storageGet<string>(StorageKeys.accountBalance, '0'))
  }

  checkBalance(estimatedCost: number): boolean {
    return this.getAccountBalance() >= estimatedCost
  }

  deductBalance(amount: number): number {
    const newBalance = Math.max(0, this.getAccountBalance() - amount)
    storageSet(StorageKeys.accountBalance, newBalance.toString())
    return newBalance
  }

  addBalance(amount: number): number {
    const newBalance = this.getAccountBalance() + amount
    storageSet(StorageKeys.accountBalance, newBalance.toString())
    return newBalance
  }

  recordAPICall(params: RecordAPICallParams): BillingRecord | null {
    try {
      const records = this.getBillingRecords()
      const cost = this.calculateCost(params.model, params.inputTokens, params.outputTokens)

      const record: BillingRecord = {
        id: Date.now() + Math.random(),
        timestamp: new Date().toISOString(),
        type: params.type ?? 'generation',
        model: params.model,
        content: params.content ?? '',
        response: params.response ?? '',
        inputTokens: params.inputTokens || 0,
        outputTokens: params.outputTokens || 0,
        totalTokens: (params.inputTokens || 0) + (params.outputTokens || 0),
        cost,
        status: params.status ?? 'success',
      }

      records.unshift(record)

      if (records.length > MAX_RECORDS) {
        records.splice(MAX_RECORDS)
      }

      storageSet(StorageKeys.billingRecords, records)
      this.deductBalance(cost)
      this.updateUsageStats(params.inputTokens || 0, params.outputTokens || 0, cost)

      return record
    } catch (error) {
      console.error('记录API调用失败:', error)
      return null
    }
  }

  getBillingRecords(): BillingRecord[] {
    return storageGet<BillingRecord[]>(StorageKeys.billingRecords, [])
  }

  private updateUsageStats(inputTokens: number, outputTokens: number, cost: number): void {
    try {
      const stats = storageGet<Partial<UsageStats>>(StorageKeys.tokenUsageStats, {})

      stats.totalInputTokens = (stats.totalInputTokens ?? 0) + inputTokens
      stats.totalOutputTokens = (stats.totalOutputTokens ?? 0) + outputTokens
      stats.totalCost = (stats.totalCost ?? 0) + cost
      stats.lastUpdateDate = new Date().toISOString()

      storageSet(StorageKeys.tokenUsageStats, stats)
    } catch (error) {
      console.error('更新使用统计失败:', error)
    }
  }

  getUsageStats(): UsageStats {
    return storageGet<UsageStats>(StorageKeys.tokenUsageStats, { ...DEFAULT_STATS })
  }

  getTodayStats(): { tokenCount: number; cost: number; requestCount: number } {
    const records = this.getBillingRecords()
    const today = new Date().toDateString()

    const todayRecords = records.filter((record) => new Date(record.timestamp).toDateString() === today)

    return {
      tokenCount: todayRecords.reduce((sum, record) => sum + record.totalTokens, 0),
      cost: todayRecords.reduce((sum, record) => sum + record.cost, 0),
      requestCount: todayRecords.length,
    }
  }

  getUsageTrend(days = 7): UsageTrendItem[] {
    const records = this.getBillingRecords()
    const trend: UsageTrendItem[] = []

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateString = date.toDateString()

      const dayRecords = records.filter((record) => new Date(record.timestamp).toDateString() === dateString)

      trend.push({
        date: dateString,
        tokenCount: dayRecords.reduce((sum, record) => sum + record.totalTokens, 0),
        cost: dayRecords.reduce((sum, record) => sum + record.cost, 0),
        requestCount: dayRecords.length,
      })
    }

    return trend
  }

  cleanOldRecords(): void {
    try {
      const records = this.getBillingRecords()
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - RECORD_RETENTION_DAYS)

      const filtered = records.filter((record) => new Date(record.timestamp) > cutoff)
      storageSet(StorageKeys.billingRecords, filtered)
    } catch (error) {
      console.error('清理过期记录失败:', error)
    }
  }

  exportBillingData(format: 'json' | 'csv' = 'json'): string {
    const records = this.getBillingRecords()
    const stats = this.getUsageStats()

    const exportData = {
      exportTime: new Date().toISOString(),
      accountBalance: this.getAccountBalance(),
      usageStats: stats,
      records,
    }

    if (format === 'json') {
      return JSON.stringify(exportData, null, 2)
    }

    if (format === 'csv') {
      let csv = 'timestamp,type,model,inputTokens,outputTokens,totalTokens,cost,status\n'
      for (const record of records) {
        csv += `${record.timestamp},${record.type},${record.model},${record.inputTokens},${record.outputTokens},${record.totalTokens},${record.cost},${record.status}\n`
      }
      return csv
    }

    return JSON.stringify(exportData, null, 2)
  }
}

export default new BillingService()
