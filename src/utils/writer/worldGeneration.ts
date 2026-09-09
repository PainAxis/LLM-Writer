import type { WriterWorldSetting, WriterWorldSettingCategory } from '../../types/writer'
import {
  cleanGeneratedValue,
  createGeneratedItemParserRuntime,
  normalizeGeneratedText,
  splitAfterLineMarkers,
  splitStartingAtLineMarkers,
  type GeneratedItemParserOptions,
} from './generationParsing'

type WorldSettingField = 'title' | 'type' | 'description'

const WORLD_FIELD_ALIASES: Record<string, WorldSettingField> = {
  标题: 'title',
  名称: 'title',
  title: 'title',
  类型: 'type',
  分类: 'type',
  type: 'type',
  category: 'type',
  描述: 'description',
  详情: 'description',
  设定内容: 'description',
  description: 'description',
  content: 'description',
}

const WORLD_LABEL_PATTERN = new RegExp(
  `^(?:\\*{1,2}|_{1,2})?[ \\t]*(${Object.keys(WORLD_FIELD_ALIASES)
    .sort((left, right) => right.length - left.length)
    .join('|')})[ \\t]*(?:\\*{1,2}|_{1,2})?[ \\t]*[：:][ \\t]*(?:\\*{1,2}|_{1,2})?[ \\t]*(.*?)[ \\t]*(?:\\*{1,2}|_{1,2})?$`,
  'i',
)

function withoutListMarker(line: string): string {
  return line.replace(/^[ \t]*(?:[-+>]|\*(?!\*))[ \t]+/, '')
}

function splitWorldSettingBlocks(content: string): string[] {
  const numberedSettings = splitAfterLineMarkers(
    content,
    /^[ \t]*设定[ \t]*\d+[ \t]*[：:][ \t]*([^\n]*)$/gim,
  )
  if (numberedSettings.length > 0) return numberedSettings

  const titleMarkers = splitStartingAtLineMarkers(
    content,
    /^[ \t]*(?:\*{1,2}|_{1,2})?[ \t]*(?:标题|title)(?:\*{1,2}|_{1,2})?[ \t]*[：:]/gim,
  )
  if (titleMarkers.length > 0) return titleMarkers

  const markdownHeadings = splitAfterLineMarkers(
    content,
    /^[ \t]*#{1,6}[ \t]+([^\n]+)$/gm,
  )
  if (markdownHeadings.length > 0) return markdownHeadings

  // Only a complete line-leading list marker can split a setting. In
  // particular, neither `1.5小时` nor a decimal inside a description matches.
  const numberedList = splitAfterLineMarkers(
    content,
    /^[ \t]*\d+[ \t]*[.、．)](?!\d)[ \t]*([^\n]*)$/gm,
  )
  if (numberedList.length > 0) return numberedList

  const paragraphs = content.split(/\n[ \t]*\n+/).map(block => block.trim()).filter(Boolean)
  const structuredParagraphs = paragraphs.filter(block => /(?:标题|名称|title)[ \t]*[：:]/i.test(block))
  if (structuredParagraphs.length > 1 || (structuredParagraphs.length === 0 && paragraphs.length > 1)) {
    return paragraphs
  }

  return [content]
}

function collectWorldSettingFields(block: string): {
  fields: Partial<Record<WorldSettingField, string[]>>
  unlabelled: string[]
} {
  const fields: Partial<Record<WorldSettingField, string[]>> = {}
  const unlabelled: string[] = []
  let activeField: WorldSettingField | null = null

  for (const rawLine of block.split('\n')) {
    const line = withoutListMarker(rawLine).trim()
    if (!line) continue

    const match = line.match(WORLD_LABEL_PATTERN)
    if (match) {
      const field = WORLD_FIELD_ALIASES[match[1].toLowerCase()]
      if (!field) continue
      const value = cleanGeneratedValue(match[2])
      fields[field] = value ? [value] : []
      activeField = field
      continue
    }

    if (activeField === 'description') {
      fields.description ??= []
      fields.description.push(cleanGeneratedValue(line))
    } else {
      unlabelled.push(cleanGeneratedValue(line))
    }
  }

  return { fields, unlabelled }
}

function fieldValue(
  fields: Partial<Record<WorldSettingField, string[]>>,
  field: WorldSettingField,
  separator = '\n',
): string {
  return (fields[field] ?? []).filter(Boolean).join(separator).trim()
}

export function normalizeWorldSettingCategory(type: string): WriterWorldSettingCategory {
  const normalized = type.trim().toLowerCase()
  if (normalized === 'politics' || /(?:政治|势力|国家|政权|制度|组织)/.test(normalized)) {
    return 'politics'
  }
  if (normalized === 'magic' || /(?:魔法|修炼|修仙|灵力|超凡|能力体系|力量体系)/.test(normalized)) {
    return 'magic'
  }
  if (normalized === 'history' || /(?:历史|年代|纪元|时间线)/.test(normalized)) {
    return 'history'
  }
  if (normalized === 'geography' || /(?:地理|地形|地域|地点|自然环境|生态环境)/.test(normalized)) {
    return 'geography'
  }
  return 'setting'
}

function fallbackTitle(unlabelled: string[], description: string, index: number): {
  title: string
  description: string
} {
  const firstLine = unlabelled[0]
    ?.replace(/^[ \t]*(?:#{1,6}|\d+[.、．)])[ \t]*/, '')
    .replace(/^[^\p{L}\p{N}]*/u, '')
    .trim()

  if (firstLine && firstLine.length <= 50) {
    const remaining = [...unlabelled.slice(1), description].filter(Boolean).join('\n').trim()
    return { title: firstLine, description: remaining }
  }

  const effectiveDescription = description || unlabelled.join('\n').trim()
  const descriptionFirstLine = effectiveDescription.split('\n')[0]?.trim() ?? ''
  if (descriptionFirstLine && descriptionFirstLine.length <= 50) {
    return {
      title: descriptionFirstLine,
      description: effectiveDescription.split('\n').slice(1).join('\n').trim(),
    }
  }

  const firstSentence = descriptionFirstLine.split(/[。！？.!?]/)[0]?.trim() ?? ''
  return {
    title: firstSentence && firstSentence.length <= 30 ? firstSentence : `世界观设定${index + 1}`,
    description: effectiveDescription,
  }
}

export function parseGeneratedWorldSettings(
  rawContent: string,
  options: GeneratedItemParserOptions = {},
): WriterWorldSetting[] {
  const content = normalizeGeneratedText(rawContent)
  if (!content) return []

  const runtime = createGeneratedItemParserRuntime(options)

  return splitWorldSettingBlocks(content).map((block, index): WriterWorldSetting => {
    const { fields, unlabelled } = collectWorldSettingFields(block)
    const type = fieldValue(fields, 'type', ' ') || '其他'
    let title = fieldValue(fields, 'title', ' ')
    let description = fieldValue(fields, 'description')

    if (!title) {
      const fallback = fallbackTitle(unlabelled, description, index)
      title = fallback.title
      description = fallback.description
    } else if (!description && unlabelled.length > 0) {
      description = unlabelled.join('\n').trim()
    }

    if (!description) description = '暂无描述'

    return {
      id: runtime.createId(index),
      title,
      type,
      category: normalizeWorldSettingCategory(type),
      description,
      createdAt: runtime.now(),
      generated: true,
    }
  })
}

export type { GeneratedItemParserOptions } from './generationParsing'
