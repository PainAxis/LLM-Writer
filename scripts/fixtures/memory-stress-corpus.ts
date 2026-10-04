import { chapterRevision } from '../../src/services/memory/revision'
import type { MemoryChapterInput, MemoryClue, MemoryProjectInput } from '../../src/types/memory'

/** Reproducible, varied procedural fiction. This is not a literary or model-quality benchmark. */
export interface StressProbe {
  id: string
  query: string
  chapterId: string
  ordinal: number
  quote: string
  throughChapterId: string
}

export interface StressFact extends StressProbe {
  oldValue: string
  replacementValue: string
  actor: string
  recipient: string
  location: string
}

export interface StressSecret extends StressProbe {
  beforeChapterId: string
}

export interface StressNovel {
  project: MemoryProjectInput
  manifest: {
    fixtureVersion: number
    seed: number
    chapters: number
    charsPerChapter: number
    totalChars: number
    volumes: number
    castSize: number
    locations: number
    usedCast: number
    usedLocations: number
    paragraphTemplates: number
    usedParagraphTemplates: number
    generatedParagraphs: number
    uniqueParagraphRatio: number
    description: string
  }
  facts: StressFact[]
  clues: StressProbe[]
  futureSecrets: StressSecret[]
  positiveQueries: StressProbe[]
  editTargets: StressFact[]
  naturalQueries: Array<{ id: string; query: string; throughChapterId: string; relevantChapterIds: string[] }>
  negativeQueries: string[]
}

const SEED = 0x516870ab
const surnames = ['沈', '顾', '陆', '谢', '温', '苏', '秦', '江', '叶', '许', '宁', '裴']
const givenNames = ['砚舟', '知微', '云岚', '听雪', '照川', '怀瑾']
const cast = surnames.flatMap(surname => givenNames.map(name => `${surname}${name}`))
const districts = ['青岚', '白沙', '乌桐', '鹿鸣', '寒汀', '望川', '赤岭', '兰泽', '东篱']
const places = districts.flatMap(place => ['渡口', '驿站', '书院', '药铺'].map(kind => `${place}${kind}`))
const objects = ['盐引', '药箱', '账本', '河图', '铜铃', '木匣', '玉扣', '旧伞', '油灯', '船契', '丝帛', '箭簇']
const weather = ['夜雨初歇', '霜雾压城', '烈日当空', '江风渐起', '残雪未消', '雷声越岭', '芦花飘飞', '月色正浓']
const conflicts = ['漕粮短缺', '船期延误', '盐价上涨', '桥梁坍塌', '疫病传闻', '账目错漏', '驿路封锁', '失踪案卷', '水位骤升', '商会争执']
const actions = ['查访', '押运', '交涉', '疗伤', '守夜', '修桥', '对账', '潜行', '审问', '送信', '避雨', '远航']
const code = (prefix: string, ordinal: number) => `${prefix}${String(ordinal).padStart(5, '0')}`
const chapterId = (ordinal: number) => `stress-chapter-${ordinal}`

function randomSource(seed: number) {
  let state = seed >>> 0
  return (maximum: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    // Use the full fractional output, not biased low LCG bits for power-of-two template counts.
    return Math.floor(state / 0x1_0000_0000 * maximum)
  }
}

function safeSlice(text: string, length: number): string {
  const previous = text.charCodeAt(length - 1)
  const next = text.charCodeAt(length)
  const splitPair = previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
  return splitPair ? `${text.slice(0, length - 1)}。` : text.slice(0, length)
}

function sample<T>(values: T[], count: number): T[] {
  if (values.length <= count) return [...values]
  return Array.from({ length: count }, (_, index) => values[Math.floor(index * (values.length - 1) / (count - 1))]!)
}

