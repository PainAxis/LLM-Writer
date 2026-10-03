<template>
  <section class="extension-settings" aria-label="MCP 和写作技能设置">
    <el-alert v-if="store.loadError" :title="`扩展设置无法读取：${store.loadError}`" type="error" :closable="false">
      <el-button type="danger" size="small" @click="resetSettings">重置扩展设置</el-button>
    </el-alert>
    <div class="section-heading">
      <div><h3>MCP 与写作 Skills</h3><p>在 AI 助手中按需选择小说、技能和工具。启用后，相关内容会提供给当前模型。</p></div>
      <el-switch :model-value="store.enabled" :disabled="busy" active-text="启用扩展" @change="setEnabled" />
    </div>
    <el-button v-if="connectionBusy" class="cancel-connection" @click="controller?.abort()">取消 MCP 请求</el-button>
    <el-form label-position="top" class="budget-form">
      <el-form-item label="每次请求最多生成轮数（含工具调用和最后回复）">
        <el-input-number :model-value="store.maxSteps" :min="1" :max="12" :disabled="busy" @change="setMaxSteps" />
      </el-form-item>
    </el-form>
    <section aria-labelledby="mcp-heading">
      <div class="section-heading"><h3 id="mcp-heading">远程 MCP 服务</h3><el-button type="primary" :disabled="busy" @click="openEditor()">添加 MCP 服务</el-button></div>
      <p>支持可从浏览器访问的 HTTP MCP。服务需允许当前站点跨域访问；本地 stdio、脚本执行与自动 OAuth 登录暂未提供。访问令牌仅保留在当前页面，刷新后需重新输入。</p>
      <el-empty v-if="!store.servers.length" description="尚未添加 MCP 服务" :image-size="60" />
      <article v-for="server in store.servers" :key="server.id" class="server-card">
        <div class="section-heading">
          <div><strong>{{ server.name }}</strong><p class="server-url">{{ server.url }}</p></div>
          <div class="actions">
            <el-switch :model-value="server.enabled" :disabled="busy" :aria-label="`启用 ${server.name}`" @change="toggleServer(server, $event)" />
            <el-button :disabled="busy" @click="probe(server)">检查连接</el-button>
            <el-button :disabled="busy" @click="openEditor(server)">编辑</el-button>
            <el-button type="danger" plain :disabled="busy" @click="deleteServer(server)">删除</el-button>
          </div>
        </div>
        <p class="caption">已授权 {{ server.allowedTools.length }} 个工具 · {{ store.credentials[server.id] ? '已设置本页令牌' : '未设置访问令牌（公开服务可直接连接）' }}</p>
        <template v-if="discoveries[server.id]">
          <p class="caption">协议：{{ discoveries[server.id].protocolVersion }} <span v-if="discoveries[server.id].truncated">· 服务列表超过显示上限</span></p>
          <el-alert title="仅勾选并保存的工具会提供给模型。服务声明的只读属性仅供参考，请确认工具用途。" type="info" :closable="false" />
          <el-checkbox-group v-model="toolChoices[server.id]" :disabled="busy" class="tool-list">
            <el-checkbox v-for="tool in discoveries[server.id].tools" :key="tool.name" :value="tool.name">
              <span>{{ tool.annotations?.title || tool.name }}</span>
              <el-tag size="small" :type="tool.annotations?.readOnlyHint ? 'success' : 'warning'">{{ tool.annotations?.readOnlyHint ? '声明只读' : '可能修改外部数据' }}</el-tag>
              <span class="tool-description">{{ tool.description || '服务未提供说明' }}</span>
            </el-checkbox>
          </el-checkbox-group>
          <el-button size="small" type="primary" :disabled="busy" @click="saveAuthorization(server)">保存工具授权</el-button>
          <el-collapse class="inspector">
            <el-collapse-item :title="`资源 (${discoveries[server.id].resources.length}) · 手动预览`" name="resources">
              <div v-for="resource in discoveries[server.id].resources" :key="resource.uri" class="inspector-row"><span>{{ resource.name }}<small>{{ resource.uri }}</small></span><el-button size="small" :disabled="busy" @click="readResource(server, resource.uri)">读取资源</el-button></div>
              <p v-if="!discoveries[server.id].resources.length" class="caption">服务未提供资源</p>
            </el-collapse-item>
            <el-collapse-item :title="`提示词 (${discoveries[server.id].prompts.length}) · 手动预览`" name="prompts">
              <div v-for="prompt in discoveries[server.id].prompts" :key="prompt.name" class="prompt-row">
                <strong>{{ prompt.name }}</strong><p>{{ prompt.description }}</p>
                <label v-for="argument in prompt.arguments || []" :key="argument.name" class="prompt-argument">{{ argument.name }}{{ argument.required ? '（必填）' : '' }}<el-input :model-value="promptArguments[argumentKey(server.id, prompt.name, argument.name)] || ''" :disabled="busy" @update:model-value="promptArguments[argumentKey(server.id, prompt.name, argument.name)] = $event" /></label>
                <el-button size="small" :disabled="busy" @click="getPrompt(server, prompt)">获取提示词</el-button>
              </div>
              <p v-if="!discoveries[server.id].prompts.length" class="caption">服务未提供提示词</p>
            </el-collapse-item>
          </el-collapse>
          <p class="caption">资源和提示词在此手动预览，不会自动加入助手上下文。</p>
        </template>
      </article>
    </section>
    <section aria-labelledby="skills-heading">
      <div class="section-heading"><h3 id="skills-heading">写作 Skills</h3><div class="actions"><el-button :disabled="busy" @click="skillFileInput?.click()">导入 SKILL.md</el-button><el-button :disabled="busy" @click="skillFolderInput?.click()">导入技能文件夹</el-button></div></div>
      <p>技能包括 SKILL.md 指令和文本参考文件。参考文件按需读取；脚本仅供查看，不会执行。请先查看内容，再在助手中选用。</p>
      <input ref="skillFileInput" type="file" accept=".md" :disabled="busy" hidden @change="importFiles" />
      <input ref="skillFolderInput" type="file" multiple webkitdirectory :disabled="busy" hidden @change="importFiles" />
      <article v-for="skill in store.skills" :key="skill.id" class="skill-card">
        <div><strong>{{ skill.name }}</strong> <el-tag size="small">{{ skill.source === 'builtin' ? '内置' : '导入' }}</el-tag><p>{{ skill.description }}</p><p v-if="skill.warnings.length" class="caption">{{ skill.warnings.join('；') }}</p></div>
        <div class="actions"><el-button :disabled="busy" @click="selectedSkill = skill">查看内容</el-button><el-button v-if="skill.source === 'imported'" type="danger" plain :disabled="busy" @click="deleteSkill(skill)">删除</el-button></div>
      </article>
    </section>
    <el-dialog v-model="editorVisible" :title="editor.id ? '编辑 MCP 服务' : '添加 MCP 服务'" width="min(620px, 94vw)" :close-on-click-modal="false" :before-close="closeEditor">
      <el-form label-position="top" @submit.prevent="saveEditor">
        <el-form-item label="服务名称"><el-input v-model="editor.name" :disabled="busy" maxlength="80" /></el-form-item>
        <el-form-item label="MCP HTTP 地址"><el-input v-model="editor.url" :disabled="busy" placeholder="https://example.com/mcp" @input="urlEdited" /></el-form-item>
        <el-form-item label="Bearer 访问令牌（仅当前页面，可留空）"><el-input v-model="editorToken" :disabled="busy" type="password" show-password autocomplete="off" /></el-form-item>
        <el-form-item><el-switch v-model="editor.enabled" :disabled="busy" active-text="允许助手使用已授权工具" /></el-form-item>
        <p class="caption">修改地址会清除旧工具授权和令牌。保存不会自动连接；请使用“检查连接”发现工具，再明确授权。</p>
      </el-form>
      <template #footer><el-button :disabled="busy" @click="editorVisible = false">取消</el-button><el-button type="primary" :loading="store.pending > 0" :disabled="busy" @click="saveEditor">保存服务</el-button></template>
    </el-dialog>
    <el-dialog :model-value="!!selectedSkill" title="技能内容" width="min(800px, 94vw)" @close="selectedSkill = undefined">
      <template v-if="selectedSkill"><h4>{{ selectedSkill.name }}</h4><p>{{ selectedSkill.description }}</p><el-alert v-for="warning in selectedSkill.warnings" :key="warning" :title="warning" type="warning" :closable="false" /><pre class="content-preview">{{ selectedSkill.instructions }}</pre><el-collapse><el-collapse-item v-for="file in selectedSkill.files" :key="file.path" :title="file.path" :name="file.path"><pre class="content-preview">{{ file.content }}</pre></el-collapse-item></el-collapse></template>
    </el-dialog>
    <el-dialog v-model="previewVisible" :title="previewTitle" width="min(800px, 94vw)"><p v-if="previewTruncated" class="caption">内容较长，仅显示有界预览。</p><pre class="content-preview">{{ previewText }}</pre></el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useExtensionsStore } from '@/stores/extensions'
