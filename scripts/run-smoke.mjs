import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const root = fileURLToPath(new URL('../', import.meta.url))
const { scripts } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const suites = Object.keys(scripts).filter(name => name.startsWith('smoke:') && name !== 'smoke:all')
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this script through npm run smoke:all')

// Existing suites can use fixed ports and global fixtures; keep them sequential.
for (const name of suites) {
  console.log(`\nRunning ${name}`)
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npm, 'run', name], { cwd: root, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (exitCode, signal) => {
      if (signal) reject(new Error(`${name} terminated by ${signal}`))
      else resolve(exitCode ?? 1)
    })
  })
  if (code !== 0) {
    process.exitCode = code
    break
  }
}
if (!process.exitCode) console.log(`\nPassed all ${suites.length} smoke suites`)
