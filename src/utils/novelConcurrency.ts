interface IdentifiedNovel { id: unknown; title?: unknown }
type Versions = ReadonlyMap<string, string>
const keyOf = (novel: IdentifiedNovel) => {
  if (!((typeof novel.id === 'number' && Number.isFinite(novel.id)) || (typeof novel.id === 'string' && novel.id.length > 0))) {
    throw new Error('小说 ID 无效，已停止覆盖保存')
  }
  return `${typeof novel.id}:${String(novel.id)}`
}
// Hydration re-inserts content at a different object-key position; that is not
// an edit. Compare canonical JSON while preserving meaningful array order.
const fingerprint = (novel: IdentifiedNovel) => JSON.stringify(novel, (_key, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    : value)
const versionsOf = <T extends IdentifiedNovel>(novels: T[]): Versions => {
  const versions = new Map<string, string>()
  for (const novel of novels) {
    const key = keyOf(novel)
    if (versions.has(key)) throw new Error('小说 ID 重复，已停止覆盖保存')
    versions.set(key, fingerprint(novel))
  }
  return versions
}

export class NovelConflictError extends Error {
  constructor(title: unknown) {
    super(`「${String(title ?? '小说')}」已在其他标签页修改。当前草稿仍保留，请先复制草稿，再刷新页面并重新打开作品合并修改。`)
    this.name = 'NovelConflictError'
  }
}

export interface NovelChange<T extends IdentifiedNovel> {
  value: T[]
  base: Versions
  versions: Versions
  changed: Set<string>
  replace: boolean
}

/** Track the versions actually seen by this page, including queued edits/reverts.
 * External updates must not silently advance an editor's source baseline. */
export function createNovelChangeTracker<T extends IdentifiedNovel>(initial: T[]) {
  let baseline = versionsOf(initial)
  const ownCommits = new Map<string, string | undefined>()
  const pending = new Map<NovelChange<T>, number>()

  function capture(next: T[], previous: T[], replace = false): NovelChange<T> {
    const versions = versionsOf(next)
    const before = versionsOf(previous)
    const keys = new Set([...baseline.keys(), ...before.keys(), ...versions.keys()])
    const changed = new Set([...keys].filter(key => baseline.get(key) !== versions.get(key) || before.get(key) !== versions.get(key)))
    // A queued edit followed by a revert is still an intentional write, even
    // when the desired value happens to equal the last committed baseline.
    for (const request of pending.keys()) for (const key of request.changed) changed.add(key)
    const request = { value: next, base: baseline, versions, changed, replace }
    return request
  }

  function merge(request: NovelChange<T>, current: T[]): T[] {
    const latest = new Map(current.map(novel => [keyOf(novel), novel]))
    const candidates = new Map(request.value.map(novel => [keyOf(novel), novel]))
    const currentVersions = versionsOf(current)
    const keys = request.replace ? new Set([...latest.keys(), ...request.base.keys(), ...candidates.keys()]) : request.changed
    for (const key of keys) {
      const actual = currentVersions.get(key)
      const desired = request.versions.get(key)
      if (actual !== request.base.get(key) && actual !== desired
        && !(ownCommits.has(key) && actual === ownCommits.get(key))) {
        throw new NovelConflictError(latest.get(key)?.title ?? candidates.get(key)?.title)
      }
      const candidate = candidates.get(key)
      if (candidate) latest.set(key, candidate)
      else latest.delete(key)
    }
    return [...latest.values()]
  }

  function commit(request: NovelChange<T>) {
    // Keep this page's view as its baseline; unrelated remote updates were
    // merged on disk but have not been loaded into its open editor/forms.
    baseline = request.versions
    const keys = request.replace ? new Set([...request.base.keys(), ...request.versions.keys()]) : request.changed
    for (const key of keys) ownCommits.set(key, request.versions.get(key))
  }

  return {
    capture, merge, commit,
    begin: (request: NovelChange<T>) => { pending.set(request, (pending.get(request) ?? 0) + 1) },
    finish: (request: NovelChange<T>) => {
      const count = (pending.get(request) ?? 1) - 1
      if (count) pending.set(request, count)
      else pending.delete(request)
    },
  }
}