import type { McpDiscovery, McpPromptDescriptor, RemoteMcpServer } from '@/types/mcp'
import type { WritingSkill } from '@/types/skills'
import { importSkillPackage } from '@/services/skills'

const props = withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false })
const store = useExtensionsStore()
const localBusy = ref(false)
const connectionBusy = ref(false)
const busy = computed(() => props.disabled || localBusy.value || store.pending > 0)
const discoveries = ref<Record<string, McpDiscovery>>(Object.create(null))
const discoveryUrls = ref<Record<string, string>>(Object.create(null))
const toolChoices = ref<Record<string, string[]>>(Object.create(null))
const promptArguments = ref<Record<string, string>>(Object.create(null))
const skillFileInput = ref<HTMLInputElement>()
const skillFolderInput = ref<HTMLInputElement>()
const selectedSkill = ref<WritingSkill>()
const editorVisible = ref(false)
const emptyEditor = (): RemoteMcpServer => ({ id: '', name: '', url: '', enabled: true, allowedTools: [] })
const editor = ref(emptyEditor())
let editorBase: RemoteMcpServer | undefined
const editorToken = ref('')
const previewVisible = ref(false)
const previewTitle = ref('')
const previewText = ref('')
const previewTruncated = ref(false)
let controller: AbortController | undefined

