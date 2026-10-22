import { components } from '@orama/orama'

/** Preserve Orama's scoring state while counting a field's token frequencies only once. */
export function createTokenScoreIndex(): ReturnType<typeof components.index.createIndex> {
  const index = components.index.createIndex()
  const tokenCounts = new WeakMap<string[], Map<string, number>>()

  return {
    ...index,
    insertDocumentScoreParameters(store, property, id, tokens, docsCount) {
      // A tokenizer may reuse and mutate its array between fields, documents, or updates.
      // Invalidate at the field boundary rather than assuming array identity means freshness.
      tokenCounts.delete(tokens)
      index.insertDocumentScoreParameters(store, property, id, tokens, docsCount)
    },
    insertTokenScoreParameters(store, property, id, tokens, token) {
      let counts = tokenCounts.get(tokens)
      if (!counts) {
        counts = new Map<string, number>()
        for (const value of tokens) counts.set(value, (counts.get(value) ?? 0) + 1)
        tokenCounts.set(tokens, counts)
      }

      const internalId = components.internalDocumentIDStore.getInternalDocumentId(store.sharedInternalDocumentStore, id)
      // Keep the default assignments, including duplicate/empty tokens and inherited keys.
      // tokenOccurrences counts each insertion, not just each distinct token or document.
      store.frequencies[property]![internalId]![token] = (counts.get(token) ?? 0) / tokens.length
      if (!(token in store.tokenOccurrences[property]!)) store.tokenOccurrences[property]![token] = 0
      store.tokenOccurrences[property]![token] = (store.tokenOccurrences[property]![token] ?? 0) + 1
    },
  }
}
