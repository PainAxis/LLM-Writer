import type { MemoryMatchSignals, MemoryMatchSummary } from '@/types/memory'
import { memoryIdentifiers } from './identifiers'

export interface MemoryMatchSource {
  quote: string
  chapterTitle: string
  /** From identifierEdges(currentChapter.text, quoteStart, quoteEnd). */
  quoteEdges?: number
  /** Each accepted clue label/alias separately; never concatenate independent fields. */
  annotations?: readonly string[]
}

const ASCII_TOKEN_CHAR = /^[A-Za-z0-9_-]$/u
// Preserve UTF-16 positions and the identifier grammar while ignoring ASCII case.
const foldAscii = (text: string) => text.replace(/[A-Z]/gu, char => char.toLowerCase())

/** Exact query occurrences must not be prefixes/suffixes of an ASCII token. */
function literalContact(query: string, field: string, edges: number, supported: boolean): boolean {
  if (!query || !supported) return false
  const needle = foldAscii(query)
  const haystack = foldAscii(field)
  for (let position = haystack.indexOf(needle); position >= 0; position = haystack.indexOf(needle, position + 1)) {
    const end = position + needle.length
    const extendsLeft = ASCII_TOKEN_CHAR.test(query[0]!)
      && (position === 0 ? Boolean(edges & 1) : ASCII_TOKEN_CHAR.test(field[position - 1]!))
    const extendsRight = ASCII_TOKEN_CHAR.test(query.at(-1)!)
      && (end === field.length ? Boolean(edges & 2) : ASCII_TOKEN_CHAR.test(field[end]!))
    if (!extendsLeft && !extendsRight) return true
  }
  return false
}

/** No score, remote claim, annotation text or graph confirmation can establish answerability. */
export function buildMemoryMatch(query: string, source: MemoryMatchSource): MemoryMatchSignals {
  const text = query.trim()
  const requested = memoryIdentifiers(text)
  // Unsupported code-shaped runs stay candidates instead of being accepted as
  // a shorter code or as a misleading "complete query" match.
  const supported = ![...text.matchAll(/[A-Za-z0-9_-]+/gu)].some(([value]) =>
    /[A-Za-z]/u.test(value) && /[0-9]/u.test(value) && memoryIdentifiers(value).length === 0)
  const evaluate = (value: string, edges = 0) => {
    const values = new Set(memoryIdentifiers(value, edges))
    const identifiers = requested.filter(identifier => values.has(identifier))
    return {
      identifiers,
      literal: identifiers.length === requested.length && literalContact(text, value, edges, supported),
    }
  }
  const quote = evaluate(source.quote, source.quoteEdges ?? 0)
  const title = evaluate(source.chapterTitle)
  const annotations = (source.annotations ?? []).map(value => evaluate(value))
  return {
    version: 1, answerability: 'unverified',
    literal: { quote: quote.literal, title: title.literal, annotation: annotations.some(value => value.literal) },
    identifiers: {
      quote: quote.identifiers, title: title.identifiers,
      annotation: requested.filter(identifier => annotations.some(value => value.identifiers.includes(identifier))),
    },
  }
}

/** Aggregate only the returned/selected units passed by the caller, after its budget and source gates. */
export function summarizeMemoryMatches(query: string, matches: readonly MemoryMatchSignals[]): MemoryMatchSummary {
  const requestedIdentifiers = memoryIdentifiers(query.trim())
  const covered = new Set(matches.flatMap(match => [
    ...match.identifiers.quote, ...match.identifiers.title, ...match.identifiers.annotation,
  ]))
  const matched = matches.some(match => Object.values(match.literal).some(Boolean)
    || [...match.identifiers.quote, ...match.identifiers.title, ...match.identifiers.annotation]
      .some(identifier => requestedIdentifiers.includes(identifier)))
  return {
    answerability: 'unverified', state: matches.length === 0 ? 'none' : matched ? 'matched' : 'candidates',
    requestedIdentifiers, missingIdentifiers: requestedIdentifiers.filter(identifier => !covered.has(identifier)),
  }
}
