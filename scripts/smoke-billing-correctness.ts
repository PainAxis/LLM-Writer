/** Usage evidence, local-calendar reporting and the actual billing view, without a real API. */
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { computed, effectScope, nextTick, ref, watch } from 'vue'
import type { BillingRecord } from '../src/services/billing'

const disk = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => disk.get(key) ?? null,
  setItem: (key: string, value: string) => disk.set(key, value),
  removeItem: (key: string) => disk.delete(key),
} })
const { default: billing, BILLING_TYPE_LABELS, filterBillingRecords, normalizeBillingType, resolveRecordedUsage, usageTrendFromRecords } = await import('../src/services/billing')
const { StorageKeys } = await import('../src/utils/storage')
const { useApiConfig } = await import('../src/services/apiConfig')
const api = (await import('../src/services/api')).default
const originalConsoleError = console.error
let requests = 0
const server = http.createServer((request, response) => {
  requests++
  assert.equal(request.url, '/v1/chat/completions')
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    const params = JSON.parse(body)
    if (params.model === 'http-failed') {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Synthetic rejected key', type: 'invalid_request_error' } }))
      return
    }
    if (!params.stream) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 'completion', object: 'chat.completion', model: params.model, created: 1,
        choices: [{ index: 0, message: { role: 'assistant', content: '完整回复' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 41, completion_tokens: 7, total_tokens: 48 },
      }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const send = (data: unknown) => response.write(`data: ${JSON.stringify(data)}\n\n`)
    if (params.model !== 'empty-usage') send({ id: '1', object: 'chat.completion.chunk', created: 1, model: params.model,
      choices: [{ index: 0, delta: { content: '可见的部分回复' } }],
    })
    if (params.model === 'partial-abort') return
    send({ id: '1', object: 'chat.completion.chunk', created: 1, model: params.model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      ...(params.model === 'no-usage' ? {} : { usage: { prompt_tokens: 13, completion_tokens: 2 } }),
    })
    response.end('data: [DONE]\n\n')
  })
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address === 'object')
useApiConfig().updateConfig({ provider: 'custom', apiKey: 'synthetic', baseURL: `http://127.0.0.1:${address.port}/v1`, selectedModel: 'ok' })

