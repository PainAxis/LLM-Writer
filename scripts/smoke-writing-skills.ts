import assert from 'node:assert/strict'
import {
  BUILTIN_WRITING_SKILLS,
  SKILL_CONTEXT_MAX_CHARS,
  SKILL_FILE_MAX_BYTES,
  SKILL_INSTRUCTIONS_MAX_CHARS,
  SKILL_PACKAGE_MAX_FILES,
  buildSkillCatalog,
  buildSkillContext,
  createSkillTools,
  importSkillPackage,
  normalizeSkillPath,
  normalizeWritingSkill,
  parseSkillPackage,
  readSkillReference,
} from '../src/services/skills'
import type { SkillPackageFile } from '../src/types/skills'

const definition = (body = 'Use the selected writing process.') => `---
name: writing-check
description: >-
  Review narrative continuity:
  track character knowledge and facts.
metadata:
  author: "Writer: Test"
  version: '1'
custom:
  modes: [review, draft]
allowed-tools: "Read"
---
${body}`

const packageFiles: SkillPackageFile[] = [
  { path: 'writing-check/SKILL.md', content: definition() },
  { path: 'writing-check/references/checklist.md', content: 'REFERENCE BODY MUST LOAD ONLY ON DEMAND' },
  { path: 'writing-check/assets/template.json', content: '{"scene":"test"}' },
  { path: 'writing-check/scripts/check.py', content: 'raise RuntimeError("never execute")' },
]

const skill = parseSkillPackage(packageFiles)
assert.equal(skill.id, 'imported:writing-check')
assert.equal(skill.description, 'Review narrative continuity: track character knowledge and facts.')
assert.deepEqual(skill.metadata.custom, { modes: ['review', 'draft'] })
assert.deepEqual(skill.metadata.metadata, { author: 'Writer: Test', version: '1' })
assert.equal(skill.packageName, 'writing-check')
assert.ok(skill.warnings.some(warning => warning.includes('脚本')))
assert.ok(skill.warnings.some(warning => warning.includes('allowed-tools')))
assert.equal(skill.files[1]!.path, 'references/checklist.md')
assert.equal(skill.files[3]!.kind, 'script')
assert.deepEqual(normalizeWritingSkill(JSON.parse(JSON.stringify(skill))), skill)
assert.throws(() => normalizeWritingSkill({ ...skill, instructions: 'tampered' }), /不一致/)
assert.throws(() => normalizeWritingSkill({ ...skill, source: 'mcp' }), /来源无效/)
assert.throws(() => parseSkillPackage(packageFiles, { existingSkills: BUILTIN_WRITING_SKILLS.concat(skill) }), /已存在/)
assert.throws(() => parseSkillPackage(packageFiles, { existingSkills: [{ id: 'builtin:writing-check', name: 'writing-check' }] }), /已存在/)

// Match the public Humanizer-zh package's frontmatter shape without rewriting its YAML list.
const humanizerDefinition = `---
name: humanizer-zh
description: 编辑中文文本，保留事实和作者声音。
allowed-tools:
  - Read
  - Write
  - Edit
  - AskUserQuestion
metadata:
  trigger: 编辑或审阅中文文本
  revision: "2026-09-23"
---
Revise only the supplied text and preserve its meaning.`
const humanizer = await importSkillPackage([new File([humanizerDefinition], 'SKILL.md')])
assert.deepEqual(humanizer.metadata['allowed-tools'], ['Read', 'Write', 'Edit', 'AskUserQuestion'])
assert.ok(humanizer.warnings.some(warning => warning.includes('工具权限由应用设置控制')))
assert.deepEqual(normalizeWritingSkill(JSON.parse(JSON.stringify(humanizer))), humanizer)
assert.deepEqual(await createSkillTools([humanizer]), {}, 'Metadata must not grant Read/Write/Edit/AskUserQuestion tools')
const humanizerWithReference = parseSkillPackage([
  { path: 'SKILL.md', content: humanizerDefinition },
  { path: 'README.md', content: 'Optional reference' },
])
assert.deepEqual(Object.keys(await createSkillTools([humanizerWithReference])), ['writing_skill_read_reference'])
for (const allowedTools of [null, true, 42, {}, [], ['Read', 42], ['Read', {}], [''], ['  '], Array(65).fill('Read'), ['x'.repeat(257)]]) {
  const malformed = definition().replace('allowed-tools: "Read"', `allowed-tools: ${JSON.stringify(allowedTools)}`)
  assert.throws(() => parseSkillPackage([{ path: 'SKILL.md', content: malformed }]), /allowed-tools/)
}

