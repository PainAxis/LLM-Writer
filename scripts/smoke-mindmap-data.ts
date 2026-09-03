/**
 * 思维导图数据派生冒烟测试（无需浏览器）：
 * 覆盖 根节点/章节事件挂载/孤儿事件/人物角色/世界观/语料分类/空数据/文本截断。
 * 运行：npx tsx scripts/smoke-mindmap-data.ts
 */
import assert from 'node:assert'
import { buildMindMapData, resetMindMapIdSeq, type MindMapNode } from '../src/utils/mindmapData'

const novel = {
  title: '剑起青云',
  genre: '玄幻',
  chapterList: [
    { id: 1, title: '初入宗门', description: '凌云拜入青云宗，结识师兄，发现神秘玉佩' },
    { id: 2, title: '剑冢奇遇', description: '' },
  ],
  characters: [
    { id: 1, name: '凌云', role: 'protagonist', personality: '坚韧不拔，重情重义，天赋异禀但身世成谜' },
    { id: 2, name: '神秘老者', role: 'supporting' },
  ],
  worldSettings: [{ title: '修炼体系', description: '炼气、筑基、金丹……' }],
  events: [
    { title: '获得玉佩', description: '玉佩认主', chapter: '1', characterIds: [1] },
    { title: '拜师', chapter: '1' },
    { title: '误入剑冢', chapter: '9' },
  ],
  corpusData: [
    { id: 1, title: '听雨剑法', category: '武学' },
    { id: 2, title: '青云山景', category: '场景' },
    { id: 3, title: '无分类语料' },
  ],
}

function findNode(root: MindMapNode, prefix: string): MindMapNode | undefined {
  const stack: MindMapNode[] = [root]
  while (stack.length > 0) {
    const current = stack.pop() as MindMapNode
    if (current.topic.startsWith(prefix)) return current
    if (current.children) stack.push(...current.children)
  }
  return undefined
}

function collect(root: MindMapNode): MindMapNode[] {
  const result: MindMapNode[] = []
  const walk = (node: MindMapNode): void => {
    result.push(node)
    node.children?.forEach(walk)
  }
  walk(root)
  return result
}

resetMindMapIdSeq()
const { nodeData } = buildMindMapData(novel)

// ---- 测试 1：根节点与四大分支 ----
assert.strictEqual(nodeData.root, true, '根节点应标记 root')
assert.ok(nodeData.topic.includes('剑起青云') && nodeData.topic.includes('玄幻'), '根节点应含标题与类型')
assert.ok(findNode(nodeData, '📖 章节大纲（2 章）'), '章节分支应存在且计数正确')
assert.ok(findNode(nodeData, '👥 人物（2）'), '人物分支应存在')
assert.ok(findNode(nodeData, '🌍 世界观（1）'), '世界观分支应存在')
assert.ok(findNode(nodeData, '📚 语料（3）'), '语料分支应存在')
console.log('✓ 测试1 通过：根节点与分支结构')

// ---- 测试 2：章节节点与事件挂载（含关联角色） ----
const chapter1 = findNode(nodeData, '第1章 初入宗门')
assert.ok(chapter1, '第1章节点应存在')
assert.ok(chapter1!.topic.includes('凌云拜入青云宗'), '章节节点应含大纲摘要')
assert.strictEqual(chapter1!.children?.length, 2, '第1章应挂载 2 个事件')
const eventWithRoles = chapter1!.children?.find(node => node.topic.includes('获得玉佩'))
assert.ok(eventWithRoles?.topic.includes('参与：凌云'), '事件节点应带上关联角色名')
assert.ok(findNode(nodeData, '第2章 剑冢奇遇'), '第2章节点应存在（无事件无子节点）')
assert.ok(findNode(nodeData, '📅 未关联章节的事件'), '越界章号事件应归入孤儿分组')
assert.ok(findNode(nodeData, '📅 误入剑冢'), '孤儿事件应在分组内')
console.log('✓ 测试2 通过：章节与事件挂载')

// ---- 测试 3：人物角色映射与语料分类分组 ----
const lingyun = findNode(nodeData, '凌云（主角）')
assert.ok(lingyun, '主角节点应含角色文本映射')
assert.ok(lingyun!.topic.includes('坚韧不拔'), '人物节点应含性格摘要')
const categoryNode = findNode(nodeData, '武学（1）')
assert.ok(categoryNode, '语料应按分类分组')
assert.ok(findNode(nodeData, '未分类（1）'), '无分类语料应归入未分类')
console.log('✓ 测试3 通过：角色映射与语料分组')

// ---- 测试 4：文本截断与空数据 ----
const longNovel = {
  title: '测试',
  chapterList: [{ title: '章节', description: '长'.repeat(200) }],
  characters: [{ name: '甲', personality: '长'.repeat(200) }],
}
const longMap = buildMindMapData(longNovel)
const longChapter = findNode(longMap.nodeData, '第1章 章节')
assert.ok((longChapter!.topic.length as number) < 120, '章节摘要应被截断')
const allNodes = collect(longMap.nodeData)
const ids = new Set(allNodes.map(node => node.id))
assert.strictEqual(ids.size, allNodes.length, '节点 id 应唯一')
const emptyMap = buildMindMapData({})
assert.strictEqual(emptyMap.nodeData.children?.length, 0, '空小说应只有根节点')
console.log('✓ 测试4 通过：截断 / id 唯一性 / 空数据')

console.log('\n=== ALL MINDMAP-DATA TESTS PASSED ===')
