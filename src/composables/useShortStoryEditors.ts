import { ref, shallowRef, nextTick, type Ref } from 'vue'
import type { IDomEditor } from '@wangeditor/editor'

/** Editor refs/configuration and guarded updates shared by the article/story components. */
export function useShortStoryEditors() {
  const hasSelection = ref(false)
  const selectedText = ref('')
  // WangEditor相关
  const editorRef = shallowRef<IDomEditor | null>(null)

  const toolbarConfig = {}

  const editorConfig = {
    placeholder: '生成的小说内容将显示在这里...',
    MENU_CONF: {
      uploadImage: {
        server: '/api/upload-image',
        fieldName: 'file',
        maxFileSize: 5 * 1024 * 1024,
        allowedFileTypes: ['image/*'],
      },
    },
  }

  // 短文编辑器相关
  const articleEditorRef = shallowRef<IDomEditor | null>(null)

  const articleToolbarConfig = {}

  const articleEditorConfig = {
    placeholder: '生成的短文内容将显示在这里，您也可以直接编辑...',
    MENU_CONF: {
      uploadImage: {
        server: '/api/upload-image',
        fieldName: 'file',
        maxFileSize: 5 * 1024 * 1024,
        allowedFileTypes: ['image/*'],
      },
    },
  }

  const updateGeneratedEditor = (
    content: Ref<string>,
    editor: Ref<IDomEditor | null>,
    text: string,
    isCurrent: () => boolean
  ) => {
    const html = text.replace(/\n/g, '<br/>')
    content.value = html
    const instance = editor.value
    nextTick(() => {
      if (isCurrent() && instance && editor.value === instance && content.value === html)
        instance.setHtml(html)
    })
  }

  const handleEditorCreated = (editor: IDomEditor) => {
    editorRef.value = editor
  }

  const onEditorChange = (_editor: IDomEditor) => {
    // 编辑器内容变化时的处理，v-model会自动处理
  }

  // 短文编辑器事件处理
  const handleArticleEditorCreated = (editor: IDomEditor) => {
    articleEditorRef.value = editor
  }

  const onArticleEditorChange = (_editor: IDomEditor) => {
    // 短文编辑器内容变化时的处理，v-model会自动处理
  }

  const handleTextSelection = (_event: Event) => {
    const selection = window.getSelection()?.toString() ?? ''
    if (selection.length > 0) {
      selectedText.value = selection
      hasSelection.value = true
    } else {
      hasSelection.value = false
    }
  }

  return { editorRef, articleEditorRef, toolbarConfig, articleToolbarConfig, editorConfig, articleEditorConfig, updateGeneratedEditor, handleEditorCreated, handleArticleEditorCreated, onEditorChange, onArticleEditorChange, handleTextSelection }
}
