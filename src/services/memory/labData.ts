import type { MemoryProjectInput, MemoryClue } from '../../types/memory'
import { idbGet, idbSet } from '../blobStore'
import { StorageKeys, storageReadCommitted } from '../../utils/storage'
import { stripWriterHtml } from '../../utils/writerContent'
import { chapterRevision } from './revision'

const DEMO_KEY = 'memory-prototype:v1:demo'

export async function createMemoryDemo(): Promise<MemoryProjectInput> {
  const chapters = Array.from({ length: 80 }, (_, index) => ({
    id: `c${index + 1}`, title: `第${index + 1}章 · 行路`,
    text: `第${index + 1}日，沈砚沿河赶路，在驿站记下沿途的天气。阿宁买来干粮，两人商量下一程的住处。`,
  }))
  chapters[0] = {
    id: 'c1', title: '第1章 · 托付',
    text: '雨落在渡口的石阶上。\n\n顾行将银钥匙交给沈砚，嘱咐他保管到天亮。沈砚把钥匙收进贴身的布袋，没有交给旁人。',
  }
  chapters[1] = {
    id: 'c2', title: '第2章 · 窗边',
    text: '阿宁推开客栈的木窗。\n\n沈砚把一枚缺角的铜铃系在窗边，嘱咐阿宁听见三声铃响就去西渡口。阿宁点头，把铃绳藏在帘后。',
  }
  chapters[39] = {
    id: 'c40', title: '第40章 · 重逢',
    text: '沈砚和阿宁在城外重逢。他们需要约定接应的办法，却不愿让街上的守卫听见谈话。',
  }
  chapters[79] = {
    id: 'c80', title: '第80章 · 揭晓',
    text: '暗室的门终于打开。玄衣客摘下面具：玄衣客的真名是顾行。这个身份直到此刻才向众人揭晓。',
  }
  const quote = '沈砚把一枚缺角的铜铃系在窗边，嘱咐阿宁听见三声铃响就去西渡口。'
  const start = chapters[1]!.text.indexOf(quote)
  const clue: MemoryClue = {
    id: 'clue-bell', chapterId: 'c2', sourceRevision: await chapterRevision(chapters[1]!),
    start, end: start + quote.length, quote, label: '铜铃暗号', aliases: ['接应信号', '旧日约定'],
  }
  return { id: 'memory-demo', title: '渡口旧约 · 检索示例', chapters, clues: [clue] }
}

/** A private lab copy. Never writes the novels store or existing chapter content. */
export async function readMemoryDemo(): Promise<MemoryProjectInput> {
  const raw = await idbGet(DEMO_KEY)
  if (raw === null) return createMemoryDemo()
  let value: MemoryProjectInput
  try { value = JSON.parse(raw) as MemoryProjectInput } catch { throw new Error('示例数据损坏；原数据保留，可使用“重置示例”重新开始') }
  if (!value || value.id !== 'memory-demo' || typeof value.title !== 'string'
    || !Array.isArray(value.chapters) || !Array.isArray(value.clues)
    || value.chapters.some(chapter => !chapter || typeof chapter.id !== 'string'
      || typeof chapter.title !== 'string' || typeof chapter.text !== 'string')) {
    throw new Error('示例数据格式无效；原数据保留，可使用“重置示例”重新开始')
  }
  return value
}

export async function saveMemoryDemo(project: MemoryProjectInput): Promise<void> {
  if (project.id !== 'memory-demo') throw new Error('只能在原型中保存示例作品')
  await idbSet(DEMO_KEY, JSON.stringify(project))
}

interface NovelSource {
  id: number | string
  title?: string
  chapterList?: Array<{ id: number | string; title?: string; content?: string; contentRef?: string }>
}

async function committedNovels(): Promise<NovelSource[]> {
  const novels = await storageReadCommitted(StorageKeys.novels)
  if (novels === null) return []
  if (!Array.isArray(novels)) throw new Error('已保存的小说列表格式无效')
  return novels.filter((novel): novel is NovelSource => !!novel && typeof novel === 'object'
    && (typeof novel.id === 'string' || typeof novel.id === 'number'))
}

export async function readMemoryNovelChoices(): Promise<Array<{ id: string; title: string }>> {
  return (await committedNovels()).map(novel => ({ id: `novel:${novel.id}`, title: novel.title || '未命名作品' }))
}

export async function readMemoryNovel(id: string): Promise<MemoryProjectInput> {
  const novel = (await committedNovels()).find(item => `novel:${item.id}` === id)
  if (!novel) throw new Error('作品已删除或不可读取，请重新选择作品')
  if (!Array.isArray(novel.chapterList)) throw new Error('作品尚无可检索的章节')
  return {
    id, title: novel.title || '未命名作品', clues: [],
    chapters: novel.chapterList.map(chapter => {
      if (chapter.contentRef && typeof chapter.content !== 'string') throw new Error('章节正文尚未读取完整，请稍后重试')
      return { id: String(chapter.id), title: chapter.title || '未命名章节', text: stripWriterHtml(chapter.content || '') }
    }),
  }
}