const newest = () => billing.getBillingRecords()[0]
const prompt = '从未发出的请求不应算入使用量。'.repeat(50)
try {
  console.error = () => {} // Expected provider failures; no real payloads are logged.
  for (const run of [api.generateText.bind(api), api.generateTextStream.bind(api)]) {
    const before = requests
    const priorStats = billing.getUsageStats()
    const cancelled = new AbortController()
    cancelled.abort()
    await assert.rejects(run(prompt, { signal: cancelled.signal }), { name: 'AbortError' })
    assert.equal(requests, before)
    assert.equal(newest().inputTokens, 0)
    assert.equal(newest().outputTokens, 0)
    assert.equal(newest().cost, 0)
    assert.equal(newest().usageSource, 'unavailable')
    assert.equal(billing.getUsageStats().totalInputTokens, priorStats.totalInputTokens)
    assert.equal(billing.getUsageStats().totalCost, priorStats.totalCost)

    await assert.rejects(run(prompt, { maxTokens: -1 }))
    assert.equal(requests, before, 'SDK validation failed before any network request')
    assert.equal(newest().totalTokens, 0)
    assert.equal(newest().cost, 0)

    await assert.rejects(run(prompt, { model: 'http-failed' }))
    assert.equal(newest().totalTokens, 0, 'HTTP failure without usage or output must not invent consumed tokens')
    assert.equal(newest().cost, 0)
  }

  assert.equal(await api.generateText('消息占位', { model: 'nonstream', system: '系统上下文', messages: [{ role: 'user', content: '实际消息内容' }] }), '完整回复')
  assert.equal(newest().inputTokens, 41)
  assert.equal(newest().outputTokens, 7)
  assert.equal(newest().usageSource, 'reported')
  assert.match(newest().content, /系统上下文\n实际消息内容/)

  const streamed = await api.generateTextStream(prompt, { model: 'ok' })
  assert.equal(streamed, '可见的部分回复')
  assert.equal(newest().inputTokens, 13)
  assert.equal(newest().outputTokens, 2)
  assert.equal(newest().usageSource, 'reported')

  await assert.rejects(api.generateTextStream(prompt, { model: 'empty-usage' }), /AI返回内容为空/)
  assert.equal(newest().status, 'failed')
  assert.equal(newest().inputTokens, 13, 'an unusable response still retains provider-reported consumption')
  assert.equal(newest().outputTokens, 2)

  await api.generateTextStream(prompt, { model: 'no-usage', system: '额外系统上下文' })
  assert.equal(newest().inputTokens, billing.estimateTokens(`额外系统上下文\n${prompt}`))
  assert.equal(newest().outputTokens, billing.estimateTokens('可见的部分回复'))
  assert.equal(newest().usageSource, 'estimated')

  const partial = new AbortController()
  await assert.rejects(api.generateTextStream(prompt, { model: 'partial-abort', signal: partial.signal }, () => partial.abort()), { name: 'AbortError' })
  assert.equal(newest().response, '可见的部分回复')
  assert.equal(newest().inputTokens, billing.estimateTokens(prompt))
  assert.equal(newest().outputTokens, billing.estimateTokens('可见的部分回复'))
  assert.equal(newest().usageSource, 'estimated')

  assert.deepEqual(resolveRecordedUsage(500, '', { inputTokens: 17 }, 'failed'), { inputTokens: 17, outputTokens: 0, usageSource: 'reported' })
  assert.deepEqual(resolveRecordedUsage(500, '', { inputTokens: 0, outputTokens: 0 }, 'success'), { inputTokens: 0, outputTokens: 0, usageSource: 'reported' })
  assert.deepEqual(resolveRecordedUsage(500, '', { inputTokens: Number.NaN, outputTokens: -1 }, 'failed'), { inputTokens: 0, outputTokens: 0, usageSource: 'unavailable' })
  const counted = billing.getBillingRecords().reduce((total, item) => ({ input: total.input + item.inputTokens, output: total.output + item.outputTokens, cost: total.cost + item.cost }), { input: 0, output: 0, cost: 0 })
  assert.equal(billing.getUsageStats().totalInputTokens, counted.input)
  assert.equal(billing.getUsageStats().totalOutputTokens, counted.output)
  assert.ok(Math.abs(billing.getUsageStats().totalCost - counted.cost) < 1e-10)
} finally {
  console.error = originalConsoleError
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
}

