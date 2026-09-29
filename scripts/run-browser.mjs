import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { startPreviewServer } from './browser-preview.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
let child
let server

const stop = () => child?.kill('SIGTERM')
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

function run(script, env = process.env) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [script], { cwd: root, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      child = undefined
      if (code === 0) resolve()
      else reject(new Error(`${script} failed (${signal || code})`))
    })
  })
}

try {
  await run('scripts/smoke-browser-preview.mjs')
  server = await startPreviewServer({ port: 0, sha: process.env.GITHUB_SHA || 'local' })
  const url = `http://127.0.0.1:${server.address().port}`
  await run('scripts/browser-regression.mjs', {
    ...process.env,
    PREVIEW_URL: url,
    MOCK_API_URL: `${url}/__test/v1`,
  })
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  if (server) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  process.removeListener('SIGINT', stop)
  process.removeListener('SIGTERM', stop)
}