for (const name of ['WRITING', '-writing', 'writing-', 'writing--check', 'a'.repeat(65)]) {
  assert.throws(() => parseSkillPackage([{ path: 'SKILL.md', content: definition().replace('name: writing-check', `name: ${name}`) }]), /name/)
}
assert.throws(() => parseSkillPackage([{ path: 'SKILL.md', content: definition().replace('name: writing-check', 'name: writing-check\nname: other') }]), /YAML 无效/)
assert.throws(() => parseSkillPackage([{ path: 'SKILL.md', content: 'missing frontmatter' }]), /frontmatter/)
assert.throws(() => parseSkillPackage([{ path: 'SKILL.md', content: '---\nname: check\ndescription: ""\n---\nInstructions' }]), /description/)
assert.throws(() => parseSkillPackage([{ path: 'SKILL.md', content: '---\nname: check\ndescription: Check\nmetadata:\n  version: 1\n---\nInstructions' }]), /metadata/)
assert.throws(() => parseSkillPackage([{ path: 'SKILL.md', content: definition('') }]), /指令正文/)
assert.throws(() => parseSkillPackage([{ path: 'SKILL.md', content: definition('x'.repeat(SKILL_INSTRUCTIONS_MAX_CHARS + 1)) }]), /指令正文超过/)
assert.throws(() => parseSkillPackage([{ path: 'SKILL.md', content: definition() }, { path: 'SKILL.md', content: definition() }]), /重复文件/)
assert.throws(() => parseSkillPackage([...packageFiles, { path: 'other/SKILL.md', content: definition() }]), /仅包含一个/)
assert.throws(() => parseSkillPackage([...packageFiles, { path: 'outside.txt', content: 'out of package' }]), /同一个/)
assert.throws(() => parseSkillPackage([...packageFiles, { path: 'writing-check/references/huge.txt', content: 'x'.repeat(SKILL_FILE_MAX_BYTES + 1) }]), /256 KiB/)
assert.throws(() => parseSkillPackage(Array.from({ length: SKILL_PACKAGE_MAX_FILES + 1 }, (_, i) => ({ path: `${i}.md`, content: 'x' }))), /文本文件/)
assert.throws(() => parseSkillPackage([{ path: 'SKILL.md', content: definition() }, ...Array.from({ length: 5 }, (_, i) => ({ path: `references/${i}.md`, content: 'x'.repeat(SKILL_FILE_MAX_BYTES) }))]), /1 MiB/)
for (const path of ['../secret', 'references/../secret', '/secret', 'C:\\secret', 'https://host/file', 'references/%2e%2e/file', 'references//file', 'references/./file']) {
  assert.throws(() => normalizeSkillPath(path), /路径/)
}
assert.throws(() => readSkillReference(skill, 'scripts/check.py'), /不可读取/)
assert.throws(() => readSkillReference(skill, 'SKILL.md'), /不可读取/)
assert.throws(() => readSkillReference(skill, '../secrets.md'), /路径/)
assert.throws(() => readSkillReference(skill, 'references/checklist.md', { offset: -1 }), /范围/)
assert.throws(() => readSkillReference(skill, 'references/checklist.md', { maxChars: 8001 }), /范围/)

