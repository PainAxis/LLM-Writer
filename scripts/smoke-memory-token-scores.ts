import assert from 'node:assert/strict'
import { components, create, insert, insertMultiple, load, remove, save, search, update, type SearchParams, type Tokenizer } from '@orama/orama'
import { createTokenScoreIndex } from '../src/services/memory/tokenScoreIndex'

const schema = { body: 'string', title: 'string', notes: 'string', tags: 'string[]', kind: 'enum' } as const
const encode = (tokens: string[]) => JSON.stringify(tokens)

// JSON keeps repeated/empty/prototype-named tokens and malformed UTF-16 intact.
// Reusing one array deliberately exercises invalidation across fields and mutations.
function tokenizer(reuseArray: boolean): Tokenizer {
  const scratch: string[] = []
  return {
    language: 'english',
    normalizationCache: new Map(),
    tokenize(raw, _language, property) {
      const values: string[] = property ? JSON.parse(raw) : raw ? raw.split(' ') : []
      if (!reuseArray) return values
      scratch.splice(0, scratch.length, ...values)
      return scratch
    },
  }
}

function database(optimized: boolean, reuseArray: boolean) {
  return create({ schema, sort: { enabled: false }, components: {
    tokenizer: tokenizer(reuseArray),
    index: optimized ? createTokenScoreIndex() : components.index.createIndex(),
  } })
}

const doc = (id: string, body: string[], title: string[] = [], notes: string[] = [], tags: string[][] = []) => ({
  id, body: encode(body), title: encode(title), notes: encode(notes), tags: tags.map(encode), kind: 'passage',
})
const terms = ['', 'alpha', 'alpha beta', 'alpha alpha', 'bet', 'betta', 'delta', 'absent', '汉字',
  '🚀', 'x\0y', '\ud800', '\udfff', '__proto__', 'constructor', 'toString', 'hasOwnProperty']
const queryOptions: SearchParams<ReturnType<typeof database>>[] = [
  { exact: true, properties: '*' },
  { exact: false, properties: ['body', 'title', 'notes'] },
  { tolerance: 1, properties: ['body'], threshold: 1, boost: { body: 2 }, where: { kind: { eq: 'passage' } } },
]

async function equivalent(baseline: ReturnType<typeof database>, optimized: ReturnType<typeof database>, label: string) {
  // This includes every score parameter, internal ID, radix tree, and stored document,
  // not merely the final hit order. NaN and undefined must also agree exactly.
  assert.deepEqual(save(optimized), save(baseline), `${label}: complete serialized index state`)
  for (const term of terms) {
    for (const options of queryOptions) {
      const params = { term, ...options, limit: 50 }
      const { elapsed: _baselineTime, ...expected } = await search(baseline, params)
      const { elapsed: _optimizedTime, ...actual } = await search(optimized, params)
      assert.deepEqual(actual, expected, `${label}: ${JSON.stringify(params)} includes exact scores`)
    }
  }
}

