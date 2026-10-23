import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export const html = text => `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br/>')}</p>`
export const hash = text => createHash('sha256').update(text).digest('hex')
const stamp = '2026-10-23T00:00:00.000Z'
export function writerAgentProfile(frozen, kind = 'small') {
  const fixture = frozen.fixtures, a = fixture.novelA, b = fixture.novelB
  let chapters = a.chapters.map(chapter => ({ ...chapter, html: html(chapter.text) }))
  let targetId = a.targetChapterId, anchorId = fixture.anchorSelection.choose.chapterId, anchorText = fixture.anchorSelection.choose.quote
  if (kind === 'large') {
    const recipe = fixture.largeBrowserRecipe
    chapters = Array.from({ length: recipe.chapterCount }, (_, index) => {
      const ordinal = index + 1, prefix = recipe.overrides[String(ordinal)] ?? ''
      const text = (prefix + recipe.fillerUnit.repeat(Math.ceil(recipe.chapterCharsUtf16 / recipe.fillerUnit.length))).slice(0, recipe.chapterCharsUtf16)
      assert.equal(text.length, recipe.chapterCharsUtf16)
      return { id: String(940000 + ordinal), title: `${recipe.titlePrefix}${ordinal}`, text, html: html(text) }
    })
    assert.equal(chapters.reduce((sum, chapter) => sum + chapter.text.length, 0), recipe.totalCharsUtf16)
    targetId = chapters[recipe.targetOrdinal - 1].id; anchorId = chapters[recipe.anchorSelection.chapterOrdinal - 1].id
    anchorText = recipe.anchorSelection.quoteContains
  } else if (kind === 'literal') {
    chapters[1] = { ...chapters[1], text: fixture.literalEntity.normalizedOnce, html: fixture.literalEntity.savedHtml }
    anchorText = fixture.literalEntity.normalizedOnce
  } else if (kind === 'legacy-entity') {
    chapters[1] = { ...chapters[1], text: fixture.literalEntity.plainLegacyText, html: fixture.literalEntity.plainLegacyText }
    anchorText = fixture.literalEntity.plainLegacyText
  } else if (kind === 'source-instruction') {
    anchorId = chapters[2].id; anchorText = chapters[2].text
  }
  const novel = (source, sourceChapters) => ({ id: Number(source.id), title: source.title, genre: 'fantasy', description: fixture.canaries.outline,
    tags: [], status: 'writing', createdAt: stamp, updatedAt: stamp, chapters: sourceChapters.length,
    wordCount: sourceChapters.reduce((sum, chapter) => sum + chapter.text.length, 0),
    characters: [{ id: 950001, name: '合成角色', description: fixture.canaries.alias }], worldSettings: [], events: [],
    corpusData: [{ id: 950002, title: '合成素材', content: fixture.canaries.material, category: '合成' }],
    chapterList: sourceChapters.map(chapter => ({ id: Number(chapter.id), title: chapter.title, content: chapter.html ?? html(chapter.text), description: fixture.canaries.outline,
      status: 'draft', tags: [], wordCount: chapter.text.length, createdAt: stamp, updatedAt: stamp })) })
  return { kind, novelId: Number(a.id), projectId: `novel:${a.id}`, targetId, target: chapters.find(chapter => chapter.id === targetId), anchorId, anchorText, chapters,
    novels: [novel(a, chapters), novel(b, b.chapters)],
    totalChars: chapters.reduce((sum, chapter) => sum + chapter.text.length, 0),
    sourceHash: hash(JSON.stringify(chapters.map(({ id, title, text }) => ({ id, title, text })))),
  }
}
