import type {
  WriterCharacter,
  WriterCharacterGender,
  WriterCharacterRole,
} from '../../types/writer'
import {
  cleanGeneratedValue,
  createGeneratedItemParserRuntime,
  normalizeGeneratedText,
  splitAfterLineMarkers,
  splitStartingAtLineMarkers,
  type GeneratedItemParserOptions,
} from './generationParsing'

type CharacterField =
  | 'name'
  | 'role'
  | 'gender'
  | 'age'
  | 'appearance'
  | 'personality'
  | 'background'
  | 'tags'

const CHARACTER_FIELD_ALIASES: Record<string, CharacterField> = {
  姓名: 'name',
  名字: 'name',
  角色名: 'name',
  name: 'name',
  角色类型: 'role',
  角色: 'role',
  职责: 'role',
  定位: 'role',
  类型: 'role',
  role: 'role',
  性别: 'gender',
  gender: 'gender',
  年龄: 'age',
  age: 'age',
  外貌特征: 'appearance',
  外貌: 'appearance',
  外观: 'appearance',
  长相: 'appearance',
  appearance: 'appearance',
  性格特点: 'personality',
  性格: 'personality',
  个性: 'personality',
  personality: 'personality',
  背景故事: 'background',
  背景: 'background',
  经历: 'background',
  身世: 'background',
  background: 'background',
  标签: 'tags',
  特征: 'tags',
  tag: 'tags',
  tags: 'tags',
}

const CHARACTER_LABEL_PATTERN = new RegExp(
  `^(?:\\*{1,2}|_{1,2})?[ \\t]*(${Object.keys(CHARACTER_FIELD_ALIASES)
    .sort((left, right) => right.length - left.length)
    .join('|')})[ \\t]*(?:\\*{1,2}|_{1,2})?[ \\t]*[：:][ \\t]*(?:\\*{1,2}|_{1,2})?[ \\t]*(.*?)[ \\t]*(?:\\*{1,2}|_{1,2})?$`,
  'i',
)

const LONG_CHARACTER_FIELDS = new Set<CharacterField>([
  'appearance',
  'personality',
  'background',
])

function withoutListMarker(line: string): string {
  return line.replace(/^[ \t]*(?:[-+>]|\*(?!\*))[ \t]+/, '')
}

function splitCharacterBlocks(content: string): string[] {
  const numberedCharacters = splitAfterLineMarkers(
    content,
    /^[ \t]*角色[ \t]*\d+[ \t]*[：:][ \t]*([^\n]*)$/gim,
  )
  if (numberedCharacters.length > 0) return numberedCharacters

  const nameMarkers = splitStartingAtLineMarkers(
    content,
    /^[ \t]*(?:\*{1,2}|_{1,2})?[ \t]*(?:姓名|名字|角色名|name)(?:\*{1,2}|_{1,2})?[ \t]*[：:]/gim,
  )
  if (nameMarkers.length > 0) return nameMarkers

  const markdownHeadings = splitAfterLineMarkers(
    content,
    /^[ \t]*#{1,6}[ \t]+([^\n]+)$/gm,
  )
  if (markdownHeadings.length > 0) return markdownHeadings

  // `(?!\d)` prevents decimal values such as `1.5` from becoming new items.
  const numberedList = splitAfterLineMarkers(
    content,
    /^[ \t]*\d+[ \t]*[.、．)](?!\d)[ \t]*([^\n]*)$/gm,
  )
  if (numberedList.length > 0) return numberedList

  const paragraphs = content.split(/\n[ \t]*\n+/).map(block => block.trim()).filter(Boolean)
  const identifiedParagraphs = paragraphs.filter(block => /(?:姓名|名字|角色名|name)[ \t]*[：:]/i.test(block))
  if (identifiedParagraphs.length > 1) return paragraphs

  return [content]
}