function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试' }
function argumentKey(serverId: string, promptName: string, argumentName: string) { return JSON.stringify([serverId, promptName, argumentName]) }
function clearDiscovery(id: string) {
  delete discoveries.value[id]
  delete discoveryUrls.value[id]
  delete toolChoices.value[id]
  for (const key of Object.keys(promptArguments.value)) { if ((JSON.parse(key) as string[])[0] === id) delete promptArguments.value[key] }
}
async function perform(action: () => Promise<unknown>) {
  if (busy.value) return
  localBusy.value = true
  try { await action() } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(errorMessage(error)) } finally { localBusy.value = false; connectionBusy.value = false; controller = undefined }
}
function setEnabled(value: string | number | boolean) { void perform(() => store.updateSettings({ enabled: !!value })) }
function setMaxSteps(value: number | undefined) { if (value !== undefined) void perform(() => store.updateSettings({ maxSteps: value })) }
function toggleServer(server: RemoteMcpServer, value: string | number | boolean) { void perform(() => store.saveServer({ ...server, enabled: !!value }, server)) }
function openEditor(server?: RemoteMcpServer) {
  if (busy.value) return
  editor.value = server ? { ...server, allowedTools: [...server.allowedTools] } : emptyEditor()
  editorBase = server ? { ...server, allowedTools: [...server.allowedTools] } : undefined
  editorToken.value = server ? store.credentials[server.id] || '' : ''
  editorVisible.value = true
}
function urlEdited() { editorToken.value = ''; editor.value.allowedTools = [] }
function closeEditor(done: () => void) { if (!busy.value) done() }
function saveEditor() {
  void perform(async () => {
    const draft = { ...editor.value, id: editor.value.id || crypto.randomUUID() }
    if (editorToken.value.includes('\n') || editorToken.value.includes('\r') || editorToken.value.length > 8192) throw new Error('访问令牌格式无效')
    await store.saveServer(draft, editorBase)
    store.setToken(draft.id, editorToken.value)
    clearDiscovery(draft.id)
    editorVisible.value = false
    editorToken.value = ''
    ElMessage.success('MCP 服务已保存')
  })
}
function deleteServer(server: RemoteMcpServer) {
  void perform(async () => {
    await ElMessageBox.confirm(`删除 MCP 服务“${server.name}”？`, '删除服务', { type: 'warning' })
    await store.removeServer(server.id)
    clearDiscovery(server.id)
  })
}
function probe(server: RemoteMcpServer) {
  void perform(async () => {
    controller = new AbortController()
    connectionBusy.value = true
    const { probeRemoteMcp } = await import('@/services/mcp')
    const discovery = await probeRemoteMcp(server, { bearerToken: store.credentials[server.id], signal: controller.signal, timeoutMs: 20_000 })
    if (!store.servers.some(current => current.id === server.id && current.url === server.url)) throw new Error('服务地址已更改，请重新检查连接')
    discoveries.value[server.id] = discovery
    discoveryUrls.value[server.id] = server.url
    toolChoices.value[server.id] = server.allowedTools.filter(name => discovery.tools.some(tool => tool.name === name))
    ElMessage.success(`已发现 ${discovery.tools.length} 个工具`)
  })
}
function saveAuthorization(server: RemoteMcpServer) {
  void perform(async () => {
    if (discoveryUrls.value[server.id] !== server.url) throw new Error('服务地址已更改，请重新检查连接')
    await store.saveServer({ ...server, allowedTools: [...(toolChoices.value[server.id] || [])] }, server)
    ElMessage.success('工具授权已保存')
  })
}
async function preview(server: RemoteMcpServer, title: string, getContent: (connection: Awaited<ReturnType<typeof import('@/services/mcp')['connectRemoteMcp']>>) => Promise<{ text: string; truncated: boolean }>) {
  if (discoveryUrls.value[server.id] !== server.url || !store.servers.some(current => current.id === server.id && current.url === server.url)) throw new Error('服务地址已更改，请重新检查连接')
  controller = new AbortController()
  connectionBusy.value = true
  const { connectRemoteMcp } = await import('@/services/mcp')
  const connection = await connectRemoteMcp({ ...server, enabled: false }, { bearerToken: store.credentials[server.id], signal: controller.signal, timeoutMs: 20_000 })
  try {
    const result = await getContent(connection)
    previewTitle.value = title
    previewText.value = result.text
    previewTruncated.value = result.truncated
    previewVisible.value = true
  } finally { await connection.close() }
}
function readResource(server: RemoteMcpServer, uri: string) { void perform(() => preview(server, 'MCP 资源预览', connection => connection.readResource(uri, { signal: controller?.signal, timeoutMs: 20_000 }))) }
function getPrompt(server: RemoteMcpServer, prompt: McpPromptDescriptor) {
  void perform(async () => {
    const args: Record<string, string> = {}
    for (const argument of prompt.arguments || []) {
      const value = promptArguments.value[argumentKey(server.id, prompt.name, argument.name)] || ''
      if (argument.required && !value.trim()) throw new Error(`请填写提示词参数：${argument.name}`)
      if (value) args[argument.name] = value
    }
    await preview(server, 'MCP 提示词预览', connection => connection.getPrompt(prompt.name, args, { signal: controller?.signal, timeoutMs: 20_000 }))
  })
}
function importFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  if (!files.length) return
  void perform(async () => {
    const skill = await importSkillPackage(files, { existingSkills: store.skills })
    await store.importSkill(skill)
    selectedSkill.value = skill
    ElMessage.success('技能已导入，请查看内容后在助手中选用')
  })
}
function deleteSkill(skill: WritingSkill) {
  void perform(async () => {
    await ElMessageBox.confirm(`删除技能“${skill.name}”？`, '删除技能', { type: 'warning' })
    await store.deleteSkill(skill.id)
  })
}
function resetSettings() { void perform(async () => { await ElMessageBox.confirm('重置所有扩展连接、导入技能和选择？小说与会话会保留。', '重置扩展设置', { type: 'warning' }); await store.reset() }) }
watch(() => store.servers, servers => {
  for (const id of Object.keys(discoveries.value)) {
    if (!servers.some(server => server.id === id && server.url === discoveryUrls.value[id])) {
      clearDiscovery(id)
    }
  }
})
onBeforeUnmount(() => controller?.abort())
</script>