export async function createStressNovel(options: {
  chapters: number
  charsPerChapter: number
  projectId?: string
}): Promise<StressNovel> {
  if (!Number.isSafeInteger(options.chapters) || options.chapters < 80 || options.chapters > 10_000
    || !Number.isSafeInteger(options.charsPerChapter) || options.charsPerChapter < 1_600) {
    throw new Error('Stress corpus requires 80–10,000 chapters and at least 1,600 UTF-16 characters per chapter.')
  }
  const random = randomSource(SEED)
  const chapters: MemoryChapterInput[] = []
  const facts: StressFact[] = []
  const clues: StressProbe[] = []
  const futureSecrets: StressSecret[] = []
  const annotations: MemoryClue[] = []
  const uniqueParagraphs = new Set<string>()
  const usedCast = new Set<string>()
  const usedLocations = new Set<string>()
  const usedTemplates = new Set<number>()
  let generatedParagraphs = 0
  const secretOrdinals = new Set(Array.from({ length: 12 }, (_, index) => options.chapters - index * 2))

  for (let ordinal = 1; ordinal <= options.chapters; ordinal++) {
    const volume = Math.floor((ordinal - 1) / 50) + 1
    const person = cast[random(cast.length)]!
    const partner = cast[(cast.indexOf(person) + 1 + random(cast.length - 1)) % cast.length]!
    const place = places[random(places.length)]!
    const item = objects[random(objects.length)]!
    const conflict = conflicts[random(conflicts.length)]!
    usedCast.add(person).add(partner)
    usedLocations.add(place)
    const oldValue = `白银封蜡${code('FS', ordinal)}`
    const replacementValue = `赤铜封蜡${code('RN', ordinal)}`
    const quote = `第${volume}卷的封存记录写得分明：${person}把${oldValue}交给${partner}，寄存地点为${place}，未经两人同时签名不得取出。`
    const clueQuote = `${partner}在${item}夹层留下约定：见到${oldValue}便在第三声更鼓后接应，若只见相似的封印则继续等待。`
    const clueAlias = `旧日接应约定${code('PACT', ordinal)}`
    const opening = `${weather[random(weather.length)]}，${person}抵达${place}。这是一条与${conflict}有关的支线，同行者是${partner}。\n\n${quote}\n\n`
    const paragraphs: string[] = []
    let length = opening.length
    // Vary speakers, locations, events, amounts, plot threads and paragraph structure;
    // do not achieve the target size by repeating a single filler paragraph.
    for (let beat = 0; length < options.charsPerChapter + 1_000; beat++) {
      const actor = cast[random(cast.length)]!
      const target = cast[random(cast.length)]!
      const destination = places[random(places.length)]!
      const cargo = objects[random(objects.length)]!
      const issue = conflicts[random(conflicts.length)]!
      const amount = 3 + random(991)
      const day = 1 + ((ordinal * 11 + beat * 3) % 29)
      const hour = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'][random(12)]!
      const operation = actions[random(actions.length)]!
      usedCast.add(actor).add(target)
      usedLocations.add(destination)
      const templates = [
        `${day}日${hour}时，${actor}带着${amount}份${cargo}来到${destination}。负责${operation}的${target}拒绝当场签收，要求先查清${issue}的缘由。两人沿着石阶走了很远，终于在值夜人的记录里找到另一笔旧账，却发现它属于第${volume}卷的另一条商路，不能拿来解释眼前的争端。`,
        `“${cargo}不是凭空消失的。”${actor}说。${target}把第${ordinal}程、第${beat + 1}次交接的纸条摊开，指出${amount}两的费用里有一项没有落款。屋外有人提起${destination}，他们却先谈到了${issue}。这场争论持续到${hour}时，谁也没有轻易接受对方的猜测。`,
        `${destination}的晚市还亮着灯。${actor}在${day}日买下${amount}尺粗布，把${cargo}裹好交给小贩，随后记下第${ordinal}次旅程中的第${beat + 1}个停靠点。远处的船夫正为${issue}争吵；${target}听了一阵，决定明晨先去${operation}，再考虑是否更换路线。`,
        `${target}翻检地方志，发现${destination}曾在另一场${issue}中遭受损失。那页旁注写于${day}日${hour}时，涉及${amount}户人家，而${actor}关心的是当年的${cargo}究竟由谁保管。他们把推测和亲眼所见分别记在纸上，约好第${ordinal}程第${beat + 1}夜再核对，避免把传闻当成已经证实的事实。`,
        `${actor}做了一个关于${destination}的梦，醒来时只记得${cargo}撞击窗框的声音。${target}递来热茶，提醒她当天还有${amount}步的堤岸需要巡视。两人在${hour}时谈及${issue}，又把第${ordinal}程第${beat + 1}段路上的见闻重新排了一遍，始终没有把梦境写进给商会的正式报告。`,
        `第${ordinal}程的行囊清单新增了第${beat + 1}项：${amount}支备用灯芯。${target}负责${operation}，${actor}负责把${cargo}送往${destination}。他们为${issue}准备了两套说辞，又删掉其中未经证实的一套。${day}日${hour}时敲过后，驿卒终于带来回信，信上只答复了眼前的行程，没有谈到更远的去处。`,
        `${weather[random(weather.length)]}，${destination}的守门人认错了${actor}的姓氏，把她当作同名商人的亲属。${target}逐项核对${amount}枚货签，解释${cargo}属于另一批货物。此次${operation}发生在${day}日${hour}时，抄手将它记入第${ordinal}程第${beat + 1}页，特意保留了对方关于${issue}的疑问。`,
        `${actor}把${destination}画成一张草图，在${cargo}旁圈了${amount}个小点。${target}望着窗外，听见街坊又在谈论${issue}，便提醒她将猜测标为待核。第${ordinal}程第${beat + 1}晚的${operation}没有得到明确结论，他们只知道${day}日${hour}时有人经过这里，至于那个人的去向，仍须亲自查问。`,
      ]
      const template = random(templates.length)
      usedTemplates.add(template)
      let paragraph = templates[template]!
      if (beat === 5 && ordinal % 17 === 0) paragraph += '🌧️雨声遮住了半句话；她补画了一只🦉，作为此次通信的笔迹记号。'
      uniqueParagraphs.add(paragraph)
      generatedParagraphs++
      paragraphs.push(paragraph)
      length += paragraph.length + 2
    }
    // Alternate long continuous paragraphs and normal paragraph boundaries, including emoji.
    const separator = ordinal % 11 === 0 ? '' : '\n\n'
    const narrative = paragraphs.join(separator)
    const suffix = ordinal % 2 === 0 ? `\n\n${clueQuote}` : ''
    let secretQuote = ''
    if (secretOrdinals.has(ordinal)) {
      secretQuote = `本章才揭晓：镜面行者${code('MASK', ordinal)}的真名是${person}，此前所有有关身份的猜测均未得到证实。`
    }
    const ending = `${suffix}${secretQuote ? `\n\n${secretQuote}` : ''}`
    const body = `${opening}${safeSlice(narrative, options.charsPerChapter - opening.length - ending.length)}${ending}`
    const chapter: MemoryChapterInput = {
      id: chapterId(ordinal), title: `第${volume}卷·第${ordinal}章 ${place}的${operationTitle(ordinal)}`, text: body,
    }
    chapters.push(chapter)
    const throughChapterId = chapterId(Math.min(options.chapters, ordinal + Math.floor(options.chapters / 3)))
    facts.push({ id: `fact-${ordinal}`, query: oldValue, chapterId: chapter.id, ordinal, quote, throughChapterId, oldValue, replacementValue,
      actor: person, recipient: partner, location: place })
    if (ordinal % 2 === 0) {
      const start = body.indexOf(clueQuote)
      const probe = { id: `clue-${ordinal}`, query: clueAlias, chapterId: chapter.id, ordinal, quote: clueQuote, throughChapterId }
      clues.push(probe)
      annotations.push({
        id: probe.id, chapterId: chapter.id, sourceRevision: await chapterRevision(chapter),
        start, end: start + clueQuote.length, quote: clueQuote,
        label: `${place}接应`, aliases: [clueAlias, '旧日约定', '渡口接应', `${person}与${partner}的约定`],
      })
    }
    if (secretQuote) futureSecrets.push({
      id: `secret-${ordinal}`, query: code('MASK', ordinal), chapterId: chapter.id, ordinal,
      quote: secretQuote, throughChapterId: chapter.id, beforeChapterId: chapterId(ordinal - 1),
    })
  }
  return {
    project: { id: options.projectId ?? `stress-${options.chapters}-${options.charsPerChapter}`, title: '九河行记·程序化多卷业务语料', chapters, clues: annotations },
    manifest: {
      fixtureVersion: 2,
      seed: SEED, chapters: chapters.length, charsPerChapter: options.charsPerChapter,
      totalChars: chapters.reduce((sum, chapter) => sum + chapter.text.length, 0),
      volumes: Math.ceil(options.chapters / 50), castSize: cast.length, locations: places.length,
      usedCast: usedCast.size, usedLocations: usedLocations.size, paragraphTemplates: 8, usedParagraphTemplates: usedTemplates.size,
      generatedParagraphs, uniqueParagraphRatio: uniqueParagraphs.size / generatedParagraphs,
      description: 'Deterministic procedural Chinese fiction: varied cast, locations, events and similar clue aliases; planted exact identifiers test retrieval and provenance, not literary realism or semantic-model quality.',
    },
    facts, clues, futureSecrets,
    positiveQueries: [...sample(facts, 24), ...sample(clues, 24)],
    editTargets: facts.filter(fact => fact.ordinal % 2 === 0).slice(0, 30),
    naturalQueries: sample(facts, 12).map((fact, position) => ({
      id: `natural-${position + 1}`, query: `${fact.actor} ${fact.recipient} ${fact.location} 封存 交给`,
      throughChapterId: fact.throughChapterId,
      relevantChapterIds: facts.filter(candidate => candidate.ordinal <= Math.min(options.chapters, fact.ordinal + Math.floor(options.chapters / 3))
        && candidate.actor === fact.actor && candidate.recipient === fact.recipient && candidate.location === fact.location).map(candidate => candidate.chapterId),
    })),
    negativeQueries: ['超导量子比特', '裂变反应堆', '轨道跃迁引擎', '纳米晶体芯片', '氘氚聚变', '光子纠缠态', '磁约束装置', 'STRESSNOANSWERXYZ'],
  }
}

function operationTitle(ordinal: number): string {
  return actions[(ordinal - 1) % actions.length]!
}