const catalog = buildSkillCatalog([skill])
assert.ok(catalog.includes(skill.description))
assert.ok(!catalog.includes(skill.instructions))
assert.ok(!catalog.includes('REFERENCE BODY'))
assert.equal(buildSkillCatalog([]), '')
const context = buildSkillContext([skill])
assert.ok(context.text.includes(skill.instructions))
assert.ok(context.text.includes('references/checklist.md'))
assert.ok(!context.text.includes('REFERENCE BODY'))
assert.ok(!context.text.includes('check.py'))
assert.deepEqual(context.usedSkillIds, [skill.id])
assert.equal(context.truncated, false)
assert.throws(() => buildSkillContext([skill], 100), /指令未被截断/)
assert.throws(() => buildSkillContext([skill, skill]), /重复选择/)
assert.throws(() => buildSkillContext([skill], { maxChars: SKILL_CONTEXT_MAX_CHARS + 1 }), /上下文预算/)
const withReference = buildSkillContext([skill], { referenceSelections: [{ skillId: skill.id, path: 'references/checklist.md' }] })
assert.ok(withReference.text.includes('REFERENCE BODY'))
assert.throws(() => buildSkillContext([skill], { referenceSelections: [{ skillId: 'not-selected', path: 'references/checklist.md' }] }), /明确启用/)
const omittedReference = buildSkillContext([skill], { maxChars: context.text.length, referenceSelections: [{ skillId: skill.id, path: 'references/checklist.md' }] })
assert.equal(omittedReference.truncated, true)
assert.equal(omittedReference.text, context.text)

const paged = readSkillReference(skill, 'references/checklist.md', { maxChars: 9 })
assert.equal(paged.text, 'REFERENCE')
assert.equal(paged.nextOffset, 9)
assert.equal(paged.truncated, true)
const nextPage = readSkillReference(skill, 'references/checklist.md', { offset: paged.nextOffset })
assert.equal(paged.text + nextPage.text, skill.files[1]!.content)

assert.equal(BUILTIN_WRITING_SKILLS.length, 4)
assert.equal(new Set(BUILTIN_WRITING_SKILLS.map(item => item.id)).size, 4)
assert.ok(BUILTIN_WRITING_SKILLS.every(item => item.source === 'builtin' && item.files.some(file => file.kind === 'reference')))
assert.deepEqual(buildSkillContext([]), { text: '', usedSkillIds: [], omittedSkillIds: [], truncated: false })

const selectedTools = await createSkillTools([skill])
assert.deepEqual(Object.keys(selectedTools), ['writing_skill_read_reference'])
const readTool = selectedTools.writing_skill_read_reference!
assert.ok(readTool.execute)
const toolOptions = { toolCallId: 'skill-reference-1', messages: [] }
const result = await readTool.execute!({ skillId: skill.id, path: 'references/checklist.md' }, toolOptions)
assert.equal((result as { text: string }).text, skill.files[1]!.content)
await assert.rejects(async () => readTool.execute!({ skillId: 'imported:other', path: 'references/checklist.md' }, toolOptions), /明确启用/)
await assert.rejects(async () => readTool.execute!({ skillId: skill.id, path: 'scripts/check.py' }, toolOptions), /不可读取/)
const controller = new AbortController()
controller.abort(new Error('cancelled'))
await assert.rejects(async () => readTool.execute!({ skillId: skill.id, path: 'references/checklist.md' }, { ...toolOptions, abortSignal: controller.signal }), /cancelled/)
assert.deepEqual(await createSkillTools([]), {})

const browserFile = new File([definition()], 'SKILL.md', { type: 'text/markdown' })
const imported = await importSkillPackage([browserFile])
assert.equal(imported.name, skill.name)
const folderFiles = packageFiles.map(item => {
  const file = new File([item.content], item.path.split('/').at(-1)!)
  Object.defineProperty(file, 'webkitRelativePath', { value: item.path })
  return file
})
assert.deepEqual(await importSkillPackage(folderFiles), skill)
await assert.rejects(importSkillPackage([new File(['binary'], 'image.png')]), /只支持文本文件/)

console.log('Agent Skills smoke passed: YAML imports, package boundaries, progressive loading, bounded reference tools, built-ins, and cancellation.')
