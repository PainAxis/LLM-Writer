<template>
  <div class="editor-container">
    <div class="editor-wrapper">
      <Toolbar :editor="editor" :default-config="toolbarConfig" mode="default" class="editor-toolbar" />
      <Editor
        v-model="content"
        :default-config="editorConfig"
        mode="default"
        @on-created="handleCreated"
        @on-change="emit('change')"
        class="editor-content"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from 'vue'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import type { IDomEditor, IEditorConfig } from '@wangeditor/editor'
import '@wangeditor/editor/dist/css/style.css'

const content = defineModel<string>({ required: true })
const emit = defineEmits<{ change: [] }>()
const editor = shallowRef<IDomEditor>()
const toolbarConfig = {}
const editorConfig: Partial<IEditorConfig> = {
  placeholder: '开始您的创作...',
  MENU_CONF: {
    uploadImage: {
      server: '/api/upload-image',
      fieldName: 'file',
      maxFileSize: 5 * 1024 * 1024,
      allowedFileTypes: ['image/*'],
    },
  },
}

function handleCreated(instance: IDomEditor) {
  editor.value = instance
}

defineExpose({
  getSelectionText: () => editor.value?.getSelectionText() ?? '',
  getHtml: () => editor.value?.getHtml() ?? '',
  insertText: (text: string) => editor.value?.insertText(text),
})

onBeforeUnmount(() => editor.value?.destroy())
</script>

<style scoped>
.editor-container {
  height: calc(100vh - 300px);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  overflow: hidden;
}
.editor-wrapper { height: 100%; display: flex; flex-direction: column; }
.editor-toolbar { border-bottom: 1px solid var(--el-border-color-light); }
.editor-content { overflow-y: hidden; }
.editor-wrapper :deep(.w-e-text-container) { background-color: var(--el-bg-color); border: none; }
.editor-wrapper :deep(.w-e-text) {
  font-family: 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'Source Han Sans CN', 'WenQuanYi Micro Hei', sans-serif;
  font-size: 16px;
  line-height: 2;
  color: var(--el-text-color-primary);
  padding: 30px 40px;
  letter-spacing: 0.5px;
  text-align: justify;
}
.editor-wrapper :deep(.w-e-text p) { margin: 0 0 1.2em; text-indent: 2em; line-height: 2; }
.editor-wrapper :deep(.w-e-text h1),
.editor-wrapper :deep(.w-e-text h2),
.editor-wrapper :deep(.w-e-text h3) { margin: 1.5em 0 1em; line-height: 1.6; text-indent: 0; font-weight: 600; }
.editor-wrapper :deep(.w-e-text h1) { font-size: 24px; }
.editor-wrapper :deep(.w-e-text h2) { font-size: 20px; }
.editor-wrapper :deep(.w-e-text h3) { font-size: 18px; }
</style>
