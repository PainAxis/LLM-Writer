import type { FactAnchor } from '../../types/factGraph'
import type { MemoryIndexStats, MemoryProjectInput } from '../../types/memory'
import { NOVEL_SCAN_LIMITS as L } from '../../types/memoryNovelScan'
import { buildNovelPrompt, novelBytes, novelFail, type NovelWireCue } from './novelScanProtocol'

export interface NovelSourceAtom extends FactAnchor { ordinal: number; atomId: number }
export interface NovelSourceWindow { id: string; primary: number[]; sources: number[]; primaryReferences: number[] }
export interface NovelSourcePlan { atoms: NovelSourceAtom[]; windows: NovelSourceWindow[]; eligibleChars: number; cutoff: number }
export interface NovelIndexedCue { id: number; kind: NovelWireCue['kind']; keys: string[]; atoms: number[] }
export interface NovelConnectionJob { id: string; route: 'singleton' | 'adjacent' | 'shared_key' | 'bridge'; cues: number[]; atoms: number[] }
export function novelAnchorKey(anchor: FactAnchor): string { return JSON.stringify([anchor.chapterId, anchor.sourceRevision, anchor.start, anchor.end]) }
export function novelAnchor(atom: FactAnchor): FactAnchor {
  return { chapterId: atom.chapterId, sourceRevision: atom.sourceRevision, start: atom.start, end: atom.end, quote: atom.quote }
}
function splitsSurrogate(text: string, end: number) {
  const left = text.charCodeAt(end - 1), right = text.charCodeAt(end)
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff
}
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0))
/** Exact encoded atom bound protects BOTH eight-source A and six-source B, including control characters. */
export async function planNovelWindows(project: MemoryProjectInput, stats: MemoryIndexStats, throughChapterId: string, check: () => void = () => {}): Promise<NovelSourcePlan> {
  const cutoff = project.chapters.findIndex(chapter => chapter.id === throughChapterId)
  if (cutoff < 0 || stats.projectId !== project.id || stats.chapters.length !== project.chapters.length) novelFail('source_changed')
  const atoms: NovelSourceAtom[] = [], windows: NovelSourceWindow[] = []
  let eligibleChars = 0
  for (let ordinal = 0; ordinal <= cutoff; ordinal++) {
    check()
    const chapter = project.chapters[ordinal]!, manifest = stats.chapters[ordinal]!
    if (!manifest || manifest.id !== chapter.id || manifest.title !== chapter.title || manifest.ordinal !== ordinal + 1
      || manifest.chars !== chapter.text.length || !/^[a-f0-9]{64}$/.test(manifest.revision)) novelFail('source_changed')
    const first = atoms.length
    eligibleChars += chapter.text.length
    for (let start = 0; start < chapter.text.length;) {
      check()
      let low = 1, high = Math.min(L.atomChars, chapter.text.length - start), length = 1
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        const encoded = JSON.stringify({ reference: 8, quote: chapter.text.slice(start, start + middle) })
        if (encoded.length <= 1_450 && novelBytes(encoded) <= 4_350) { length = middle; low = middle + 1 } else high = middle - 1
      }
      let end = start + length
      if (splitsSurrogate(chapter.text, end)) end--
      if (end <= start) novelFail('context_overflow')
      atoms.push({ atomId: atoms.length, ordinal, chapterId: chapter.id, sourceRevision: manifest.revision, start, end, quote: chapter.text.slice(start, end) })
      start = end
      if (atoms.length % 32 === 0) { await yieldTask(); check() }
    }
    for (let from = first; from < atoms.length;) {
      check()
      let count = Math.min(L.primaryAtoms, atoms.length - from)
      let window: NovelSourceWindow | undefined
      while (count > 0) {
        const primary = Array.from({ length: count }, (_, index) => from + index)
        const sources = [...(from > first ? [from - 1] : []), ...primary, ...(from + count < atoms.length ? [from + count] : [])]
        const primaryReferences = primary.map(id => sources.indexOf(id) + 1)
        try {
          buildNovelPrompt('collect', sources.map(id => atoms[id]!), primaryReferences)
          window = { id: `a:${windows.length}`, primary, sources, primaryReferences }; break
        } catch { count-- }
      }
      if (!window) novelFail('context_overflow')
      windows.push(window); from += count
      if (windows.length % 64 === 0) { await yieldTask(); check() }
    }
  }
  check()
  return { atoms, windows, eligibleChars, cutoff }
}
/** Each yield is bounded work; null gives the session a cancellation/time-budget checkpoint. */
export function* createNovelConnectionPlanner(cues: readonly NovelIndexedCue[]): Generator<NovelConnectionJob | null> {
  const sorted = [...cues].sort((a, b) => Math.min(...a.atoms) - Math.min(...b.atoms) || a.id - b.id)
  function job(group: NovelIndexedCue[], route: NovelConnectionJob['route']): NovelConnectionJob {
    const atoms = [...new Set(group.flatMap(cue => cue.atoms))].sort((a, b) => a - b)
    return { id: `b:${atoms.join(',')}`, route, cues: group.map(cue => cue.id), atoms }
  }
  for (const cue of sorted) yield job([cue], 'singleton')
  for (let index = 0; index < sorted.length; index++) {
    if (index + 1 < sorted.length) yield job(sorted.slice(index, index + 2), 'adjacent')
    if (index + 2 < sorted.length) yield job(sorted.slice(index, index + 3), 'adjacent')
  }
  const buckets = new Map<string, NovelIndexedCue[]>()
  for (const cue of sorted) { for (const key of cue.keys) { const bucket = buckets.get(key) ?? []; bucket.push(cue); buckets.set(key, bucket) }; yield null }
  for (const bucket of buckets.values()) for (let a = 0; a < bucket.length; a++) for (let b = a + 1; b < bucket.length; b++) yield job([bucket[a]!, bucket[b]!], 'shared_key')
  for (const center of sorted) {
    const adjacent = new Map<number, NovelIndexedCue>()
    for (const key of center.keys) for (const neighbor of buckets.get(key) ?? []) {
      if (neighbor.id !== center.id) adjacent.set(neighbor.id, neighbor)
      yield null
    }
    const neighbors = [...adjacent.values()].sort((a, b) => a.id - b.id)
    for (let a = 0; a < neighbors.length; a++) for (let b = a + 1; b < neighbors.length; b++) yield job([center, neighbors[a]!, neighbors[b]!], 'bridge')
  }
}
