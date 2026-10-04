import { chapterRevision } from '../../src/services/memory/revision'
import type { FactEntity, FactGraphDocument, FactRelation } from '../../src/types/factGraph'
import type { MemoryProjectInput } from '../../src/types/memory'

/** Deterministic synthetic fiction: workload/source-integrity coverage, not model extraction quality. */
export async function createFactGraphCorpus() {
  const project: MemoryProjectInput = {
    id: 'fact-graph-long-novel', title: '十二卷渡口纪事', chapters: [], clues: [],
  }
  const relations: FactRelation[] = []
  const entity = (type: FactEntity['type'], label: string): FactEntity => ({ type, label })
  const chapterCount = 600
  for (let ordinal = 1; ordinal <= chapterCount; ordinal++) {
    const code = String(ordinal).padStart(4, '0')
    const actor = entity('person', ordinal === 600 ? '鸦面使者' : `沈砚${ordinal % 37}`)
    const partner = entity('person', `顾宁${ordinal % 43}`)
    const item = entity('object', ordinal === 1 ? '断角铜符伏线0001' : `渡口货签${code}`)
    const place = entity('place', `青岚渡口${ordinal % 29}`)
    const event = entity('event', `查验风波${code}`)
    const rows: Array<[FactEntity, FactEntity, string, string]> = [
      [actor, item, '保管', `${actor.label}将${item.label}收进贴身衣袋，交接簿中记明由她独自保管。`],
      [item, place, '寄存', `${item.label}此前寄存在${place.label}，账房保留了原始寄存凭条。`],
      [actor, event, '参与', `${actor.label}亲自参与${event.label}，当时值守的船夫看见她进门。`],
      [event, place, '发生于', `${event.label}发生在${place.label}，雨水打湿了值夜人的笔录。`],
      [actor, partner, '约定接应', `${actor.label}与${partner.label}约定在第三声更鼓后接应，未见信物便继续等待。`],
      [item, event, '作为凭证', `${item.label}是${event.label}的交接凭证，签押处保留了两枚不同的手印。`],
      [partner, item, '检查', `${partner.label}检查过${item.label}的缺口，特意将磨损位置绘在纸上。`],
      [event, partner, '由其记录', `${event.label}由${partner.label}记录，记录只包括本次查验的亲眼所见。`],
      [partner, place, '抵达', `${partner.label}在日落前抵达${place.label}，把空船停在东侧岸边。`],
    ]
    const paragraphs = rows.map(row => row[3])
    for (let beat = 0; paragraphs.join('\n\n').length < 2_300; beat++) {
      paragraphs.push(`第${ordinal}程第${beat + 1}次查验时，${actor.label}翻到第${ordinal + beat + 11}页账簿，核对${beat + 3}户人家的货款。${partner.label}沿着${place.label}的石阶逐户问询，记下不同船期与水位。抄手保留了第${Math.floor((ordinal - 1) / 50) + 1}卷的旧笔迹，对无法印证的传闻只画了问号。`)
    }
    const chapter = { id: `graph-chapter-${ordinal}`, title: `第${ordinal}章 渡口夜记`, text: paragraphs.join('\n\n') }
    if (ordinal === 600) chapter.text += '\n\n顾宁41揭下面具，鸦面使者终于在终卷现身。'
    project.chapters.push(chapter)
    const sourceRevision = await chapterRevision(chapter)
    rows.forEach(([source, target, predicate, quote], row) => {
      const start = chapter.text.indexOf(quote)
      relations.push({
        id: `graph-${ordinal}-${row}`, projectId: project.id, source, target, predicate,
        origin: row === 4 ? 'inferred' : 'explicit', createdBy: row === 4 ? 'model' : 'author', authorConfirmed: ordinal % 7 === 0,
        evidence: [{ chapterId: chapter.id, sourceRevision, start, end: start + quote.length, quote }],
      })
    })
  }
  // Reverse storage order to force disclosure/query filtering before the 200-row rendering bound.
  const document: FactGraphDocument = { version: 1, projectId: project.id, revision: '', relations: relations.reverse() }
  return {
    project, document,
    manifest: {
      version: 1, chapters: chapterCount, relations: relations.length,
      chars: project.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0),
      description: 'Synthetic 600-chapter fiction with 5,400 source-anchored relations; no LLM or provider requests.',
    },
    distantQuery: '断角铜符伏线0001',
  }
}
