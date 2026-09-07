/* global Buffer, process */
/** Ephemeral, secret-free browser preview. Never serves the repository or proxies requests. */
import http from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixtures = ['book-import.docx', 'book-import-empty.docx', 'book-import-invalid.docx']
const models = ['writer-mock', 'writer-mock-slow']
const mediaTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

async function loadPublicFiles(directory, prefix = '') {
  const result = new Map()
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
    const path = join(directory, entry.name)
    const url = `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      for (const [key, value] of await loadPublicFiles(path, url)) result.set(key, value)
    } else if (entry.isFile() && mediaTypes[extname(entry.name)]) {
      result.set(url, { body: await readFile(path), type: mediaTypes[extname(entry.name)] })
    }
  }
  return result
}

export async function startPreviewServer({ port = 4173, sha = 'local', ttlMs = 40 * 60_000 } = {}) {
  const publicFiles = await loadPublicFiles(join(root, 'dist'))
  if (!publicFiles.has('/index.html')) throw new Error('Run npm run build before starting the preview')
  publicFiles.set('/', publicFiles.get('/index.html'))
  for (const fixture of fixtures) {
    publicFiles.set(`/__test/fixtures/${fixture}`, {
      body: await readFile(join(root, 'scripts/fixtures', fixture)), type: mediaTypes['.docx'],
    })
  }
  const expiresAt = new Date(Date.now() + Math.max(1_000, Math.min(ttlMs, 45 * 60_000))).toISOString()
  const stats = { started: 0, completed: 0, cancelled: 0, active: 0 }
  const testIndex = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Writer 浏览器联调</title>
<style>body{max-width:850px;margin:48px auto;padding:0 24px;font:18px/1.6 system-ui}code{background:#eee;padding:2px 6px}li{margin:12px 0}</style>
<h1>Writer 临时联调</h1><p><a href="/">打开应用</a> · <a href="/__test/health">版本与到期时间</a> · <a href="/__test/metrics">Mock 请求计数</a></p>
<p>此服务仅提供构建产物和合成测试文件，不能访问真实 AI 服务。应用数据仍保存在当前浏览器中。</p>
<p>在 API 配置中选择自定义服务，地址为当前站点域名后加 <code>/__test/v1</code>，密钥为 <code>preview-test-key</code>。模型 <code>writer-mock</code> 很快完成，<code>writer-mock-slow</code> 持续约 36 秒，用于中止与切章测试。</p>
<p>Cloudflare Quick Tunnel 不支持 SSE。此入口用于页面交互；逐片接收与断流由 GitHub runner 内的真实浏览器另外验证。</p>
<ul>${fixtures.map(name => `<li><a download href="/__test/fixtures/${name}">${name}</a></li>`).join('')}</ul></html>`

  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type })
      res.end(req.method === 'HEAD' ? undefined : typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    }
    let path
    try {
      path = decodeURIComponent((req.url || '/').split('?')[0])
      if (path.includes('\\') || path.includes('\0') || path.split('/').some(part => part === '.' || part === '..')) throw new Error('invalid path')
    } catch {
      send(400, { error: 'Invalid path' })
      return
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && path === '/__test/health') {
      send(200, { status: 'ok', sha, expiresAt, mode: 'dist-and-synthetic-fixtures-only' })
      return
    }
    if (req.method === 'GET' && path === '/__test/metrics') {
      send(200, stats)
      return
    }
    if (req.method === 'GET' && (path === '/__test/' || path === '/__test')) {
      send(200, testIndex, mediaTypes['.html'])
      return
    }
    if (path.startsWith('/__test/v1/')) {
      if (req.headers.authorization !== 'Bearer preview-test-key') {
        send(401, { error: { message: 'Use the synthetic preview-test-key' } })
        return
      }
      if (req.method === 'GET' && path === '/__test/v1/models') {
        send(200, { object: 'list', data: models.map(id => ({ id, object: 'model', created: 1, owned_by: 'synthetic-preview' })) })
        return
      }
      if (req.method === 'POST' && path === '/__test/v1/chat/completions') {
        if (stats.active >= 10) {
          send(429, { error: { message: 'Preview concurrency limit reached' } })
          return
        }
        let bytes = 0
        const parts = []
        try {
          for await (const part of req) {
            bytes += part.length
            if (bytes > 256_000) {
              send(413, { error: { message: 'Preview request is too large' } })
              return
            }
            parts.push(part)
          }
          const payload = JSON.parse(Buffer.concat(parts).toString('utf8'))
          if (!models.includes(payload.model)) {
            send(400, { error: { message: 'Select writer-mock or writer-mock-slow' } })
            return
          }
          stats.started++
          stats.active++
          let finished = false
          let timer
          res.on('close', () => {
            clearInterval(timer)
            stats.active--
            if (!finished) stats.cancelled++
          })
          const slow = payload.model === 'writer-mock-slow'
          const chunks = Array.from({ length: slow ? 48 : 3 }, (_, i) => `联调生成片段 ${i + 1}：雨后的城市渐渐苏醒。\n\n`)
          const common = { id: 'preview-completion', created: 1, model: payload.model }
          if (!payload.stream) {
            finished = true
            stats.completed++
            send(200, { ...common, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: chunks.join('') }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 } })
            return
          }
          res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
          res.flushHeaders()
          let index = 0
          const emit = chunk => res.write(`data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk', ...chunk })}\n\n`)
          const tick = () => {
            if (index < chunks.length) {
              emit({ choices: [{ index: 0, delta: { content: chunks[index++] }, finish_reason: null }] })
              return
            }
            clearInterval(timer)
            emit({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 } })
            finished = true
            stats.completed++
            res.end('data: [DONE]\n\n')
          }
          tick()
          timer = setInterval(tick, slow ? 750 : 40)
          return
        } catch {
          if (!res.headersSent && !res.destroyed) send(400, { error: { message: 'Invalid mock request' } })
          return
        }
      }
      send(404, { error: 'Unknown mock endpoint' })
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(405, { error: 'Method not allowed' })
      return
    }
    const file = publicFiles.get(path)
    if (!file) {
      send(404, { error: 'Not found' })
      return
    }
    if (path.startsWith('/__test/fixtures/')) res.setHeader('Content-Disposition', `attachment; filename="${path.split('/').at(-1)}"`)
    send(200, file.body, file.type)
  })
  server.requestTimeout = 15_000
  server.headersTimeout = 10_000
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolveListen)
  })
  const expiryTimer = setTimeout(() => { server.closeAllConnections(); server.close() }, new Date(expiresAt).getTime() - Date.now())
  server.once('close', () => clearTimeout(expiryTimer))
  return server
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startPreviewServer({ port: Number(process.env.PREVIEW_PORT || 4173), sha: process.env.GITHUB_SHA || 'local' })
  console.log(`Synthetic Writer preview listening on http://127.0.0.1:${server.address().port}`)
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { server.closeAllConnections(); server.close() })
}
