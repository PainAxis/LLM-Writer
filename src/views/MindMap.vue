<template>
  <div class="mindmap-page">
    <div class="mindmap-toolbar">
      <el-select
        v-model="selectedNovelId"
        filterable
        placeholder="选择小说"
        style="width: 260px"
        @change="renderSelected"
      >
        <el-option
          v-for="novel in novels"
          :key="novel.id"
          :label="novel.title"
          :value="novel.id"
        />
      </el-select>

      <el-button size="default" :icon="Aim" :disabled="!mind" @click="fitView">适应画布</el-button>
      <el-button size="default" :icon="Download" :disabled="!mind" :loading="exporting" @click="exportPng">
        导出 PNG
      </el-button>

      <span v-if="activeNovel" class="mindmap-stats">
        章节 {{ activeNovel.chapterList?.length || 0 }} · 人物 {{ activeNovel.characters?.length || 0 }} · 世界观
        {{ activeNovel.worldSettings?.length || 0 }} · 事件 {{ activeNovel.events?.length || 0 }} · 语料
        {{ activeNovel.corpusData?.length || 0 }}
      </span>
    </div>

    <div ref="mapContainer" class="mindmap-canvas">
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
import { onMounted, onUnmounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Aim, Download } from '@element-plus/icons-vue'
import { storageGet, StorageKeys } from '@/utils/storage'
import { buildMindMapData, type NovelLike } from '@/utils/mindmapData'
import type MindElixirCtor from 'mind-elixir'

/** mind-elixir 实例类型（运行时动态加载，首屏零开销） */
type MindElixirInstance = InstanceType<typeof MindElixirCtor>

interface NovelSummary extends NovelLike {
  id: number
  title: string
}

const novels = ref<NovelSummary[]>(storageGet<NovelSummary[]>(StorageKeys.novels, []))
const selectedNovelId = ref<number>(0)
const activeNovel = ref<NovelSummary | null>(null)

const mapContainer = ref<HTMLElement | null>(null)
const mind = ref<MindElixirInstance | null>(null)
const exporting = ref(false)

onMounted(async () => {
  if (novels.value.length > 0) {
    selectedNovelId.value = novels.value[0].id
    await renderSelected()
  }
})

onUnmounted(() => {
  try {
    mind.value?.destroy?.()
  } catch {
    // 实例可能未完成初始化
  }
  mind.value = null
})

async function ensureInstance(): Promise<MindElixirInstance | null> {
  if (mind.value || !mapContainer.value) return mind.value
  const MindElixir = (await import('mind-elixir')).default
  const instance = new MindElixir({
    el: mapContainer.value,
    locale: 'zh_CN',
    // 只读模式：关闭一切编辑入口
    editable: false,
    draggable: false,
    contextMenu: false,
    toolBar: false,
    keypress: false,
    overflowHidden: true,
  })
  instance.disableEdit()
  mind.value = instance
  return instance
}

async function renderSelected(): Promise<void> {
  const novel = novels.value.find((item) => item.id === selectedNovelId.value) ?? null
  activeNovel.value = novel
  if (!novel) return

  const instance = await ensureInstance()
  if (!instance) return

  const data = buildMindMapData(novel)
  if (!instance.nodes || instance.nodes.childElementCount === 0) {
    instance.init(data)
  } else {
    instance.refresh(data)
  }
  fitView()
}

function fitView(): void {
  if (!mind.value) return
  try {
    mind.value.scale(1)
    mind.value.toCenter()
  } catch (error) {
    console.warn('[mindmap] 画布适配失败:', error)
  }
}

async function exportPng(): Promise<void> {
  if (!mind.value || !activeNovel.value) return
  exporting.value = true
  try {
    const { downloadImage } = await import('@mind-elixir/export-mindmap')
    await downloadImage(mind.value, 'png')
    ElMessage.success('导图已导出为 PNG')
  } catch (error) {
    console.error('[mindmap] 导出失败:', error)
    ElMessage.error(`导出失败: ${(error as Error).message}`)
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
  /* 导图节点为浅色样式，画布固定浅色底避免暗色模式下对比混乱 */
  background: #f7f8fa;
  position: relative;
  overflow: hidden;
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