<style scoped>
.extension-settings { display: grid; gap: 22px; }
.extension-settings h3 { margin: 0; }
.extension-settings p { margin: 8px 0; line-height: 1.6; color: var(--el-text-color-secondary); }
.section-heading, .skill-card, .inspector-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.actions .el-button + .el-button { margin-left: 0; }
.server-card, .skill-card { border: 1px solid var(--el-border-color); border-radius: 8px; padding: 16px; margin-top: 12px; }
.server-url, .inspector-row small { overflow-wrap: anywhere; }
.caption { font-size: 12px; }
.tool-list { display: grid; gap: 12px; padding: 16px 0; }
.tool-list :deep(.el-checkbox) { height: auto; align-items: flex-start; white-space: normal; }
.tool-list :deep(.el-checkbox__label) { white-space: normal; line-height: 1.6; }
.tool-list .el-tag { margin-left: 8px; }
.tool-description { display: block; color: var(--el-text-color-secondary); font-size: 12px; }
.inspector { margin-top: 14px; }
.inspector-row { margin-bottom: 12px; }
.inspector-row small { display: block; color: var(--el-text-color-secondary); }
.prompt-row { padding: 12px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.prompt-argument { display: block; margin: 8px 0; }
.content-preview { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 50vh; overflow: auto; padding: 12px; background: var(--el-fill-color-light); font-family: inherit; }
@media (max-width: 700px) { .section-heading, .skill-card { align-items: flex-start; flex-direction: column; } .server-card { padding: 12px; } }
</style>
