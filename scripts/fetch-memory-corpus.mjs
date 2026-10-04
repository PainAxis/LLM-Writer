/** Download fixed public-domain sources only. Run with: node --import tsx scripts/fetch-memory-corpus.mjs */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PUBLIC_MEMORY_SOURCES, readPublicMemoryCorpus } from './fixtures/public-memory-corpus.ts'

const directory = process.argv[2] ?? 'artifacts/memory-stress/corpus'
const valid = (source, data) => data.length === source.bytes && createHash('sha256').update(data).digest('hex') === source.sha256
await mkdir(directory, { recursive: true })
for (const source of PUBLIC_MEMORY_SOURCES) {
  const path = join(directory, source.file)
  const existing = await readFile(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
  if (existing) {
    if (!valid(source, existing)) throw new Error(`Existing corpus hash differs: ${path}. Remove the changed test artifact explicitly before retrying.`)
    console.log(`Verified cached source: ${source.file}`)
    continue
  }
  const response = await fetch(source.url, { signal: AbortSignal.timeout(90_000), redirect: 'error' })
  if (!response.ok) throw new Error(`Gutenberg download failed: ${source.file}: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!valid(source, bytes)) throw new Error(`Downloaded corpus changed: ${source.file}; refusing an unpinned test baseline.`)
  await writeFile(`${path}.partial`, bytes)
  await rename(`${path}.partial`, path)
  console.log(`Downloaded and verified: ${source.file}`)
}
const { manifest, probes } = await readPublicMemoryCorpus(directory)
console.log(JSON.stringify({ manifest, registeredProbes: probes.length }, null, 2))
