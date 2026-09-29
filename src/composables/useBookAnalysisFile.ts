import { computed, ref, shallowRef } from 'vue'
import { createBookImporter, type BookFile, type TextEncoding } from '@/utils/bookImport'

export interface BookSourceFile { name: string; size?: number; raw?: BookFile }

interface FileWorkspaceOptions {
  isBusy(): boolean
  onImported(content: string): void
  onRemoved(): void
  notify: { success(message: string): unknown; error(message: string): unknown }
  importer?: ReturnType<typeof createBookImporter>
}

export function useBookAnalysisFile(options: FileWorkspaceOptions) {
  const importer = options.importer ?? createBookImporter()
  const uploadedFile = shallowRef<BookSourceFile | null>(null)
  const bookContent = ref('')
  const selectedEncoding = ref<TextEncoding>('utf-8')
  const importedEncoding = ref<TextEncoding>('utf-8')
  const importingFile = ref(false)
  const isDocx = computed(() => Boolean(uploadedFile.value?.name.toLowerCase().endsWith('.docx')))
  const fileFormatLabel = computed(() => isDocx.value ? 'DOCX（自动解析）' : importedEncoding.value.toUpperCase())
  let revision = 0
  let disposed = false

  const handleFileChange = async (file: BookSourceFile) => {
    if (disposed || !file.raw || options.isBusy()) return
    const operation = ++revision
    importingFile.value = true
    try {
      const result = await importer.read(file.raw, selectedEncoding.value)
      if (!result || operation !== revision || disposed) return
      uploadedFile.value = file
      bookContent.value = result.content
      importedEncoding.value = result.encoding || 'utf-8'
      if (result.encoding) selectedEncoding.value = result.encoding
      options.onImported(result.content)
      options.notify.success(`文件导入成功！(${fileFormatLabel.value})`)
    } catch (error) {
      if (operation !== revision || disposed) return
      if (uploadedFile.value && !isDocx.value) selectedEncoding.value = importedEncoding.value
      options.notify.error(error instanceof Error ? error.message : '文件导入失败')
    } finally {
      if (operation === revision) importingFile.value = false
    }
  }

  const cancel = () => { revision++; importer.cancel(); importingFile.value = false }
  const removeFile = () => {
    cancel()
    uploadedFile.value = null
    bookContent.value = ''
    selectedEncoding.value = 'utf-8'
    importedEncoding.value = 'utf-8'
    options.onRemoved()
    options.notify.success('文件已移除')
  }
  const handleFileExceed = (files: File[]) => {
    const file = files[0]
    if (file) return handleFileChange({ name: file.name, size: file.size, raw: file })
  }
  const rereadWithEncoding = () => uploadedFile.value ? handleFileChange(uploadedFile.value) : undefined
  const dispose = () => { disposed = true; cancel() }
  return { uploadedFile, bookContent, selectedEncoding, importingFile, isDocx, fileFormatLabel,
    handleFileChange, handleFileExceed, rereadWithEncoding, removeFile, dispose }
}