for (const reuseArray of [false, true]) {
  const baseline = database(false, reuseArray)
  const optimized = database(true, reuseArray)
  const label = reuseArray ? 'reused token array' : 'fresh token arrays'
  await equivalent(baseline, optimized, `${label}: empty database`)
  const initial = [
    doc('repeats', ['alpha', 'alpha', 'beta', ''], ['title', 'alpha'], ['', 'note', '', 'note']),
    doc('multifield', ['beta', 'gamma'], ['beta', 'beta', 'gamma'], ['alpha', 'delta'], [['tag', 'tag'], [], ['alpha']]),
    doc('empty', [], [], [], [[]]),
    doc('boundaries', ['汉字', '汉字', '🚀', 'x\0y', '\ud800', '\udfff'], ['constructor', 'toString'],
      ['__proto__', '__proto__', 'hasOwnProperty', 'valueOf', '0', '01', '4294967295']),
  ]
  for (const item of initial) {
    await insert(baseline, structuredClone(item))
    await insert(optimized, structuredClone(item))
    await equivalent(baseline, optimized, `${label}: insert ${item.id}`)
  }
  const id = components.internalDocumentIDStore.getInternalDocumentId(optimized.internalDocumentIDStore, 'repeats')
  assert.equal(optimized.data.index.frequencies.body[id]!.alpha, 2 / 4, 'duplicate token frequency is not deduplicated')
  assert.equal(optimized.data.index.tokenOccurrences.body.alpha, 2, 'duplicate token occurrences are not deduplicated')
  assert.equal(optimized.data.index.frequencies.notes[id]![''], 2 / 4, 'empty token frequency is retained')
  const hits = (await search(optimized, { term: 'alpha', exact: true })).hits
  assert.ok(hits.length > 0 && hits.some(hit => Number.isFinite(hit.score) && hit.score !== 0), 'scores are actually exercised')

  assert.equal(await remove(optimized, 'repeats'), await remove(baseline, 'repeats'))
  await equivalent(baseline, optimized, `${label}: remove repeated terms`)
  const replacement = doc('repeats', ['delta', 'delta', 'alpha'], ['beta'], ['new', 'new', 'new'])
  await insert(baseline, structuredClone(replacement))
  await insert(optimized, structuredClone(replacement))
  await equivalent(baseline, optimized, `${label}: reinsert same ID with changed terms`)

  const increment = [doc('added-one', ['alpha', 'delta', 'delta']), doc('added-two', [], ['beta', 'alpha', 'alpha'])]
  await insertMultiple(baseline, structuredClone(increment))
  await insertMultiple(optimized, structuredClone(increment))
  await equivalent(baseline, optimized, `${label}: batch increment`)
  const edited = doc('multifield', ['delta', 'delta'], ['alpha', 'alpha'], [], [['beta'], ['beta', 'beta']])
  await update(baseline, 'multifield', structuredClone(edited))
  await update(optimized, 'multifield', structuredClone(edited))
  await equivalent(baseline, optimized, `${label}: update multiple fields`)

  // Load uses the default format; the ephemeral frequency cache is never serialized.
  const restored = database(true, reuseArray)
  load(restored, structuredClone(save(baseline)))
  await equivalent(baseline, restored, `${label}: load default index into optimized component`)
  const afterLoad = doc('after-load', ['delta', 'alpha', 'alpha'])
  await insert(baseline, structuredClone(afterLoad))
  await insert(restored, structuredClone(afterLoad))
  await equivalent(baseline, restored, `${label}: increment after load`)

  // Last-document removal and rebuilding preserve Orama's undefined average and ID behavior.
  for (const item of [...initial, ...increment, afterLoad]) {
    assert.equal(await remove(restored, item.id), await remove(baseline, item.id))
    await equivalent(baseline, restored, `${label}: remove ${item.id}`)
  }
  const rebuilt = doc('rebuilt', ['alpha', 'alpha', '', 'delta'])
  await insert(baseline, structuredClone(rebuilt))
  await insert(restored, structuredClone(rebuilt))
  await equivalent(baseline, restored, `${label}: insert after removing all documents`)
  console.log(`✓ ${label}: full scoring state and search scores match default Orama across insert/remove/update/load`)
}

// Exercise the score hook itself with empty arrays and missing tokens. These do not
// occur in normal insertion, but retaining 0/0 (NaN) matches the default hook contract.
{
  const baseline = database(false, false)
  const optimized = database(true, false)
  const tokens: string[] = []
  for (const values of [[], ['alpha', 'alpha', '', 'constructor', '__proto__'], ['delta', 'delta', 'delta']]) {
    tokens.splice(0, tokens.length, ...values)
    for (const db of [baseline, optimized]) {
      db.index.insertDocumentScoreParameters(db.data.index, 'body', 'hook-test', tokens, 1)
      for (const token of [...tokens, 'missing']) db.index.insertTokenScoreParameters(db.data.index, 'body', 'hook-test', tokens, token)
    }
    assert.deepEqual(save(optimized), save(baseline), 'direct score hooks preserve empty/missing token behavior and reused arrays')
  }
  console.log('✓ Direct hook edge cases, including NaN and prototype keys, retain default scoring state')
}

// A small deterministic complexity check avoids noisy wall-clock performance assertions.
// Count yielded tokens: default insertion scans n tokens n times plus its outer loop;
// the component must scan once for counts plus the same unchanged outer loop.
async function iterationCount(optimized: boolean, size: number) {
  let iterations = 0
  const tokens = Array.from({ length: size }, (_, i) => `token-${i % 37}`)
  tokens[Symbol.iterator] = function* () {
    for (let i = 0; i < this.length; i++) {
      iterations++
      yield this[i]!
    }
    return undefined
  }
  const db = create({ schema: { body: 'string' }, sort: { enabled: false }, components: {
    tokenizer: { language: 'english', normalizationCache: new Map(), tokenize: () => tokens },
    index: optimized ? createTokenScoreIndex() : components.index.createIndex(),
  } })
  await insert(db, { id: 'complexity', body: 'counted tokens' })
  return { iterations, state: save(db) }
}
for (const size of [1, 64, 256]) {
  const baseline = await iterationCount(false, size)
  const optimized = await iterationCount(true, size)
  assert.deepEqual(optimized.state, baseline.state, 'linear counting preserves full index state')
  assert.equal(baseline.iterations, size * (size + 1))
  assert.equal(optimized.iterations, size * 2)
}
console.log('✓ Token visits fall from n² + n to 2n without timing thresholds or scoring changes')
