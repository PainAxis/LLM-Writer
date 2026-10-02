import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { ref } from 'vue'
import { createWritingGoalsState } from '../src/stores/writingGoals'

function method(file: string, name: string, dependencies: Record<string, unknown>) {
  const text = readFileSync(new URL(`../src/views/${file}.vue`, import.meta.url), 'utf8')
  const script = text.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)![1]
  const source = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = source.statements.filter(ts.isVariableStatement)
    .flatMap(s => [...s.declarationList.declarations])
    .find(d => ts.isIdentifier(d.name) && d.name.text === name)
  assert.ok(declaration, `${file} exposes the actual handler`)
  const code = ts.transpileModule(`const ${declaration.getText(source)}; return ${name}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies))
}
const history = [{ id: 2, date: '2026-09-01', increment: 25, note: 'Keep me' }]
const existing = { id: 1, title: 'Original', currentValue: 25, status: 'paused', progressHistory: history, extension: 'retained' }
let saves = 0
const goalsStore = createWritingGoalsState({ read: () => [existing], write: () => { saves++ } })
const goals = goalsStore.goals
const saveGoal = method('WritingGoals', 'saveGoal', {
  formRef: ref({ validate: async () => true }),
  goalForm: ref({ title: 'Edited', type: 'daily', targetValue: 100, dateRange: [new Date(), new Date()] }),
  goalsStore, editingGoal: ref(existing),
  showCreateDialog: ref(true), resetForm() {}, ElMessage: { success() {}, error(message: string) { throw new Error(message) } },
})
await saveGoal()
assert.equal(goals.value[0].title, 'Edited')
assert.equal(goals.value[0].currentValue, 25)
assert.equal(goals.value[0].status, 'paused')
assert.deepEqual(goals.value[0].progressHistory, history)
assert.equal(goals.value[0].extension, 'retained')
assert.equal(saves, 1)
const validate = method('PromptsLibrary', 'validatePromptItem', { categories: ref([{ key: 'all' }, { key: 'outline' }]) })
for (const input of [null, [], 1, { title: 42 }, { title: 'x', category: 'outline', description: 'd', content: 'c', tags: [1] }]) {
  assert.equal(validate(input, 0).valid, false)
}
assert.equal(validate({ title: ' x ', category: 'outline', description: 'd', content: 'c', tags: ['tag'] }, 0).prompt.title, 'x')
console.log('Legacy view data smoke passed')
