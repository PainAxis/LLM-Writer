/**
 * 构建依赖图回归：检查真实 chunk 的静态 import 和模块来源，而非文件名/HTML 标签。
 * 在内存中执行生产构建，不覆盖 dist。运行：node --import tsx scripts/smoke-bundle.ts
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build, type Rolldown } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const normalize = (id: string) => id.replaceAll('\\', '/')
let chunks = new Map<string, Rolldown.OutputChunk>()

await build({
  root,
  logLevel: 'warn',
  build: { write: false },
  plugins: [{
    name: 'inspect-initial-bundle',
    generateBundle(_options, bundle) {
      chunks = new Map(Object.values(bundle)
        .filter((item): item is Rolldown.OutputChunk => item.type === 'chunk')
        .map((chunk) => [chunk.fileName, chunk]))
    },
  }],
})

function findEntry(source: string): Rolldown.OutputChunk {
  const chunk = [...chunks.values()].find((item) =>
    item.facadeModuleId && normalize(item.facadeModuleId) === normalize(`${root}${source}`))
  assert.ok(chunk, `缺少构建入口：${source}`)
  return chunk
}

function reachable(roots: Rolldown.OutputChunk[], includeDynamic = false): Set<string> {
  const visited = new Set<string>()
  const pending = roots.map((chunk) => chunk.fileName)
  while (pending.length) {
    const fileName = pending.pop()!
    if (visited.has(fileName)) continue
    const chunk = chunks.get(fileName)
    assert.ok(chunk, `构建依赖缺失：${fileName}`)
    visited.add(fileName)
    pending.push(...chunk.imports)
    if (includeDynamic) pending.push(...chunk.dynamicImports)
  }
  return visited
}

function modulesIn(files: Set<string>): string[] {
  return [...files].flatMap((fileName) => Object.keys(chunks.get(fileName)!.modules).map(normalize))
}

const features = [
  { label: '编辑器', pattern: /\/node_modules\/@wangeditor\// },
  { label: 'AI SDK', pattern: /\/node_modules\/(?:ai\/|@ai-sdk\/)/ },
  { label: '导图库', pattern: /\/node_modules\/(?:mind-elixir\/|@mind-elixir\/)/ },
  { label: 'Mammoth DOCX 解析器', pattern: /\/node_modules\/mammoth\// },
]
const entry = findEntry('index.html')
const initial = reachable([entry])
// Vue Router 会立刻加载首页路由，首屏检查也必须覆盖它的全部静态依赖。
const home = reachable([entry, findEntry('src/views/HomePage.vue')])
const all = reachable([entry], true)
const initialModules = modulesIn(home)
const allModules = modulesIn(all)

for (const { label, pattern } of features) {
  assert.ok(allModules.some((id) => pattern.test(id)), `${label}必须仍可通过动态入口访问`)
  assert.deepEqual(initialModules.filter((id) => pattern.test(id)), [], `首页不应静态加载${label}`)
  console.log(`✓ 首页依赖图不含${label}，动态功能仍保留`)
}

const writer = reachable([findEntry('src/views/Writer.vue')])
const writerEditor = findEntry('src/components/writer/WriterEditor.vue')
assert.deepEqual(modulesIn(writer).filter((id) => features[0].pattern.test(id)), [],
  '写作页应通过异步组件加载编辑器，不应将其纳入静态依赖')
assert.ok(!writer.has(writerEditor.fileName), 'WriterEditor 必须独立异步加载')
assert.ok([...writer].some((fileName) => chunks.get(fileName)!.dynamicImports.includes(writerEditor.fileName)),
  '写作页必须保留直接加载 WriterEditor 的动态入口')
assert.ok(modulesIn(reachable([writerEditor])).some((id) => features[0].pattern.test(id)),
  'WriterEditor 必须仍能加载编辑器')
console.log('✓ 写作页静态依赖不含编辑器，WriterEditor 动态入口完整')

const bookAnalysis = reachable([findEntry('src/views/BookAnalysis.vue')])
const mammoth = [...chunks.values()].find((chunk) => Object.keys(chunk.modules)
  .some((id) => features[3].pattern.test(normalize(id))))
assert.ok(mammoth, 'DOCX 解析器必须保留在构建产物中')
assert.deepEqual(modulesIn(bookAnalysis).filter((id) => features[3].pattern.test(id)), [],
  '拆书页不应静态加载 DOCX 解析器')
assert.ok([...bookAnalysis].some((fileName) => chunks.get(fileName)!.dynamicImports.includes(mammoth.fileName)),
  '拆书页必须保留 DOCX 导入时动态加载 Mammoth 的入口')
console.log('✓ 拆书页静态依赖不含 Mammoth，DOCX 动态入口完整')

assert.ok(modulesIn(reachable([findEntry('src/views/MindMap.vue')], true))
  .some((id) => features[2].pattern.test(id)), '导图页必须仍能加载导图库')
console.log('✓ 导图页功能依赖完整')

function gzipSize(files: Set<string>): number {
  return [...files].reduce((total, fileName) => total + gzipSync(chunks.get(fileName)!.code).length, 0)
}

console.log(`入口静态 JS：${gzipSize(initial).toLocaleString('en-US')} bytes gzip`)
console.log(`含首页路由 JS：${gzipSize(home).toLocaleString('en-US')} bytes gzip`)
console.log(`写作页静态 JS：${gzipSize(writer).toLocaleString('en-US')} bytes gzip`)
console.log(`编辑器异步 JS：${gzipSize(new Set([...reachable([writerEditor])].filter((fileName) => !writer.has(fileName)))).toLocaleString('en-US')} bytes gzip`)
console.log('构建依赖图回归通过')