const initialTimeZone = process.env.TZ
process.env.TZ = 'America/Los_Angeles'
const record = (id: number, day: string, type = 'content_generation', model = 'Vendor/MyModel'): BillingRecord => ({
  id, timestamp: new Date(day).toISOString(), type, model, content: '真实请求', response: '实际输出',
  inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0.1, status: 'success', usageSource: 'reported',
})
try {
  const records = [record(1, '2026-10-01T12:00:00'), record(2, '2026-10-02T23:59:59.999', 'optimize'),
    record(3, '2026-10-03T00:00:00'), record(4, '2026-10-02T13:00:00', 'generation', 'Vendor/MyModel-Pro')]
  const base = { type: 'all', model: 'all', dates: null, keyword: '' }
  assert.deepEqual(filterBillingRecords(records, { ...base, type: 'generation' }).map(item => item.id).sort(), [1, 3, 4])
  assert.deepEqual(filterBillingRecords(records, { ...base, type: 'polish' }).map(item => item.id), [2])
  assert.deepEqual(filterBillingRecords(records, { ...base, model: 'Vendor/MyModel' }).map(item => item.id).sort(), [1, 2, 3])
  const dates = [new Date('2026-10-01T00:00:00'), new Date('2026-10-02T00:00:00')]
  assert.deepEqual(filterBillingRecords(records, { ...base, dates }).map(item => item.id), [2, 4, 1])
  assert.equal(dates[1].getHours(), 0, 'filtering must not mutate the date-picker values')
  const daylight = [record(5, '2026-03-08T23:59:59'), record(6, '2026-03-09T00:00:00')]
  assert.deepEqual(filterBillingRecords(daylight, { ...base, dates: [new Date('2026-03-08T00:00:00'), new Date('2026-03-08T00:00:00')] }).map(item => item.id), [5])
  const now = new Date('2026-03-09T12:00:00')
  const trend = usageTrendFromRecords(daylight, 3, now)
  assert.deepEqual(trend.map(day => day.date), ['2026-03-07', '2026-03-08', '2026-03-09'])
  assert.deepEqual(trend.map(day => day.tokenCount), [0, 15, 15])
  const sparse = usageTrendFromRecords([
    { id: 90, timestamp: now.toISOString(), totalTokens: 12 },
    { id: 91, timestamp: now.toISOString(), inputTokens: 7, outputTokens: 3 },
    { id: 92, timestamp: now.toISOString(), inputTokens: Number.NaN, outputTokens: -5, cost: -1 },
  ] as BillingRecord[], 1, now)[0]
  assert.deepEqual(sparse, { date: '2026-03-09', inputTokens: 7, outputTokens: 3, tokenCount: 22, cost: 0, requestCount: 3 })
  for (const days of [7, 30, 90]) {
    const daysTrend = usageTrendFromRecords(daylight, days, now)
    assert.equal(daysTrend.length, days)
    assert.equal(daysTrend.reduce((total, day) => total + day.tokenCount, 0), 30)
  }

  // Execute the actual view setup to verify data wiring, period selection and pagination.
  const viewText = readFileSync(new URL('../src/views/TokenBilling.vue', import.meta.url), 'utf8')
  const script = viewText.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
  const source = ts.createSourceFile('TokenBilling.vue', script, ts.ScriptTarget.Latest, true)
  const code = source.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(source)).join('\n')
  const exported = 'statisticsTimeRange, clock, billingRecords, typeFilter, modelFilter, dateRange, searchKeyword, pageSize, currentPage, filteredRecords, paginatedRecords, usageTrend, periodTotals, trendDays, inputShare, loadBillingRecords, getTypeText, getUsageSourceText'
  const executable = ts.transpileModule(`${code}\nreturn { ${exported} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const deps = { ref, computed, watch, onMounted() {}, onUnmounted() {}, billingService: billing, BILLING_TYPE_LABELS, filterBillingRecords, normalizeBillingType, usageTrendFromRecords, StorageKeys }
  const scope = effectScope()
  const view = scope.run(() => new Function(...Object.keys(deps), executable)(...Object.values(deps)))
  try {
    view.clock.value = now
    view.billingRecords.value = [record(20, '2026-03-09T10:00:00'), record(21, '2026-02-25T10:00:00'), record(22, '2026-01-01T10:00:00')]
    assert.equal(view.periodTotals.value.tokenCount, 15)
    view.statisticsTimeRange.value = '30d'
    assert.equal(view.usageTrend.value.length, 30)
    assert.equal(view.periodTotals.value.tokenCount, 30)
    view.statisticsTimeRange.value = '90d'
    assert.equal(view.periodTotals.value.tokenCount, 45)
    assert.ok(Math.abs(view.inputShare.value - 200 / 3) < 1e-10)
    assert.equal(view.getTypeText('content_generation'), '文本生成')
    assert.equal(view.getTypeText('optimize'), '文本润色')
    assert.equal(view.getUsageSourceText('unavailable'), '未取得用量，未计入Token')
    view.currentPage.value = 3
    view.typeFilter.value = 'polish'
    await nextTick()
    assert.equal(view.currentPage.value, 1, 'changing a filter must not leave an empty high-numbered page')
    view.billingRecords.value = []
    assert.equal(view.periodTotals.value.requestCount, 0)
    assert.equal(view.periodTotals.value.tokenCount, 0)
    assert.equal(view.inputShare.value, 0)
    assert.ok(view.usageTrend.value.every((day: { tokenCount: number }) => day.tokenCount === 0))
  } finally { scope.stop() }
} finally {
  if (initialTimeZone === undefined) delete process.env.TZ
  else process.env.TZ = initialTimeZone
}

console.log('Billing correctness smoke passed: usage evidence, real trends, exact filters and local-calendar bounds')
