/** Private Node storage adapter for the existing creative repository's atomic KV API. */
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { CampaignRepositoryIO } from '../src/types/writerCampaign'

export class GoCliError extends Error {
  constructor(readonly code: 'arguments' | 'private_directory' | 'locked' | 'private_state' | 'authorization' | 'credential' | 'source_changed' | 'unknown_outcome') { super(code) }
}
const maximumBytes = 272 * 1024 * 1024
function privateMode(mode: number) { return (mode & 0o077) === 0 }
export async function openGoPrivateStorage(directory: string, repositoryRoot: string) {
  const root = await realpath(repositoryRoot), requested = path.resolve(directory)
  const parent = await realpath(path.dirname(requested))
  if (requested !== path.join(parent, path.basename(requested)) || requested === root || requested.startsWith(root + path.sep)) throw new GoCliError('private_directory')
  try { await mkdir(requested, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new GoCliError('private_directory') }
  const info = await lstat(requested)
  if (!info.isDirectory() || info.isSymbolicLink() || !privateMode(info.mode) || (process.getuid && info.uid !== process.getuid())) throw new GoCliError('private_directory')
  try { if (execFileSync('git', ['-C', requested, 'rev-parse', '--is-inside-work-tree'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim() === 'true') throw new GoCliError('private_directory') }
  catch (error) { if (error instanceof GoCliError) throw error }
  const lock = path.join(requested, '.execution-lock')
  try { await mkdir(lock, { mode: 0o700 }) } catch { throw new GoCliError('locked') }
  let closed = false, queue = Promise.resolve()
  function check() { if (closed) throw new GoCliError('private_state') }
  function filename(name: string) {
    if (!/^[a-z][a-z0-9-]*\.json$/.test(name)) throw new GoCliError('private_state')
    return path.join(requested, name)
  }
  async function read(name: string): Promise<unknown | null> {
    check()
    const file = filename(name)
    let handle
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      const info = await handle.stat()
      if (!info.isFile() || !privateMode(info.mode) || info.size > maximumBytes || (process.getuid && info.uid !== process.getuid())) throw new GoCliError('private_state')
      return JSON.parse(await handle.readFile('utf8'))
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new GoCliError('private_state') }
    finally { await handle?.close() }
  }
  async function write(name: string, value: unknown, guard: () => boolean = () => true): Promise<boolean> {
    check()
    const encoded = JSON.stringify(value), file = filename(name), temporary = path.join(requested, `.pending-${crypto.randomUUID()}`)
    if (Buffer.byteLength(encoded) > maximumBytes) throw new GoCliError('private_state')
    let handle
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
      await handle.writeFile(encoded); await handle.sync(); await handle.close(); handle = undefined
      if (!guard()) return false
      await rename(temporary, file)
      const dir = await open(requested, constants.O_RDONLY)
      try { await dir.sync() } finally { await dir.close() }
      return true
    } finally { await handle?.close(); await unlink(temporary).catch(() => {}) }
  }
  async function ledger() {
    const value = await read('records.json')
    if (value === null) return new Map<string, string>()
    if (!Array.isArray(value) || value.length > 400 || value.some(row => !Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string' || typeof row[1] !== 'string')) throw new GoCliError('private_state')
    const rows = new Map<string, string>(value)
    if (rows.size !== value.length) throw new GoCliError('private_state')
    return rows
  }
  const io: CampaignRepositoryIO = {
    async getMany(keys) { await queue; const rows = await ledger(); return new Map(keys.map(key => [key, rows.get(key) ?? null])) },
    async compareAndSwapMany(entries, canCommit = () => true) {
      let result = false
      const work = queue.then(async () => {
        const rows = await ledger()
        if (!canCommit() || entries.some(row => (rows.get(row.key) ?? null) !== row.expectedValue)) return
        for (const row of entries) rows.set(row.key, row.value)
        result = await write('records.json', [...rows], canCommit)
      })
      queue = work.catch(() => {})
      await work; return result
    },
  }
  return { directory: requested, io, read, write,
    async close() { if (closed) return; await queue; closed = true; await rmdir(lock) } }
}
