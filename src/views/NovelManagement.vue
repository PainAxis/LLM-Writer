<template>
  <div class="novel-management">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-content">
        <h1>小说列表</h1>
        <p>查看和管理您的小说作品</p>
      </div>
      <div class="header-actions">
        <el-button 
          v-if="novels.length > 0" 
          @click="exportAllNovels"
          :disabled="filteredNovels.length === 0"
        >
          <el-icon><Download /></el-icon>
          导出列表
        </el-button>
        <el-button type="primary" @click="showCreateDialog = true">
          <el-icon><Plus /></el-icon>
          创建新小说
        </el-button>
      </div>
    </div>

    <!-- 筛选和搜索 -->
    <div class="filter-section">
      <el-card shadow="never">
        <div class="filter-content">
          <div class="filter-left">
            <el-select v-model="statusFilter" placeholder="状态筛选" style="width: 120px;">
              <el-option label="全部" value="all" />
              <el-option label="创作中" value="writing" />
              <el-option label="已完成" value="completed" />
              <el-option label="已暂停" value="paused" />
            </el-select>
            
            <el-select v-model="genreFilter" placeholder="类型筛选" style="width: 120px;">
              <el-option label="全部类型" value="all" />
              <el-option 
                v-for="(preset, key) in genrePresets" 
                :key="key"
                :label="preset.name" 
                :value="key"
              />
            </el-select>
            
            <el-select v-model="sortBy" placeholder="排序方式" style="width: 140px;">
              <el-option label="最近更新" value="updated" />
              <el-option label="创建时间" value="created" />
              <el-option label="字数" value="wordCount" />
              <el-option label="章节数" value="chapters" />
            </el-select>
          </div>
          
          <div class="filter-right">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索小说标题、简介..."
              clearable
              style="width: 300px;"
            >
              <template #prefix>
                <el-icon><Search /></el-icon>
              </template>
            </el-input>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 小说列表 -->
    <div class="novels-grid">
      <div 
        v-for="novel in filteredNovels" 
        :key="novel.id"
        class="novel-card"
      >
        <el-card shadow="hover" class="novel-item">
          <div class="novel-cover">
            <img 
              :src="novel.cover || '/default-cover.jpg'" 
              :alt="novel.title"
              loading="lazy"
              @error="handleImageError"
              @load="handleImageLoad"
            />
            <div class="novel-status">
              <el-tag 
                :type="getStatusType(novel.status)"
                size="small"
              >
                {{ getStatusText(novel.status) }}
              </el-tag>
            </div>
          </div>
          
          <div class="novel-info">
            <h3 class="novel-title">{{ novel.title }}</h3>
            <p class="novel-description">{{ novel.description }}</p>
            
            <div class="novel-meta">
              <div class="meta-item">
                <el-icon><Document /></el-icon>
                <span>{{ (novel.chapterList || []).length }}章</span>
              </div>
              <div class="meta-item">
                <el-icon><EditPen /></el-icon>
                <span>{{ formatNumber(novel.wordCount || 0) }}字</span>
              </div>
              <div class="meta-item">
                <el-icon><Calendar /></el-icon>
                <span>{{ formatDate(novel.updatedAt) }}</span>
              </div>
            </div>
            
            <div class="novel-genre">
              <el-tag size="small" type="info">{{ getGenreDisplayName(novel.genre) }}</el-tag>
            </div>
          </div>
          
          <div class="novel-actions">
            <el-button 
              type="primary" 
              size="small" 
              @click="openNovel(novel)"
            >
              <el-icon><Edit /></el-icon>
              编辑
            </el-button>
            <el-button 
              size="small" 
              @click="viewNovelDetails(novel)"
            >
              <el-icon><View /></el-icon>
              详情
            </el-button>
            <el-dropdown trigger="click">
              <el-button size="small" type="text">
                <el-icon><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="editNovelInfo(novel)">
                    <el-icon><EditPen /></el-icon>
                    编辑信息
                  </el-dropdown-item>
                  <el-dropdown-item divided @click="exportNovel(novel)">
                    <el-icon><Download /></el-icon>
                    导出
                  </el-dropdown-item>
                  <el-dropdown-item @click="duplicateNovel(novel)">
                    <el-icon><CopyDocument /></el-icon>
                    复制
                  </el-dropdown-item>
                  <el-dropdown-item divided @click="deleteNovel(novel)">
                    <el-icon><Delete /></el-icon>
                    删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="filteredNovels.length === 0" class="empty-state">
      <el-empty description="暂无小说作品">
        <el-button type="primary" @click="showCreateDialog = true">创建第一部小说</el-button>
      </el-empty>
    </div>

    <!-- 创建小说对话框 -->
    <el-dialog 
      v-model="showCreateDialog"
      :close-on-click-modal="!isSavingNovels"
      :close-on-press-escape="!isSavingNovels"
      :show-close="!isSavingNovels"
      title="创建新小说" 
      width="600px"
      @close="resetCreateForm"
    >
      <NovelMetadataForm
        ref="createFormRef" v-model="createForm" v-model:tag-input="tagInput"
        mode="create" :genres="genrePresets" :rules="createRules"
        :disabled="isSavingNovels" :generating="isGeneratingDescription"
        @genre-change="onGenreChange" @generate="generateDescription" @stop="createDescriptionTask.stop"
        @cover-change="handleNativeFileChange" @remove-cover="removeCover"
        @add-tag="addTag" @remove-tag="removeTag"
      />
      
      <template #footer>
        <el-button @click="showCreateDialog = false" :disabled="isSavingNovels">取消</el-button>
        <el-button type="primary" @click="createNovel" :loading="isSavingNovels" :disabled="isGeneratingDescription">创建</el-button>
      </template>
    </el-dialog>

    <!-- 小说详情对话框 -->
    <el-dialog 
      v-model="showDetailsDialog" 
      title="小说详情" 
      width="800px"
    >
      <div v-if="selectedNovel" class="novel-details">
        <div class="details-header">
          <div class="details-cover">
            <img 
              :src="selectedNovel.cover || '/default-cover.jpg'" 
              :alt="selectedNovel.title"
              loading="lazy"
              @error="handleImageError"
              @load="handleImageLoad"
            />
          </div>
          <div class="details-info">
            <h2>{{ selectedNovel.title }}</h2>
            <p class="details-description">{{ selectedNovel.description }}</p>
            <div class="details-meta">
              <div class="meta-row">
                <span class="meta-label">类型：</span>
                <el-tag size="small">{{ getGenreDisplayName(selectedNovel.genre) }}</el-tag>
              </div>
              <div class="meta-row">
                <span class="meta-label">状态：</span>
                <el-tag :type="getStatusType(selectedNovel.status)" size="small">
                  {{ getStatusText(selectedNovel.status) }}
                </el-tag>
              </div>
              <div class="meta-row">
                <span class="meta-label">章节：</span>
                <span>{{ selectedNovel.chapters }}章</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">字数：</span>
                <span>{{ formatNumber(selectedNovel.wordCount) }}字</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">创建时间：</span>
                <span>{{ formatDate(selectedNovel.createdAt) }}</span>
              </div>
              <div class="meta-row">
                <span class="meta-label">更新时间：</span>
                <span>{{ formatDate(selectedNovel.updatedAt) }}</span>
              </div>
            </div>
          </div>
        </div>
        
        <div class="details-content">
          <el-tabs v-model="activeTab">
            <el-tab-pane label="章节列表" name="chapters">
              <div class="chapters-list">
                <div 
                  v-for="(chapter, index) in selectedNovel.chapterList" 
                  :key="index"
                  class="chapter-item"
                >
                  <div class="chapter-info">
                    <h4>第{{ index + 1 }}章 {{ chapter.title }}</h4>
                    <p>{{ chapter.wordCount }}字 · {{ formatDate(chapter.updatedAt) }}</p>
                  </div>
                  <div class="chapter-actions">
                    <el-button size="small" @click="editChapter(chapter)">编辑</el-button>
                  </div>
                </div>
              </div>
            </el-tab-pane>
            
            <el-tab-pane label="创作记录" name="records">
              <div class="writing-records">
                <div 
                  v-for="record in selectedNovel.writingRecords" 
                  :key="record.id"
                  class="record-item"
                >
                  <div class="record-date">{{ formatDate(record.date) }}</div>
                  <div class="record-content">
                    <div class="record-stats">
                      <span>写作 {{ record.wordsWritten }} 字</span>
                      <span>用时 {{ record.timeSpent }} 分钟</span>
                    </div>
                    <div class="record-note" v-if="record.note">
                      {{ record.note }}
                    </div>
                  </div>
                </div>
              </div>
            </el-tab-pane>
            
            <el-tab-pane label="统计数据" name="statistics">
              <div class="novel-statistics">
                <div class="stats-grid">
                  <div class="stat-item">
                    <div class="stat-value">{{ selectedNovel.totalWords }}</div>
                    <div class="stat-label">总字数</div>
                  </div>
                  <div class="stat-item">
                    <div class="stat-value">{{ (selectedNovel.chapterList || []).length }}</div>
                    <div class="stat-label">章节数</div>
                  </div>
                  <div class="stat-item">
                    <div class="stat-value">{{ Math.round((selectedNovel.wordCount || 0) / Math.max((selectedNovel.chapterList || []).length, 1)) }}</div>
                    <div class="stat-label">平均章节字数</div>
                  </div>
                  <div class="stat-item">
                    <div class="stat-value">{{ selectedNovel.writingDays }}</div>
                    <div class="stat-label">创作天数</div>
                  </div>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </div>
      </div>
    </el-dialog>

    <!-- 编辑小说信息对话框 -->
    <el-dialog 
      v-model="showEditDialog"
      :close-on-click-modal="!isSavingNovels"
      :close-on-press-escape="!isSavingNovels"
      :show-close="!isSavingNovels"
      title="编辑小说信息" 
      width="600px"
      @close="resetEditForm"
    >
      <NovelMetadataForm
        ref="editFormRef" v-model="editForm" v-model:tag-input="editTagInput"
        mode="edit" :genres="genrePresets" :rules="editRules"
        :disabled="isSavingNovels" :generating="isGeneratingEditDescription"
        @generate="generateEditDescription" @stop="editDescriptionTask.stop" @cover-change="handleEditFileChange"
        @remove-cover="removeEditCover" @add-tag="addEditTag" @remove-tag="removeEditTag"
      />
      
      <template #footer>
        <el-button @click="showEditDialog = false" :disabled="isSavingNovels">取消</el-button>
        <el-button type="primary" @click="updateNovelInfo" :loading="isSavingEdit" :disabled="isGeneratingEditDescription">保存修改</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { 
  Plus, Search, Document, EditPen, Calendar, Edit, View, 
  MoreFilled, Download, CopyDocument, Delete
} from '@element-plus/icons-vue'
import NovelMetadataForm from '@/components/novel-management/NovelMetadataForm.vue'
import { useNovelManagementWorkspace } from '@/composables/useNovelManagementWorkspace'
const { editChapter, statusFilter, genreFilter, sortBy, searchKeyword, showCreateDialog, showDetailsDialog, showEditDialog, selectedNovel, activeTab, tagInput, editTagInput, createFormRef, editFormRef, isSavingEdit, isSavingNovels, novels, createForm, editForm, createDescriptionTask, editDescriptionTask, isGeneratingDescription, isGeneratingEditDescription, genrePresets, createRules, editRules, filteredNovels, getStatusType, getStatusText, getGenreDisplayName, formatNumber, formatDate, handleImageError, handleImageLoad, openNovel, viewNovelDetails, exportNovel, exportAllNovels, duplicateNovel, deleteNovel, addTag, removeTag, handleNativeFileChange, removeCover, createNovel, onGenreChange, resetCreateForm, editNovelInfo, resetEditForm, addEditTag, removeEditTag, handleEditFileChange, removeEditCover, generateEditDescription, updateNovelInfo, generateDescription } = useNovelManagementWorkspace()
</script>

