<template>
  <el-dialog
    v-model="showAnalysisLibrary"
    title="拆书参考库"
    width="720px"
    class="book-analysis-dialog"
    :close-on-click-modal="!libraryPending"
    :close-on-press-escape="!libraryPending"
    :show-close="!libraryPending"
  >
    <div class="library-toolbar">
      <span>{{ libraryRecords.length }} 份已保存报告</span>
      <el-button :loading="libraryPending" :disabled="savingLibraryReport" @click="loadAnalysisLibrary">刷新列表</el-button>
    </div>
    <el-alert v-if="libraryError" :title="libraryError" type="error" :closable="false" show-icon />
    <el-empty v-if="!libraryRecords.length && !libraryPending && !libraryError" description="暂无保存的拆书报告" />
    <div v-loading="libraryPending" class="library-list">
      <article v-for="record in libraryRecords" :key="record.id" class="library-report">
        <div class="library-report-details">
          <h3>{{ record.title }}</h3>
          <p class="library-report-meta">{{ record.sourceFileName || '未记录来源文件' }} · {{ formatDate(record.updatedAt) }}</p>
          <p class="library-report-preview">{{ record.content.slice(0, 140) }}</p>
        </div>
        <div class="library-report-actions">
          <el-button size="small" :disabled="libraryReportBusy" @click="openLibraryReport(record)">打开报告</el-button>
          <el-button
            size="small"
            type="danger"
            plain
            :loading="deletingLibraryReportId === record.id"
            :disabled="libraryPending || deletingLibraryReportId !== null"
            @click="deleteLibraryReport(record)"
          >删除</el-button>
        </div>
      </article>
    </div>
    <template #footer>
      <el-button :disabled="libraryPending" @click="showAnalysisLibrary = false">关闭</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="showSaveAnalysisReport"
    title="保存拆书报告"
    width="500px"
    class="book-analysis-dialog"
    :close-on-click-modal="!savingLibraryReport"
    :close-on-press-escape="!savingLibraryReport"
    :show-close="!savingLibraryReport"
  >
    <el-alert v-if="saveLibraryError" :title="saveLibraryError" type="error" :closable="false" show-icon />
    <el-form :disabled="savingLibraryReport" label-position="top">
      <el-form-item label="报告标题" required>
        <el-input v-model="analysisReportTitle" placeholder="请输入报告标题" maxlength="200" show-word-limit @keyup.enter="confirmSaveLibraryReport" />
      </el-form-item>
    </el-form>
    <p class="library-save-note">已保存的报告再次保存会更新原记录；原始小说文件不会写入参考库。</p>
    <template #footer>
      <el-button :disabled="savingLibraryReport" @click="showSaveAnalysisReport = false">取消</el-button>
      <el-button type="primary" :loading="savingLibraryReport" :disabled="libraryPending" @click="confirmSaveLibraryReport">保存报告</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { useBookAnalysisWorkspaceContext } from '@/composables/book-analysisContext'
const {
  showAnalysisLibrary, showSaveAnalysisReport, analysisReportTitle, savingLibraryReport,
  deletingLibraryReportId, libraryError, saveLibraryError, libraryRecords, libraryPending,
  libraryReportBusy, loadAnalysisLibrary, openLibraryReport, confirmSaveLibraryReport, deleteLibraryReport,
} = useBookAnalysisWorkspaceContext()
const formatDate = (value: string) => new Date(value).toLocaleString()
</script>

<style scoped>
.library-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.library-list { min-height: 40px; max-height: 55vh; overflow-y: auto; }
.library-report { display: flex; align-items: flex-start; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.library-report-details { flex: 1; min-width: 0; }
.library-report-details h3 { margin: 0 0 8px; overflow-wrap: anywhere; }
.library-report-meta, .library-save-note { color: var(--el-text-color-secondary); font-size: 12px; }
.library-report-preview { margin: 8px 0 0; color: var(--el-text-color-regular); white-space: pre-wrap; overflow-wrap: anywhere; }
.library-report-actions { display: flex; flex-direction: column; gap: 8px; }
.library-report-actions .el-button { margin-left: 0; }
</style>
