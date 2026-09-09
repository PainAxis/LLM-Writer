<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-header">
        <span>👥 人物角色</span>
        <div class="character-actions">
          <el-button size="small" type="primary" @click="emit('add')">
            <el-icon><Plus /></el-icon>
            新增
          </el-button>
          <el-button size="small" type="success" @click="emit('batch-generate')">
            🤖 AI批量生成
          </el-button>
        </div>
      </div>
    </template>

    <div class="characters-list">
      <div v-for="character in characters" :key="character.id" class="character-item">
        <div class="character-content" @click="emit('edit', character)">
          <div class="character-avatar">
            <img v-if="character.avatar" :src="character.avatar" />
            <div v-else class="default-avatar">{{ character.name?.charAt(0) || '？' }}</div>
          </div>
          <div class="character-info">
            <h4>{{ character.name }}</h4>
            <div class="character-meta">
              <el-tag :type="getRoleType(character.role)" size="small">
                {{ getRoleText(character.role) }}
              </el-tag>
              <el-tag v-if="character.gender" type="info" size="small">
                {{ getGenderText(character.gender) }}
              </el-tag>
              <span v-if="character.age" class="age-text">{{ character.age }}岁</span>
            </div>
            <el-tooltip
              v-if="character.personality"
              :content="character.personality"
              placement="right"
              :disabled="character.personality.length <= 60"
              effect="light"
              :show-after="300"
            >
              <p class="character-desc character-desc-truncated">
                {{
                  character.personality.length > 60
                    ? character.personality.substring(0, 60) + '...'
                    : character.personality
                }}
              </p>
            </el-tooltip>
            <div v-if="character.tags && character.tags.length" class="character-tags">
              <el-tag v-for="tag in character.tags" :key="tag" size="small">{{ tag }}</el-tag>
            </div>
          </div>
        </div>
        <div class="character-actions">
          <el-dropdown
            trigger="click"
            @command="(command: unknown) => handleCharacterAction(command, character)"
          >
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

      <div v-if="characters.length === 0" class="empty-state">
        <p>暂无人物设定</p>
        <el-button size="small" @click="emit('add')">创建第一个角色</el-button>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { Delete, Edit, MoreFilled, Plus } from '@element-plus/icons-vue'
import type { WriterCharacter, WriterCharacterGender, WriterCharacterRole } from '@/types/writer'

type TagType = 'primary' | 'success' | 'warning' | 'info' | 'danger'

defineProps<{
  characters: readonly WriterCharacter[]
}>()

const emit = defineEmits<{
  add: []
  'batch-generate': []
  edit: [character: WriterCharacter]
  delete: [character: WriterCharacter]
}>()

const roleTypes: Record<string, TagType> = {
  protagonist: 'danger',
  supporting: 'primary',
  antagonist: 'warning',
  minor: 'info',
}

const roleTexts: Record<string, string> = {
  protagonist: '主角',
  supporting: '配角',
  antagonist: '反派',
  minor: '次要角色',
}

const genderTexts: Record<string, string> = {
  male: '男',
  female: '女',
  other: '其他',
}

const getRoleType = (role?: WriterCharacterRole): TagType => roleTypes[role ?? ''] ?? 'info'
const getRoleText = (role?: WriterCharacterRole): string => roleTexts[role ?? ''] ?? '配角'
const getGenderText = (gender?: WriterCharacterGender): string => genderTexts[gender ?? ''] ?? '男'

const handleCharacterAction = (command: unknown, character: WriterCharacter) => {
  if (command === 'edit') emit('edit', character)
  else if (command === 'delete') emit('delete', character)
}
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.character-actions {
  display: flex;
  gap: 8px;
}

.characters-list {
  max-height: calc(100vh - 260px);
  overflow-y: auto;
}

.character-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  transition: all 0.3s;
}

.character-item:hover {
  background-color: var(--brand-50);
  border-color: var(--brand-500);
}

.character-item.active {
  background-color: #ecf5ff;
  border-color: var(--brand-500);
}

.character-avatar {
  width: 40px;
  height: 40px;
  margin-right: 10px;
  overflow: hidden;
  border-radius: 50%;
}

.character-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.default-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 16px;
  font-weight: bold;
  color: white;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.character-content {
  display: flex;
  flex: 1;
  align-items: center;
  cursor: pointer;
}

.character-info {
  flex: 1;
}

.character-info h4 {
  margin: 0 0 4px;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.character-info p {
  margin: 0 0 4px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--el-text-color-regular);
}

.character-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: 4px 0;
}

.character-meta .age-text {
  margin-left: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.character-desc {
  max-height: 2.6em;
  margin: 4px 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.3;
  color: #666;
  text-overflow: ellipsis;
}

.character-desc-truncated {
  cursor: help;
  transition: color 0.2s ease;
}

.character-desc-truncated:hover {
  color: var(--el-text-color-primary);
}

.character-tags {
  margin-top: 4px;
}

.character-tags .el-tag {
  margin-right: 4px;
  margin-bottom: 4px;
}

.character-item .character-actions {
  flex-shrink: 0;
  margin-left: 8px;
}

.empty-state {
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
</style>