<style scoped>
.novel-management {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 20px;
  background: var(--el-bg-color);
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.header-content h1 {
  margin: 0 0 5px 0;
  font-size: 24px;
  color: var(--el-text-color-primary);
}

.header-content p {
  margin: 0;
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.filter-section {
  margin-bottom: 20px;
}

.filter-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}

.filter-left {
  display: flex;
  gap: 15px;
}

.novels-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.novel-card {
  height: 100%;
}

.novel-item {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.novel-item :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0;
}

.novel-cover {
  position: relative;
  height: 200px;
  overflow: hidden;
  border-radius: 8px 8px 0 0;
}

.novel-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.novel-status {
  position: absolute;
  top: 10px;
  right: 10px;
}

.novel-info {
  flex: 1;
  padding: 15px;
}

.novel-title {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  line-height: 1.4;
}

.novel-description {
  margin: 0 0 15px 0;
  color: var(--el-text-color-regular);
  font-size: 13px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.novel-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 15px;
  margin-bottom: 10px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.novel-genre {
  margin-bottom: 15px;
}

.novel-actions {
  display: flex;
  gap: 8px;
  padding: 0 15px 15px;
  margin-top: auto;
}

.empty-state {
  padding: 60px 0;
}



.novel-details {
  max-height: 600px;
  overflow-y: auto;
}

.details-header {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid #ebeef5;
}

.details-cover {
  flex-shrink: 0;
}

.details-cover img {
  width: 120px;
  height: 160px;
  object-fit: cover;
  border-radius: 6px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.details-info {
  flex: 1;
}

.details-info h2 {
  margin: 0 0 10px 0;
  color: var(--el-text-color-primary);
}

.details-description {
  margin: 0 0 15px 0;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}

.details-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.meta-label {
  font-weight: 500;
  color: var(--el-text-color-primary);
  min-width: 80px;
}

.chapters-list {
  max-height: 300px;
  overflow-y: auto;
}

.chapter-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--ink-100);
}

.chapter-info h4 {
  margin: 0 0 5px 0;
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.chapter-info p {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.writing-records {
  max-height: 300px;
  overflow-y: auto;
}

.record-item {
  display: flex;
  gap: 15px;
  padding: 12px 0;
  border-bottom: 1px solid var(--ink-100);
}

.record-date {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  min-width: 80px;
}

.record-content {
  flex: 1;
}

.record-stats {
  display: flex;
  gap: 15px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  margin-bottom: 5px;
}

.record-note {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 20px;
}

.stat-item {
  text-align: center;
  padding: 20px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--brand-500);
  margin-bottom: 5px;
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.image-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.image-placeholder i {
  font-size: 24px;
  margin-bottom: 8px;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    gap: 15px;
    text-align: center;
  }
  
  .filter-content {
    flex-direction: column;
    gap: 15px;
  }
  
  .filter-left {
    flex-wrap: wrap;
    justify-content: center;
  }
  
  .novels-grid {
    grid-template-columns: 1fr;
  }
  
  .details-header {
    flex-direction: column;
    text-align: center;
  }
  
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
