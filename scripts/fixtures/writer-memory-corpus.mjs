/** Independent, wholly synthetic manuscript for Writer memory browser acceptance. */
import { createHash } from 'node:crypto'

export const writerMemoryNovelId = 59400
export const writerMemoryProjectId = `novel:${writerMemoryNovelId}`
export const chapterIdAt = ordinal => 59400 + ordinal
export const chapterTitleAt = ordinal => `第${String(ordinal).padStart(2, '0')}章：${ordinal === 1 ? '旧仓库' : ordinal === 2 ? '窗边铜铃' : ordinal === 39 ? '久别归来' : ordinal === 40 ? '雨中桥头' : ordinal === 80 ? '终局揭晓' : '沿河行记'}`
export const originalOldFact = '青岚把银钥匙交给沈砚，嘱咐沈砚保管到天亮，再用它打开旧仓库。'
export const revisedOldFact = '青岚把铜钥匙交给沈砚，嘱咐沈砚保管到天亮，再用它打开旧仓库。'
export const distantClue = '沈砚把一枚缺角的铜铃系在窗边，嘱咐阿宁听见三声铃响就去西渡口。'
export const laterPremise = '沈砚多年后重回河畔，仍记得铜铃和阿宁留下的接应约定。'
export const currentWritingText = '雨点落在桥头，沈砚望着两岸的灯火，思索如何与旧友重新取得联系。'
export const futureIdentity = '终局才揭晓：玄衣客的真名是顾行。密藏暗号是FUTURE-SECRET-59480，此前无人知晓。'
export const stamp = '2026-10-09T00:00:00.000Z'
export const fixtureTexts = new Map(Array.from({ length: 80 }, (_, index) => {
  const ordinal = index + 1
  const text = ordinal === 1 ? originalOldFact : ordinal === 2 ? distantClue : ordinal === 39 ? laterPremise : ordinal === 40 ? currentWritingText : ordinal === 80 ? futureIdentity : `第${ordinal}日，行人经过第${ordinal}座驿站，记下河岸的风向与沿途见闻。村民整理绳索与行囊，等待雨停后重新出发。`
  return [ordinal, text]
}))
export function fixtureRevision(ordinal, text = fixtureTexts.get(ordinal)) {
  return createHash('sha256').update(JSON.stringify([chapterTitleAt(ordinal), text])).digest('hex')
}
const anchor = ordinal => ({
  chapterId: String(chapterIdAt(ordinal)), sourceRevision: fixtureRevision(ordinal),
  start: 0, end: fixtureTexts.get(ordinal).length, quote: fixtureTexts.get(ordinal),
})
export function makeWriterMemoryNovel() {
  return {
    id: writerMemoryNovelId, title: '八十章写作记忆验收作品', genre: 'fantasy', description: '沿河寻找旧友的合成测试故事。',
    tags: [], status: 'writing', createdAt: stamp, updatedAt: stamp, chapters: 80,
    wordCount: [...fixtureTexts.values()].join('').length, totalWords: [...fixtureTexts.values()].join('').length,
    characters: [], worldSettings: [], events: [], corpusData: [],
    chapterList: [...fixtureTexts].map(([ordinal, text]) => ({
      id: chapterIdAt(ordinal), title: chapterTitleAt(ordinal), content: `<p>${text}</p>`,
      description: ordinal === 40 ? '主角在桥头回想早年约定，尝试寻找接应自己的旧友。' : '',
      status: 'draft', tags: [], wordCount: text.length, createdAt: stamp, updatedAt: stamp,
    })),
  }
}
export function makeWriterMemoryGraph() {
  const relation = (id, source, target, predicate, evidence, extra = {}) => ({
    id, projectId: writerMemoryProjectId, source, target, predicate,
    origin: 'explicit', createdBy: 'author', authorConfirmed: true, evidence, ...extra,
  })
  return {
    version: 1, projectId: writerMemoryProjectId, revision: 'fixture-writer-memory-graph-v1',
    relations: [
      relation('old-key', { type: 'person', label: '青岚' }, { type: 'object', label: '银钥匙' }, '交付保管；玄衣客的真名是顾行；FUTURE-SECRET-59480', [anchor(1)]),
      relation('bell-dock', { type: 'object', label: '铜铃' }, { type: 'place', label: '西渡口' }, '三声铃响指向接应地点', [anchor(2)]),
      relation('bell-inference', { type: 'person', label: '沈砚' }, { type: 'place', label: '西渡口' }, '可能按旧日约定前往接应地点', [anchor(2), anchor(39)], { origin: 'inferred', createdBy: 'model' }),
      relation('future-identity', { type: 'person', label: '玄衣客' }, { type: 'person', label: '顾行' }, '终局真名是', [anchor(80)]),
    ],
  }
}
export function makeWriterMemoryBackup(apiBaseURL) {
  return {
    format: 'llm-writer-backup', version: 2, exportTime: stamp,
    data: {
      novels: [makeWriterMemoryNovel()], factGraphs: [makeWriterMemoryGraph()],
      apiConfig: {
        apiKey: 'synthetic-writer-memory-key', baseURL: apiBaseURL, provider: 'custom',
        selectedModel: 'writer-memory-fixture', maxTokens: 2048, unlimitedTokens: false,
        temperature: 0, thinkingProtocol: 'auto', thinkingMode: 'default', customHeaders: {},
      },
    },
  }
}

/** A large collection uses the same five short, exact source chapters and graph. */
export function makeLongWriterMemoryFixture(apiBaseURL) {
  const backup = makeWriterMemoryBackup(apiBaseURL)
  const novel = backup.data.novels[0]
  const special = new Set([1, 2, 39, 40, 80])
  // Keep every original chapter ID/title/anchor stable while postponing the
  // original chapter 80 revelation until narrative ordinal 600. The 520 new
  // filler chapters precede it, so target ID 600 is narrative ordinal 599.
  const order = [...Array.from({ length: 79 }, (_, index) => index + 1), ...Array.from({ length: 520 }, (_, index) => index + 81), 80]
  const texts = new Map(order.map(ordinal => {
    const seed = `第${ordinal}日，行人在第${ordinal}座驿站停留，记录沿途山川草木和炊烟的方向。村民晾晒绳索、整备行囊，计划天气放晴后沿河继续赶路。`
    return [ordinal, special.has(ordinal) ? fixtureTexts.get(ordinal) : seed.repeat(Math.ceil(2400 / seed.length)).slice(0, 2400)]
  }))
  novel.chapterList = [...texts].map(([ordinal, text]) => ({
    id: chapterIdAt(ordinal), title: chapterTitleAt(ordinal), content: `<p>${text}</p>`,
    description: ordinal === 40 ? '主角在桥头回想早年约定，尝试寻找接应自己的旧友。' : '',
    status: 'draft', tags: [], wordCount: text.length, createdAt: stamp, updatedAt: stamp,
  }))
  novel.chapters = 600
  novel.wordCount = novel.totalWords = [...texts.values()].reduce((total, text) => total + text.length, 0)
  return { backup, texts, manifest: {
    chapters: novel.chapterList.length, sourceChars: novel.wordCount,
    serializedNovelChars: JSON.stringify(backup.data.novels).length,
    expectedSplitChapters: novel.chapterList.filter(chapter => chapter.content.length > 2000).length,
    targetSourceChapterNumber: 600, targetChapterId: chapterIdAt(600),
    futureChapterId: chapterIdAt(80), futureNarrativeOrdinal: 600,
    disclosedChapters: 599, disclosedChars: [...texts.values()].slice(0, 599).reduce((total, text) => total + text.length, 0),
  } }
}
