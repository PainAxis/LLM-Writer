import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { CreativeIoMetrics } from './creative-pilot-io'
import { controlAssert } from './creative-pilot-oracles'
export interface CreativeColdRead { status: 'pass'; checkpointHash: string; elapsedMs: number; fence: { keys: number; bytes: number }; io: CreativeIoMetrics; httpAttempts: 0 }
export async function readCreativeColdProcess(campaignId: string, rows: ReadonlyMap<string, string>): Promise<CreativeColdRead> {
  const child = fork(fileURLToPath(new URL('./creative-pilot-cold-reader.ts', import.meta.url)), [], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  return new Promise((resolve, reject) => {
    let result: CreativeColdRead | null = null
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(Object.assign(new Error('deadline_exceeded'), { code: 'deadline_exceeded' })) }, 15000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('message', message => { try { const value = message as CreativeColdRead; controlAssert(value.status === 'pass'); result = value } catch { result = null } })
    child.once('exit', code => { clearTimeout(timeout); if (code === 0 && result) resolve(result); else reject(Object.assign(new Error('integrity'), { code: 'integrity' })) })
    child.send({ campaignId, rows: [...rows] })
  })
}
