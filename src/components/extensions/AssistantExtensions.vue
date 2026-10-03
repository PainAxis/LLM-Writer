<template>
  <section class="assistant-extensions" aria-label="本次创作扩展">
    <div class="extension-heading">
      <el-switch :model-value="store.enabled" :disabled="busy" active-text="创作扩展" @change="setEnabled" />
      <router-link to="/settings?tab=extensions" :aria-disabled="disabled" :tabindex="disabled ? -1 : 0" @click="guardLink">管理 MCP / Skills</router-link>
    </div>
    <el-alert v-if="store.loadError" :title="`扩展设置无法读取：${store.loadError}`" type="error" :closable="false" />
    <template v-if="store.enabled">
      <p class="privacy-note">所选小说的内容可由模型通过只读工具查询；技能指令会加入本次上下文。</p>
      <el-form label-position="top" class="extension-form">
        <el-form-item label="允许读取的小说">
          <el-select :model-value="store.selectedNovelId" clearable placeholder="选择小说，或仅使用 Skills / MCP" :disabled="busy" @change="selectNovel" @visible-change="refreshWhenOpen">
            <el-option v-for="novel in novels" :key="novel.id" :label="novel.title || `未命名小说 ${novel.id}`" :value="novel.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="写作 Skills">
          <el-select :model-value="store.selectedSkillIds" multiple clearable placeholder="按需选择写作流程" :disabled="busy" @update:model-value="selectSkills">
            <el-option v-for="skill in store.skills" :key="skill.id" :label="skill.name" :value="skill.id"><span>{{ skill.name }}</span><small class="skill-source">{{ skill.source === 'builtin' ? '内置' : '导入' }}</small></el-option>
          </el-select>
        </el-form-item>
      </el-form>
      <el-alert v-if="staleNovel" title="所选小说已不存在，请重新选择后发送。" type="error" :closable="false" />
      <el-collapse>
        <el-collapse-item :title="`小说工具 (${store.writingToolIds.length}) · 只读`" name="writing-tools">
          <p v-if="store.selectedNovelId === undefined" class="privacy-note">选择小说后可启用创作工具。</p>
          <el-checkbox-group :model-value="store.writingToolIds" :disabled="busy || store.selectedNovelId === undefined" class="writing-tool-options" @update:model-value="selectWritingTools">
            <el-checkbox v-for="tool in WRITING_TOOL_DESCRIPTORS" :key="tool.id" :value="tool.id"><span>{{ tool.label }}</span><small>{{ tool.description }}</small></el-checkbox>
          </el-checkbox-group>
        </el-collapse-item>
        <el-collapse-item :title="`远程 MCP (${activeServers.length}) · 已启用且已授权`" name="mcp-tools">
          <p v-if="!activeServers.length" class="privacy-note">没有启用的已授权服务。请到设置检查连接并选择工具。</p>
          <div v-for="server in activeServers" :key="server.id" class="remote-status"><strong>{{ server.name }}</strong><span>{{ server.allowedTools.length }} 个工具</span><el-tag size="small" :type="store.credentials[server.id] ? 'success' : 'info'">{{ store.credentials[server.id] ? '本页令牌已设置' : '无令牌' }}</el-tag></div>
          <p v-if="activeServers.length" class="privacy-note">模型可直接调用这些已授权工具。刷新页面后，需在设置重新输入受保护服务的令牌。</p>
        </el-collapse-item>
      </el-collapse>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useExtensionsStore } from '@/stores/extensions'
import { WRITING_TOOL_DESCRIPTORS } from '@/services/writingTools'
import { StorageKeys, storageGet } from '@/utils/storage'
import type { WriterNovel } from '@/types/writer'
import type { WritingToolId } from '@/types/writingTools'

const props = withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false })
const store = useExtensionsStore()
const busy = computed(() => props.disabled || store.pending > 0)
const novels = ref<WriterNovel[]>([])
const activeServers = computed(() => store.servers.filter(server => server.enabled && server.allowedTools.length > 0))
const staleNovel = computed(() => store.selectedNovelId !== undefined && !novels.value.some(novel => novel.id === store.selectedNovelId))
function refreshNovels() { novels.value = storageGet<WriterNovel[]>(StorageKeys.novels, []).filter(novel => Number.isSafeInteger(novel.id) && novel.id > 0) }
function refreshWhenOpen(visible: boolean) { if (visible) refreshNovels() }
async function update(patch: Parameters<typeof store.updateSettings>[0]) {
  if (busy.value) return
  try { await store.updateSettings(patch) } catch (error) { ElMessage.error(error instanceof Error ? error.message : '扩展设置保存失败') }
}
function setEnabled(value: string | number | boolean) { void update({ enabled: !!value }) }
function selectNovel(value: number | undefined | '') {
  const id = value === '' || value == null ? undefined : value
  void update({ selectedNovelId: id, writingToolIds: id === undefined ? [] : store.selectedNovelId === undefined ? WRITING_TOOL_DESCRIPTORS.map(tool => tool.id) : [...store.writingToolIds] })
}
function selectSkills(value: string[]) { void update({ selectedSkillIds: value }) }
function selectWritingTools(value: Array<string | number | boolean>) { void update({ writingToolIds: value as WritingToolId[] }) }
function guardLink(event: MouseEvent) { if (props.disabled) event.preventDefault() }
function onStorage(event: StorageEvent) { if (event.key === StorageKeys.novels || event.key === null) refreshNovels() }
onMounted(() => { refreshNovels(); window.addEventListener('storage', onStorage); window.addEventListener('focus', refreshNovels) })
onBeforeUnmount(() => { window.removeEventListener('storage', onStorage); window.removeEventListener('focus', refreshNovels) })
</script>

<style scoped>
.assistant-extensions { border: 1px solid var(--el-border-color-lighter); background: var(--el-fill-color-extra-light); padding: 12px; border-radius: 8px; margin: 10px 0; }
.extension-heading, .remote-status { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.extension-heading a { color: var(--el-color-primary); font-size: 12px; }
.extension-heading a[aria-disabled="true"] { color: var(--el-text-color-disabled); }
.privacy-note { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.6; margin: 8px 0; }
.extension-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.extension-form .el-form-item { margin-bottom: 8px; }
.extension-form .el-select { width: 100%; }
.skill-source { float: right; color: var(--el-text-color-secondary); }
.writing-tool-options { display: grid; gap: 8px; }
.writing-tool-options :deep(.el-checkbox) { height: auto; white-space: normal; align-items: flex-start; }
.writing-tool-options :deep(.el-checkbox__label) { white-space: normal; }
.writing-tool-options small { display: block; line-height: 1.6; color: var(--el-text-color-secondary); }
.remote-status { justify-content: flex-start; margin: 8px 0; }
@media (max-width: 600px) { .extension-form { grid-template-columns: 1fr; gap: 0; } }
</style>
