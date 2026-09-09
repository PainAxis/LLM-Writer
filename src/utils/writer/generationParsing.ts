import type { WriterTimestamp } from '../../types/writer'

export interface GeneratedItemParserOptions {
  idFactory?: (index: number) => number
  now?: () => WriterTimestamp
}

export interface GeneratedItemParserRuntime {
  createId: (index: number) => number
  now: () => WriterTimestamp
}

export function createGeneratedItemParserRuntime(
  options: GeneratedItemParserOptions = {},
): GeneratedItemParserRuntime {
  const baseId = Date.now()

  return {
    createId: options.idFactory ?? (index => baseId + index),
    now: options.now ?? (() => new Date()),
  }
}

export function normalizeGeneratedText(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*```[^\n]*$/gm, '')
    .trim()
}

export function cleanGeneratedValue(value: string): string {
  return value
    .trim()
    .replace(/^(?:\*{1,2}|_{1,2})[ \t]*/, '')
    .replace(/[ \t]*(?:\*{1,2}|_{1,2})$/, '')
    .trim()
}

function globalRegExp(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
}

/**
 * Split text at line markers and omit the marker itself. The first capture is
 * retained as an optional inline heading, while text before the first marker
 * is deliberately ignored as model preamble.
 */
export function splitAfterLineMarkers(content: string, pattern: RegExp): string[] {
  const matches = [...content.matchAll(globalRegExp(pattern))]
  if (matches.length === 0) return []

  return matches
    .map((match, index) => {
      const start = (match.index ?? 0) + match[0].length
      const end = matches[index + 1]?.index ?? content.length
      const inlineHeading = cleanGeneratedValue(match[1] ?? '')
      const body = content.slice(start, end).trim()
      return [inlineHeading, body].filter(Boolean).join('\n').trim()
    })
    .filter(Boolean)
}

/**
 * Split text at field lines while retaining each marker. This is useful for
 * repeated labels such as `标题：`, which are also needed by the field parser.
 */
export function splitStartingAtLineMarkers(content: string, pattern: RegExp): string[] {
  const matches = [...content.matchAll(globalRegExp(pattern))]
  if (matches.length === 0) return []

  return matches
    .map((match, index) => {
      const start = match.index ?? 0
      const end = matches[index + 1]?.index ?? content.length
      return content.slice(start, end).trim()
    })
    .filter(Boolean)
}