function collectCharacterFields(block: string): {
  fields: Partial<Record<CharacterField, string[]>>
  unlabelled: string[]
} {
  const fields: Partial<Record<CharacterField, string[]>> = {}
  const unlabelled: string[] = []
  let activeField: CharacterField | null = null

  for (const rawLine of block.split('\n')) {
    const line = withoutListMarker(rawLine).trim()
    if (!line) continue

    const match = line.match(CHARACTER_LABEL_PATTERN)
    if (match) {
      const field = CHARACTER_FIELD_ALIASES[match[1].toLowerCase()]
      if (!field) continue
      const value = cleanGeneratedValue(match[2])
      fields[field] = value ? [value] : []
      activeField = field
      continue
    }

    if (activeField && LONG_CHARACTER_FIELDS.has(activeField)) {
      fields[activeField] ??= []
      fields[activeField]?.push(cleanGeneratedValue(line))
    } else {
      unlabelled.push(cleanGeneratedValue(line))
    }
  }

  return { fields, unlabelled }
}

function fieldValue(
  fields: Partial<Record<CharacterField, string[]>>,
  field: CharacterField,
  separator = '\n',
): string {
  return (fields[field] ?? []).filter(Boolean).join(separator).trim()
}

function parseRole(value: string, fallbackText: string): WriterCharacterRole {
  const role = value || fallbackText
  if (/(?:反派|反面|antagonist|villain)/i.test(role)) return 'antagonist'
  if (/(?:主角|男主|女主|protagonist|lead)/i.test(role)) return 'protagonist'
  if (/(?:配角|支持角色|supporting)/i.test(role)) return 'supporting'
  if (/(?:次要角色|龙套|minor)/i.test(role)) return 'minor'
  return value ? 'minor' : 'supporting'
}

function parseGender(value: string, fallbackText: string): WriterCharacterGender {
  const gender = value || fallbackText
  if (/(?:女性|女|female)/i.test(gender)) return 'female'
  if (/(?:男性|男|male)/i.test(gender)) return 'male'
  return value ? 'other' : 'male'
}

function parseAge(value: string, fallbackText: string): number {
  const match = value.match(/\d+/) ?? fallbackText.match(/(?:年龄|age)[约大概为是:：\s]*(\d+)/i)
    ?? fallbackText.match(/(\d+)[ \t]*(?:岁|years?)/i)
  const parsed = Number.parseInt(match?.[1] ?? match?.[0] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 && parsed < 200 ? parsed : 25
}

function parseTags(value: string, role: WriterCharacterRole): string[] {
  const tags = value
    .split(/[,，、;；|\s]+/)
    .map(tag => tag.trim())
    .filter(Boolean)
  return tags.length > 0 ? tags : [role === 'protagonist' ? '主角' : '配角']
}

function fallbackName(unlabelled: string[], index: number): string {
  const firstLine = unlabelled[0]
    ?.replace(/^[ \t]*(?:#{1,6}|\d+[.、．)])[ \t]*/, '')
    .replace(/^[^\p{L}\p{N}]*/u, '')
    .trim()

  if (firstLine && firstLine.length < 20 && !/[：:]/.test(firstLine)) return firstLine
  return `角色${index + 1}`
}

export function parseGeneratedCharacters(
  rawContent: string,
  options: GeneratedItemParserOptions = {},
): WriterCharacter[] {
  const content = normalizeGeneratedText(rawContent)
  if (!content) return []

  const runtime = createGeneratedItemParserRuntime(options)

  return splitCharacterBlocks(content)
    .map((block, index): WriterCharacter | null => {
      const { fields, unlabelled } = collectCharacterFields(block)
      const role = parseRole(fieldValue(fields, 'role', ' '), block)
      const gender = parseGender(fieldValue(fields, 'gender', ' '), block)
      const appearance = fieldValue(fields, 'appearance')
      const personality = fieldValue(fields, 'personality')
      const background = fieldValue(fields, 'background')
      const name = fieldValue(fields, 'name', ' ') || fallbackName(unlabelled, index)

      if (!name || name === '角色') return null

      return {
        id: runtime.createId(index),
        name,
        role,
        gender,
        age: parseAge(fieldValue(fields, 'age', ' '), block),
        appearance: appearance || (personality || background ? '外貌特征待补充' : ''),
        personality: personality || (appearance || background ? '性格特点待补充' : ''),
        background: background || (appearance || personality ? '背景故事待补充' : ''),
        tags: parseTags(fieldValue(fields, 'tags', ' '), role),
        avatar: '',
        createdAt: runtime.now(),
        generated: true,
      }
    })
    .filter((character): character is WriterCharacter => character !== null)
}

export type { GeneratedItemParserOptions } from './generationParsing'
