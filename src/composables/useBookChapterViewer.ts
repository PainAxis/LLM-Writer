import { ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { BookChapter } from '@/types/bookAnalysis'
import { readBookChapter } from '@/utils/bookAnalysisContext'

/** Chapter selection, reading and portable exports; generation remains page-owned. */
export function useBookChapterViewer({ bookContent, detectedChapters, autoDetectedChapters }: {
  bookContent: Ref<string>; detectedChapters: Ref<BookChapter[]>; autoDetectedChapters: Ref<BookChapter[]>
}) {
  const showChapterDetails = ref(false)

  // 章节内容查看相关
  const showChapterContent = ref(false)

  const selectedViewChapter = ref<number | null>(null)

  const currentViewChapter = ref<BookChapter | null>(null)

  const currentChapterContent = ref('')

  // 章节详情查看相关
  const selectedDetailChapter = ref<number | null>(null)

  const currentDetailChapter = ref<BookChapter | null>(null)

  const currentDetailChapterContent = ref('')

  const activeDetailTab = ref('content')
  // 默认显示完整内容

  const openChapterViewer = () => {
    if (detectedChapters.value.length === 0) {
      ElMessage.warning('暂无可查看的章节，请先上传文件')
      return
    }
    showChapterContent.value = true
    // 默认选择第一个章节
    if (detectedChapters.value.length > 0) {
      selectedViewChapter.value = detectedChapters.value[0].index
      loadChapterContent()
    }
  }

  const closeChapterContent = () => {
    showChapterContent.value = false
    selectedViewChapter.value = null
    currentViewChapter.value = null
    currentChapterContent.value = ''
  }

  const loadChapterContent = () => {
    if (selectedViewChapter.value === null) return

    const chapter = detectedChapters.value.find((c) => c.index === selectedViewChapter.value)
    if (!chapter) return

    currentViewChapter.value = chapter

    currentChapterContent.value = readBookChapter(
      bookContent.value,
      detectedChapters.value,
      chapter
    )
  }

  const copyChapterContent = async () => {
    if (!currentChapterContent.value) return

    try {
      await navigator.clipboard.writeText(currentChapterContent.value)
      ElMessage.success('章节内容已复制到剪贴板')
    } catch {
      // 降级处理：创建临时textarea进行复制
      const textarea = document.createElement('textarea')
      textarea.value = currentChapterContent.value
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      ElMessage.success('章节内容已复制到剪贴板')
    }
  }

  const exportChapterContent = () => {
    if (!currentChapterContent.value || !currentViewChapter.value) return

    const content = `${currentViewChapter.value.title}\n\n${currentChapterContent.value}`
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${currentViewChapter.value.title}_${new Date().getTime()}.txt`
    link.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`${currentViewChapter.value.title} 已导出！`)
  }

  // 章节详情管理相关方法
  const selectDetailChapter = (chapterIndex: number) => {
    selectedDetailChapter.value = chapterIndex
    const chapter = autoDetectedChapters.value.find((c) => c.index === chapterIndex)
    if (!chapter) return

    currentDetailChapter.value = chapter
    activeDetailTab.value = 'content' // 默认显示完整内容

    currentDetailChapterContent.value = readBookChapter(
      bookContent.value,
      autoDetectedChapters.value,
      chapter
    )
  }

  const copyDetailChapterContent = async () => {
    if (!currentDetailChapterContent.value || !currentDetailChapter.value) return

    let contentToCopy = ''
    if (activeDetailTab.value === 'summary') {
      contentToCopy = `${currentDetailChapter.value.title}\n\n简读：${currentDetailChapter.value.summary}`
    } else {
      contentToCopy = `${currentDetailChapter.value.title}\n\n${currentDetailChapterContent.value}`
    }

    try {
      await navigator.clipboard.writeText(contentToCopy)
      ElMessage.success('内容已复制到剪贴板')
    } catch {
      // 降级处理
      const textarea = document.createElement('textarea')
      textarea.value = contentToCopy
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      ElMessage.success('内容已复制到剪贴板')
    }
  }

  const exportDetailChapterContent = () => {
    if (!currentDetailChapter.value) return

    let content = ''
    let filename = ''

    if (activeDetailTab.value === 'summary') {
      content = `${currentDetailChapter.value.title}\n\n简读：\n${currentDetailChapter.value.summary}\n\n字数：${currentDetailChapter.value.wordCount}字`
      filename = `${currentDetailChapter.value.title}_简读_${new Date().getTime()}.txt`
    } else {
      content = `${currentDetailChapter.value.title}\n\n${currentDetailChapterContent.value}`
      filename = `${currentDetailChapter.value.title}_完整内容_${new Date().getTime()}.txt`
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
    ElMessage.success('章节内容已导出！')
  }

  const exportAllChapterSummary = () => {
    if (autoDetectedChapters.value.length === 0) {
      ElMessage.error('暂无章节简读数据')
      return
    }

    let summaryText = `章节简读报告\n`
    summaryText += `生成时间：${new Date().toLocaleString()}\n`
    summaryText += `总章节数：${autoDetectedChapters.value.length}\n`
    summaryText += `总字数：${bookContent.value.length.toLocaleString()}\n\n`
    summaryText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`

    autoDetectedChapters.value.forEach((chapter, index) => {
      summaryText += `【${chapter.title}】\n`
      summaryText += `字数：${chapter.wordCount}字\n`
      summaryText += `简读：${chapter.summary}\n`
      if (index < autoDetectedChapters.value.length - 1) {
        summaryText += `\n${'─'.repeat(50)}\n\n`
      }
    })

    summaryText += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    summaryText += `\n导出完成！简读由用户按需调用 AI 生成；空白表示尚未生成。`

    const blob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `章节简读汇总_${new Date().getTime()}.txt`
    link.click()
    URL.revokeObjectURL(url)
    ElMessage.success('所有章节简读已导出！')
  }

  const exportAllChapterContent = () => {
    if (autoDetectedChapters.value.length === 0) {
      ElMessage.error('暂无章节数据')
      return
    }

    let allContent = `本地自动分章完整内容\n`
    allContent += `生成时间：${new Date().toLocaleString()}\n`
    allContent += `总章节数：${autoDetectedChapters.value.length}\n`
    allContent += `总字数：${bookContent.value.length.toLocaleString()}\n\n`
    allContent += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`

    autoDetectedChapters.value.forEach((chapter, index) => {
      allContent += `【${chapter.title}】\n`
      allContent += `字数：${chapter.wordCount}字\n`
      allContent += `简读：${chapter.summary}\n\n`

      const chapterContent = readBookChapter(bookContent.value, autoDetectedChapters.value, chapter)

      allContent += `完整内容：\n${chapterContent}\n`

      if (index < autoDetectedChapters.value.length - 1) {
        allContent += `\n${'═'.repeat(80)}\n\n`
      }
    })

    allContent += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    allContent += `\n导出完成！章节按本地规则划分，包含所有章节的完整文本。`

    const blob = new Blob([allContent], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `本地分章完整内容_${new Date().getTime()}.txt`
    link.click()
    URL.revokeObjectURL(url)
    ElMessage.success('所有章节完整内容已导出！')
  }

  // 打开章节详情查看器
  const openChapterDetailsViewer = () => {
    if (autoDetectedChapters.value.length === 0) {
      ElMessage.warning('暂无自动拆分的章节，请先进行本地自动分章')
      return
    }

    showChapterDetails.value = true
    // 默认选择第一个章节
    if (autoDetectedChapters.value.length > 0) {
      selectDetailChapter(autoDetectedChapters.value[0].index)
    }
  }

  return { showChapterDetails, showChapterContent, selectedViewChapter, currentViewChapter, currentChapterContent, selectedDetailChapter, currentDetailChapter, currentDetailChapterContent, activeDetailTab, openChapterViewer, closeChapterContent, loadChapterContent, copyChapterContent, exportChapterContent, selectDetailChapter, copyDetailChapterContent, exportDetailChapterContent, exportAllChapterSummary, exportAllChapterContent, openChapterDetailsViewer }
}
