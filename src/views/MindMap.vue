<template>
  <div class="mindmap-page">
    <div class="mindmap-toolbar">
      <el-select
        :model-value="selectedNovelId"
        :disabled="saving"
        filterable
        placeholder="选择小说"
        style="width: 260px"
        @change="changeNovel"
      >
        <el-option v-for="novel in novels" :key="novel.id" :label="novel.title" :value="novel.id" />
      </el-select>

      <el-button size="default" :icon="Aim" :disabled="!mind" @click="fitView">适应画布</el-button>
      <el-button
        size="default"
        :icon="Download"
        :disabled="!mind"
        :loading="exporting"
        @click="exportPng"
      >
        导出 PNG
      </el-button>

      <el-button v-if="!editing" :disabled="!activeNovel || !mind" @click="startEditing"
        >编辑导图</el-button
      >
      <template v-else>
        <el-button type="primary" :loading="saving" :disabled="!dirty" @click="saveEdits"
          >保存修改</el-button
        >
        <el-button :disabled="saving" @click="cancelEditing">取消编辑</el-button>
      </template>
      <span v-if="editing" class="mindmap-stats"
        >双击修改标题或名称；右键或 Tab 添加条目，Delete
        删除。同一分类内可调整顺序。正文和其他字段保留。</span
      >
      <span v-if="activeNovel" class="mindmap-stats">
        章节 {{ activeNovel.chapterList?.length || 0 }} · 人物
        {{ activeNovel.characters?.length || 0 }} · 世界观
        {{ activeNovel.worldSettings?.length || 0 }} · 事件 {{ activeNovel.events?.length || 0 }} ·
        语料
        {{ activeNovel.corpusData?.length || 0 }}
      </span>
    </div>

    <div ref="mapContainer" class="mindmap-canvas" :class="{ 'is-saving': saving }">
      <el-empty
        v-if="!activeNovel && novels.length === 0"
        description="暂无小说数据，请先在「小说列表」创建作品"
        :image-size="120"
        class="mindmap-empty"
      />
      <el-empty
        v-else-if="!activeNovel"
        description="选择一部小说，自动生成结构导图"
        :image-size="120"
        class="mindmap-empty"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, nextTick, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Aim, Download } from '@element-plus/icons-vue'
import { storageGet, StorageKeys } from '@/utils/storage'
import { buildMindMapData } from '@/utils/mindmapData'
import { buildEditableMindMapData, mindMapGroupId, MIND_MAP_SECTIONS } from '@/utils/mindmapEditing'
import { useMindMapDraft } from '@/composables/useMindMapDraft'
import type { WriterNovel } from '@/types/writer'
import type MindElixirCtor from 'mind-elixir'
import { useTheme } from '@/composables/useTheme'
import type { NodeObj, Topic, Theme } from 'mind-elixir'

type MindElixirInstance = InstanceType<typeof MindElixirCtor>
const novels = ref<WriterNovel[]>(storageGet<WriterNovel[]>(StorageKeys.novels, []))
const selectedNovelId = ref(0)
const activeNovel = ref<WriterNovel | null>(null)
const mapContainer = ref<HTMLElement | null>(null)
const mind = shallowRef<MindElixirInstance | null>(null)
const exporting = ref(false)
const { resolvedTheme } = useTheme()
let themes: Record<'light' | 'dark', Theme> | null = null
watch(resolvedTheme, mode => {
  // Applying CSS variables preserves selection, open editors and unsaved nodes.
  if (mind.value && themes) mind.value.changeTheme(themes[mode], false)
})
const draft = useMindMapDraft()
const { editing, dirty, saving } = draft
const groupIds = new Set(
  Object.keys(MIND_MAP_SECTIONS).map((section) =>
    mindMapGroupId(section as keyof typeof MIND_MAP_SECTIONS)
  )
)
let disposed = false
let renderRevision = 0
let creating: Promise<MindElixirInstance | null> | null = null
const isEntity = (node?: NodeObj) => !!node?.parent && groupIds.has(node.parent.id)
const groupOf = (node?: NodeObj) => (isEntity(node) ? node!.parent!.id : null)
const selectedTopic = (topic?: Topic) => topic ?? mind.value?.currentNode ?? undefined

onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload)
  if (novels.value.length) {
    selectedNovelId.value = novels.value[0].id
    await renderSelected()
  }
})
onUnmounted(() => {
  disposed = true
  renderRevision++
  window.removeEventListener('beforeunload', beforeUnload)
  mind.value?.destroy()
  mind.value = null
})
function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value && !saving.value) return
  event.preventDefault()
  event.returnValue = ''
}
async function allowDiscard(): Promise<boolean> {
  if (saving.value) return false
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('放弃未保存的导图修改？', '取消编辑', {
      confirmButtonText: '放弃修改',
      cancelButtonText: '继续编辑',
      type: 'warning',
    })
    return true
  } catch {
    return false
  }
}
onBeforeRouteLeave(async () => {
  if (!(await allowDiscard())) return false
  draft.cancel()
  return true
})
async function changeNovel(id: number) {
  if (id === selectedNovelId.value || !(await allowDiscard())) return
  draft.cancel()
  selectedNovelId.value = id
  novels.value = storageGet<WriterNovel[]>(StorageKeys.novels, [])
  await renderSelected()
}
async function ensureInstance(): Promise<MindElixirInstance | null> {
  if (mind.value) return mind.value
  if (creating) return creating
  const container = mapContainer.value
  if (!container || disposed) return null
  creating = (async () => {
    const MindElixir = (await import('mind-elixir')).default
    themes = { light: MindElixir.THEME, dark: MindElixir.DARK_THEME }
    if (disposed || mapContainer.value !== container) return null
    const instance = new MindElixir({
      el: container,
      theme: themes[resolvedTheme.value],
      locale: 'zh_CN',
      editable: true,
      draggable: true,
      contextMenu: true,
      contextMenuOption: { focus: false, link: false },
      toolBar: false,
      keypress: true,
      overflowHidden: false,
      newTopicName: '新条目',
      before: {
        beginEdit: (element) => !groupIds.has(selectedTopic(element)?.nodeObj.id ?? ''),
        setNodeTopic: (element) => !groupIds.has(element.nodeObj.id),
        addChild: (element) => groupIds.has(selectedTopic(element)?.nodeObj.id ?? ''),
        insertSibling: (_position, element) => isEntity(selectedTopic(element)?.nodeObj),
        insertParent: () => false,
        removeNode: (element) => isEntity(selectedTopic(element)?.nodeObj),
        removeNodes: (elements) => elements.every((element) => isEntity(element.nodeObj)),
        copyNode: () => false,
        copyNodes: () => false,
        moveUpNode: (element) => isEntity(selectedTopic(element)?.nodeObj),
        moveDownNode: (element) => isEntity(selectedTopic(element)?.nodeObj),
        moveNodeIn: (elements, target) =>
          groupIds.has(target.nodeObj.id) &&
          elements.every((element) => groupOf(element.nodeObj) === target.nodeObj.id),
        moveNodeBefore: (elements, target) =>
          isEntity(target.nodeObj) &&
          elements.every((element) => groupOf(element.nodeObj) === groupOf(target.nodeObj)),
        moveNodeAfter: (elements, target) =>
          isEntity(target.nodeObj) &&
          elements.every((element) => groupOf(element.nodeObj) === groupOf(target.nodeObj)),
      },
    })
    instance.bus.addListener('operation', (operation) => {
      if (operation.name !== 'beginEdit') draft.markDirty()
    })
    mind.value = instance
    return instance
  })()
  try {
    return await creating
  } finally {
    creating = null
  }
}
async function renderSelected(): Promise<void> {
  const revision = ++renderRevision
  const novel = novels.value.find((item) => item.id === selectedNovelId.value) ?? null
  activeNovel.value = novel
  if (!novel) return
  const instance = await ensureInstance()
  if (!instance || disposed || revision !== renderRevision) return
  const data = editing.value ? buildEditableMindMapData(novel) : buildMindMapData(novel)
  if (!instance.nodes || instance.nodes.childElementCount === 0) instance.init(data)
  else instance.refresh(data)
  if (editing.value) instance.enableEdit()
  else instance.disableEdit()
  fitView()
}
async function startEditing() {
  if (!activeNovel.value || saving.value) return
  draft.begin(activeNovel.value)
  await renderSelected()
}
async function cancelEditing() {
  if (!(await allowDiscard())) return
  draft.cancel()
  novels.value = storageGet<WriterNovel[]>(StorageKeys.novels, [])
  await renderSelected()
}
async function saveEdits() {
  if (!mind.value || saving.value) return
  mapContainer.value?.querySelector<HTMLElement>('#input-box')?.blur()
  await nextTick()
  const data = mind.value.getData()
  try {
    const { changes } = draft.prepare(data)
    if (changes.removed) {
      try {
        await ElMessageBox.confirm(
          `将删除 ${changes.removed} 个条目${changes.removedChapters ? `，其中 ${changes.removedChapters} 个章节的正文也会删除` : ''}。确认保存？`,
          '确认删除',
          {
            confirmButtonText: '保存并删除',
            cancelButtonText: '继续编辑',
            type: 'warning',
          }
        )
      } catch {
        return
      }
    }
    mind.value.disableEdit()
    await draft.save(data)
    draft.cancel()
    novels.value = storageGet<WriterNovel[]>(StorageKeys.novels, [])
    await renderSelected()
    ElMessage.success('导图修改已保存')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    if (editing.value && !disposed) mind.value?.enableEdit()
  }
}
function fitView(): void {
  if (!mind.value) return
  mind.value.scale(1)
  mind.value.toCenter()
}
async function exportPng(): Promise<void> {
  if (!mind.value || !activeNovel.value) return
  exporting.value = true
  try {
    const { downloadImage } = await import('@mind-elixir/export-mindmap')
    if (disposed || !mind.value) return
    await downloadImage(mind.value, 'png')
    if (!disposed) ElMessage.success('导图已导出为 PNG')
  } catch (error) {
    if (!disposed)
      ElMessage.error(`导出失败: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.mindmap-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: calc(100vh - 120px);
}

.mindmap-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.mindmap-stats {
  font-size: 12px;
  color: var(--ink-500);
}

.mindmap-canvas {
  flex: 1;
  min-height: 400px;
  border: 1px solid var(--ink-200);
  border-radius: var(--radius-lg);
  background: var(--el-bg-color-page);
  position: relative;
  overflow: hidden;
}

.mindmap-canvas :deep(#cm-add_parent),
.mindmap-canvas :deep(#cm-summary) {
  display: none;
}

.mindmap-canvas.is-saving {
  pointer-events: none;
}

.mindmap-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
</style>
