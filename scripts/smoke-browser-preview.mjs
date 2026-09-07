/** Check the temporary server's exposure boundary and mock's actual incremental cancellation. */
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { startPreviewServer } from './browser-preview.mjs'

const server = await startPreviewServer({ port: 0, sha: 'synthetic-test-sha', ttlMs: 10_000 })
const url = `http://127.0.0.1:${server.address().port}`
const auth = { Authorization: 'Bearer preview-test-key', 'Content-Type': 'application/json' }
try {
  const health = await (await fetch(`${url}/__test/health`)).json()
  assert.equal(health.sha, 'synthetic-test-sha')
  assert.equal((await fetch(url)).status, 200)
  for (const path of ['/package.json', '/.git/config', '/src/main.ts', '/node_modules/vue/package.json', '/__test/fixtures/README.md']) {
    assert.equal((await fetch(url + path)).status, 404, `Must not expose ${path}`)
  }
  assert.equal((await fetch(`${url}/`, { method: 'POST', body: 'no upload permitted' })).status, 405)
  const fixture = await fetch(`${url}/__test/fixtures/book-import.docx`)
  assert.equal(fixture.status, 200)
  assert.match(fixture.headers.get('Content-Disposition'), /attachment/)
  assert.equal(new TextDecoder().decode((await fixture.arrayBuffer()).slice(0, 2)), 'PK')
  assert.equal((await fetch(`${url}/__test/v1/models`)).status, 401)
  assert.equal((await (await fetch(`${url}/__test/v1/models`, { headers: auth })).json()).data.length, 2)
  const plain = await fetch(`${url}/__test/v1/chat/completions`, {
    method: 'POST', headers: auth, body: JSON.stringify({ model: 'writer-mock', stream: false, messages: [] }),
  })
  assert.match((await plain.json()).choices[0].message.content, /联调生成片段/)
  const controller = new AbortController()
  const streaming = await fetch(`${url}/__test/v1/chat/completions`, {
    method: 'POST', headers: auth, signal: controller.signal,
    body: JSON.stringify({ model: 'writer-mock-slow', stream: true, messages: [] }),
  })
  assert.match(streaming.headers.get('content-type'), /text\/event-stream/)
  const reader = streaming.body.getReader()
  const first = await reader.read()
  assert.match(new TextDecoder().decode(first.value), /联调生成片段 1/)
  assert.equal((await (await fetch(`${url}/__test/metrics`)).json()).active, 1)
  controller.abort()
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await (await fetch(`${url}/__test/metrics`)).json()
    if (current.active === 0) break
    await delay(20)
  }
  assert.deepEqual(await (await fetch(`${url}/__test/metrics`)).json(), { started: 2, completed: 1, cancelled: 1, active: 0 })
  console.log('✓ Preview: built files only, known DOCX fixtures, no uploads, fake API auth, JSON, incremental SSE and cancellation')
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
