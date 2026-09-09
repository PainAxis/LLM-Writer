<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-header">
        <span>📊 事件时间线</span>
        <div class="event-header-actions">
          <el-radio-group v-model="eventsView" size="small">
            <el-radio-button value="list">列表</el-radio-button>
            <el-radio-button value="timeline">时间线</el-radio-button>
          </el-radio-group>
          <el-button size="small" type="primary" @click="emit('add')">
            <el-icon><Plus /></el-icon>
            新增
          </el-button>
        </div>
      </div>
    </template>

    <div v-if="eventsView === 'timeline'" class="events-timeline">
      <el-timeline v-if="sortedEvents.length > 0">
        <el-timeline-item
          v-for="event in sortedEvents"
          :key="event.id"
          :timestamp="getEventChapterText(event)"
          :type="
            getImportanceType(event.importance) === 'danger'
              ? 'danger'
              : getImportanceType(event.importance) === 'warning'
                ? 'warning'
                : 'primary'
          "
          placement="top"
        >
          <div class="event-content timeline-event-content">
            <div class="event-header">
              <h4>{{ event.title }}</h4>
              <div class="event-actions">
                <el-dropdown trigger="click" @command="handleEventAction($event, event)">
                  <el-button size="small" type="text" @click.stop>
                    <el-icon><MoreFilled /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="edit">
                        <el-icon><Edit /></el-icon>
                        编辑
                      </el-dropdown-item>
                      <el-dropdown-item command="delete" divided>
                        <el-icon><Delete /></el-icon>
                        删除
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
            <p class="event-desc">{{ event.description }}</p>
            <div class="event-meta">
              <el-tag size="small">{{ getEventChapterText(event) }}</el-tag>
              <el-tag
                v-for="name in getEventCharacterNames(event)"
                :key="name"
                size="small"
                type="info"
                effect="plain"
              >
                {{ name }}
              </el-tag>
              <span class="event-time">{{ event.time }}</span>
            </div>
          </div>
        </el-timeline-item>
      </el-timeline>
      <div v-else class="empty-state">
        <p>暂无事件记录</p>
        <el-button size="small" @click="emit('add')">添加第一个事件</el-button>
      </div>
    </div>

    <div v-else class="events-list">
      <div v-for="event in sortedEvents" :key="event.id" class="event-item">
        <div class="event-marker"></div>
        <div class="event-content">
          <div class="event-header">
            <h4>{{ event.title }}</h4>
            <div class="event-actions">
              <el-dropdown trigger="click" @command="handleEventAction($event, event)">
                <el-button size="small" type="text" @click.stop>
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">
                      <el-icon><Edit /></el-icon>
                      编辑
                    </el-dropdown-item>
                    <el-dropdown-item command="delete" divided>
                      <el-icon><Delete /></el-icon>
                      删除
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
          <el-tooltip
            :content="event.description || ''"
            placement="right"
            :disabled="(event.description || '').length <= 80"
            effect="light"
            :show-after="300"
          >
            <p class="event-desc event-desc-truncated">
              {{
                (event.description || '').length > 80
                  ? (event.description || '').substring(0, 80) + '...'
                  : event.description || ''
              }}
            </p>
          </el-tooltip>
          <div class="event-meta">
            <el-tag size="small">{{ getEventChapterText(event) }}</el-tag>
            <el-tag
              v-for="name in getEventCharacterNames(event)"
              :key="name"
              size="small"
              type="info"
              effect="plain"
            >
              {{ name }}
            </el-tag>
            <span class="event-time">{{ event.time }}</span>
          </div>
        </div>
      </div>

      <div v-if="sortedEvents.length === 0" class="empty-state">
        <p>暂无事件记录</p>
        <el-button size="small" @click="emit('add')">添加第一个事件</el-button>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Delete, Edit, MoreFilled, Plus } from '@element-plus/icons-vue'
import type { TagProps } from 'element-plus'
import type {
  WriterChapter,
  WriterCharacter,
  WriterEvent,
  WriterEventImportance,
  WriterTimestamp,
} from '@/types/writer'

type EventsView = 'list' | 'timeline'

const props = defineProps<{
  events: readonly WriterEvent[]
  chapters: readonly WriterChapter[]
  characters: readonly WriterCharacter[]
}>()

const emit = defineEmits<{
  add: []
  edit: [event: WriterEvent]
  delete: [event: WriterEvent]
}>()

const eventsView = ref<EventsView>('list')

const importanceTypes: Record<string, TagProps['type']> = {
  high: 'danger',
  normal: 'primary',
  low: 'info',
}

function getImportanceType(importance?: WriterEventImportance): TagProps['type'] {
  return importanceTypes[importance ?? ''] ?? 'primary'
}

function getEventChapterText(event: WriterEvent): string {
  if (!event.chapter && event.chapter !== 0) return '未指定章节'
  const value = String(event.chapter).trim()
  const chapterNum = Number.parseInt(value, 10)
  if (Number.isFinite(chapterNum) && String(chapterNum) === value) {
    const chapter = props.chapters[chapterNum - 1]
    return chapter ? `第${chapterNum}章 ${chapter.title}` : `第${chapterNum}章`
  }
  return String(event.chapter)
}

function getEventCharacterNames(event: WriterEvent): string[] {
  return (event.characterIds ?? [])
    .map(
      (id) =>
        props.characters.find((character) => character.id === id)?.name ??
        (typeof id === 'string' ? id : null),
    )
    .filter((name): name is string => Boolean(name))
}

function getTimestamp(value?: WriterTimestamp): number {
  if (value instanceof Date) return value.getTime()
  return new Date(value ?? 0).getTime()
}

const sortedEvents = computed<WriterEvent[]>(() =>
  [...props.events].sort((a, b) => {
    const chapterA = Number.parseInt(String(a.chapter ?? ''), 10)
    const chapterB = Number.parseInt(String(b.chapter ?? ''), 10)
    const numA = Number.isFinite(chapterA) ? chapterA : Number.MAX_SAFE_INTEGER
    const numB = Number.isFinite(chapterB) ? chapterB : Number.MAX_SAFE_INTEGER
    if (numA !== numB) return numA - numB

    const timeA = String(a.time || '')
    const timeB = String(b.time || '')
    if (timeA !== timeB) return timeA.localeCompare(timeB)

    return getTimestamp(a.createdAt) - getTimestamp(b.createdAt)
  }),
)

function handleEventAction(command: unknown, event: WriterEvent): void {
  if (command === 'edit') emit('edit', event)
  else if (command === 'delete') emit('delete', event)
}
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.event-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.timeline-event-content {
  padding-bottom: 4px;
}

.events-timeline {
  max-height: calc(100vh - 190px);
  overflow-y: auto;
}

.event-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  transition: all 0.3s;
}

.event-item:hover {
  background-color: var(--brand-50);
  border-color: var(--brand-500);
}

.event-marker {
  width: 10px;
  height: 10px;
  margin-right: 10px;
  background-color: var(--brand-500);
  border-radius: 50%;
}

.event-content {
  flex: 1;
}

.event-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.event-content h4 {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.event-content p {
  margin: 0 0 4px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--el-text-color-regular);
}

.event-actions {
  opacity: 0;
  transition: opacity 0.3s;
}

.event-item:hover .event-actions {
  opacity: 1;
}

.event-desc-truncated {
  cursor: help;
  transition: color 0.2s ease;
}

.event-desc-truncated:hover {
  color: var(--el-text-color-primary);
}

.event-meta {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.event-time {
  margin-left: 8px;
  color: #c0c4cc;
}

.empty-state {
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
</style>
