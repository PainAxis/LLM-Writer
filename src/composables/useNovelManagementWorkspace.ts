import type { WriterNovel, WriterChapter, WriterTimestamp } from '@/types/writer'
import type { NovelMetadataDraft, NovelGenrePreset } from '@/types/novelManagement'
import type { NovelPersistenceStatus } from '@/services/novelPersistence'
import type { FormInstance, TagProps } from 'element-plus'

interface MetadataFormHandle {
  validate: FormInstance['validate']
  clearValidate(): void
  clearCoverInput(): void
}
interface StoredGenre extends NovelGenrePreset {
  code: string
  usageCount?: number
}
const toDate = (value?: WriterTimestamp) =>
  value instanceof Date ? value : new Date(value ?? Date.now())

import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { useAIStream } from '@/composables/useAIStream'
import { useGenerationTask } from '@/composables/useGenerationTask'
import { filterNovelList } from '@/utils/novelList'
import { storageGet, storageSet, StorageKeys } from '@/utils/storage'
import { subscribeNovelPersistenceStatus } from '@/services/novelPersistence'

/** Typed orchestration for the NovelManagement view. */
export function useNovelManagementWorkspace() {
  const router = useRouter()

  // 响应式数据
  const statusFilter = ref('all')

  const genreFilter = ref('all')

  const sortBy = ref('updated')

  const searchKeyword = ref('')

  const showCreateDialog = ref(false)

  const showDetailsDialog = ref(false)

  const showEditDialog = ref(false)

  const selectedNovel = ref<WriterNovel | null>(null)

  const editingNovel = ref<WriterNovel | null>(null)

  const activeTab = ref('chapters')

  const tagInput = ref('')

  const editTagInput = ref('')

  const createFormRef = ref<MetadataFormHandle>()

  const editFormRef = ref<MetadataFormHandle>()

  const isSavingEdit = ref(false)

  const isSavingNovels = ref(false)

  // 一次创建表单生命周期使用同一身份，失败后的全局重试与再次提交不会重复创建。
  const createDraft = ref<{ id: number; createdAt: Date } | null>(null)

  // 小说数据 - 从localStorage加载
  const novels = ref<WriterNovel[]>([])

  // 加载小说数据
  const loadNovels = () => {
    try {
      const parsedNovels = storageGet<WriterNovel[] | null>(StorageKeys.novels, null)
      if (parsedNovels) {
        // 将日期字符串转换为Date对象
        novels.value = parsedNovels.map((novel) => ({
          ...novel,
          createdAt: toDate(novel.createdAt),
          updatedAt: toDate(novel.updatedAt),
          chapterList: (novel.chapterList || []).map((chapter) => ({
            ...chapter,
            createdAt: chapter.createdAt ? toDate(chapter.createdAt) : new Date(),
            updatedAt: chapter.updatedAt ? toDate(chapter.updatedAt) : new Date(),
          })),
          writingRecords: (novel.writingRecords || []).map((record) => ({
            ...record,
            date: toDate(record.date),
          })),
        }))
      } else {
        // 如果没有保存的数据，初始化为空
        novels.value = []
      }
    } catch (error) {
      console.error('加载小说数据失败:', error)
      novels.value = []
    }
  }

  // 先提交独立快照，落盘完成后才更新列表，失败时表单与原列表仍可重试。
  const saveNovels = async (nextNovels: WriterNovel[], editedIds: WriterNovel['id'][] = []) => {
    if (isSavingNovels.value) throw new Error('正在保存小说，请稍后重试')
    isSavingNovels.value = true
    try {
      // Dates/default arrays added for list rendering are not edits. Preserve
      // untouched works exactly as this page's backend last saw them; the
      // persistence layer still owns conflict detection against other tabs.
      const current = new Map(storageGet<WriterNovel[]>(StorageKeys.novels, []).map(novel => [novel.id, novel]))
      const next = nextNovels.map(novel => editedIds.includes(novel.id) ? novel : current.get(novel.id) ?? novel)
      await storageSet(StorageKeys.novels, next)
      loadNovels()
    } finally {
      isSavingNovels.value = false
    }
  }

  // 创建表单
  const createForm = ref<NovelMetadataDraft>({
    title: '',
    genre: '',
    description: '',
    cover: '',
    tags: [],
  })

  // 编辑表单
  const editForm = ref<NovelMetadataDraft>({
    title: '',
    genre: '',
    status: '',
    description: '',
    cover: '',
    tags: [],
  })

  const createDescriptionTask = useGenerationTask({
    stream: useAIStream(),
    source: () => [
      showCreateDialog.value,
      createForm.value.title,
      createForm.value.genre,
      [...createForm.value.tags],
    ],
  })

  const editDescriptionTask = useGenerationTask({
    stream: useAIStream(),
    source: () => [
      showEditDialog.value,
      editingNovel.value?.id,
      editForm.value.title,
      editForm.value.genre,
      [...editForm.value.tags],
    ],
  })

  const isGeneratingDescription = createDescriptionTask.running

  const isGeneratingEditDescription = editDescriptionTask.running

  onUnmounted(() => {
    createDescriptionTask.dispose()
    editDescriptionTask.dispose()
  })

  // 动态类型预设配置 - 从localStorage读取
  const genrePresets = ref<Record<string, NovelGenrePreset>>({})

  // 表单验证规则
  const createRules = {
    title: [{ required: true, message: '请输入小说标题', trigger: 'blur' }],
    genre: [{ required: true, message: '请选择小说类型', trigger: 'change' }],
    description: [{ required: true, message: '请输入小说简介', trigger: 'blur' }],
  }

  const editRules = {
    title: [{ required: true, message: '请输入小说标题', trigger: 'blur' }],
    genre: [{ required: true, message: '请选择小说类型', trigger: 'change' }],
    status: [{ required: true, message: '请选择小说状态', trigger: 'change' }],
    description: [{ required: true, message: '请输入小说简介', trigger: 'blur' }],
  }

  // 计算属性
  const filteredNovels = computed(() =>
    filterNovelList(novels.value, {
      status: statusFilter.value,
      genre: genreFilter.value,
      sort: sortBy.value,
      keyword: searchKeyword.value,
    })
  )

  // 方法
  const getStatusType = (status?: string) => {
    const types: Record<string, TagProps['type']> = {
      writing: 'success',
      completed: 'info',
      paused: 'warning',
    }
    return types[status ?? ''] || 'info'
  }

  const getStatusText = (status?: string) => {
    const texts: Record<string, string> = {
      writing: '创作中',
      completed: '已完成',
      paused: '已暂停',
    }
    return texts[status ?? ''] || '未知'
  }

  const getGenreDisplayName = (genreCode?: string) => {
    return genrePresets.value[genreCode ?? '']?.name || genreCode || '未知'
  }

  // 加载类型数据
  const loadGenres = () => {
    try {
      const parsed = storageGet<StoredGenre[] | null>(StorageKeys.novelGenres, null)
      if (parsed) {
        // 转换为键值对格式，兼容旧版本
        const genresObj: Record<string, NovelGenrePreset> = {}
        parsed.forEach((genre) => {
          genresObj[genre.code] = {
            name: genre.name,
            tags: genre.tags,
            prompt: genre.prompt,
          }
        })
        genrePresets.value = genresObj
      } else {
        // 如果没有保存的数据，加载默认类型
        loadDefaultGenres()
      }
    } catch (error) {
      console.error('加载类型数据失败:', error)
      loadDefaultGenres()
    }
  }

  // 加载默认类型
  const loadDefaultGenres = () => {
    const defaultGenres = {
      fantasy: {
        name: '玄幻',
        tags: ['修仙', '异世界', '法宝', '灵气', '境界'],
        prompt: '创作一部玄幻小说，包含修仙体系、异世界冒险等元素，注重世界观构建和修炼体系描写。',
      },
      urban: {
        name: '都市',
        tags: ['都市', '现代', '职场', '生活'],
        prompt: '创作一部都市小说，以现代都市为背景，贴近现实生活，注重人物情感和社会现象描写。',
      },
      history: {
        name: '历史',
        tags: ['历史', '古代', '朝廷', '战争'],
        prompt: '创作一部历史小说，以真实历史为背景，注重历史考证和时代特色描写。',
      },
      scifi: {
        name: '科幻',
        tags: ['科幻', '未来', '科技', '太空'],
        prompt: '创作一部科幻小说，包含未来科技、太空探索等元素，注重科学性和想象力的平衡。',
      },
      wuxia: {
        name: '武侠',
        tags: ['武侠', '江湖', '武功', '侠义'],
        prompt: '创作一部武侠小说，以江湖为背景，注重武功描写和侠义精神体现。',
      },
      romance: {
        name: '言情',
        tags: ['言情', '爱情', '情感', '浪漫'],
        prompt: '创作一部言情小说，以爱情为主线，注重情感描写和人物关系发展。',
      },
    }
    genrePresets.value = defaultGenres
  }

  // 更新类型使用计数
  const updateGenreUsageCount = (genreCode?: string) => {
    try {
      const genres = storageGet<StoredGenre[] | null>(StorageKeys.novelGenres, null)
      if (genres) {
        const genreIndex = genres.findIndex((g) => g.code === genreCode)
        if (genreIndex > -1) {
          genres[genreIndex].usageCount = (genres[genreIndex].usageCount || 0) + 1
          storageSet(StorageKeys.novelGenres, genres)
          console.log(`类型 ${genreCode} 使用计数更新为:`, genres[genreIndex].usageCount)
        }
      }
    } catch (error) {
      console.error('更新类型使用计数失败:', error)
    }
  }

  const formatNumber = (num = 0) => {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + '万'
    }
    return num.toLocaleString()
  }

  const formatDate = (date?: WriterTimestamp) => {
    return date === undefined ? '—' : toDate(date).toLocaleDateString('zh-CN')
  }

  const handleImageError = (e: Event) => {
    const image = e.target
    if (!(image instanceof HTMLImageElement)) return
    // 防止无限循环加载
    if (image.src.includes('default-cover.jpg') || image.getAttribute('data-error-handled')) {
      // 如果默认图片也加载失败，显示占位符
      image.style.display = 'none'

      // 检查是否已经有占位符，避免重复创建
      const existingPlaceholder = image.parentElement?.querySelector('.image-placeholder')
      if (!existingPlaceholder) {
        const placeholder = document.createElement('div')
        placeholder.className = 'image-placeholder'
        placeholder.innerHTML = '<i class="el-icon-picture"></i><span>暂无封面</span>'
        image.parentElement?.appendChild(placeholder)
      }
      return
    }

    // 标记已经尝试过加载默认图片
    image.setAttribute('data-error-handled', 'true')
    image.src = '/default-cover.jpg'
  }

  const handleImageLoad = (e: Event) => {
    const image = e.target
    if (!(image instanceof HTMLImageElement)) return
    // 图片加载成功，移除错误标记
    image.removeAttribute('data-error-handled')

    // 移除可能存在的占位符
    const placeholder = image.parentElement?.querySelector('.image-placeholder')
    if (placeholder) {
      placeholder.remove()
    }
  }

  const openNovel = (novel: WriterNovel) => {
    // 跳转到AI写作页面
    router.push(`/writer?novelId=${novel.id}`)
  }

  const viewNovelDetails = (novel: WriterNovel) => {
    selectedNovel.value = novel
    showDetailsDialog.value = true
  }

  const exportNovel = (novel: WriterNovel) => {
    try {
      // 简化的HTML清理函数
      const cleanHtml = (htmlString?: string) => {
        if (!htmlString) return ''
        return htmlString
          .replace(/<br\s*\/?>/gi, '\n') // br标签转换为换行
          .replace(/<\/p>/gi, '\n\n') // p结束标签转换为双换行
          .replace(/<[^>]*>/g, '') // 移除所有HTML标签
          .replace(/&nbsp;/g, ' ') // HTML空格转换为普通空格
          .replace(/&lt;/g, '<') // HTML实体转换
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\n\s*\n\s*\n+/g, '\n\n') // 清理多余换行
          .trim()
      }

      // 构建导出内容
      let exportContent = `《${novel.title}》\n`
      exportContent += `${'='.repeat(50)}\n\n`

      // 基本信息
      exportContent += `📚 小说信息\n`
      exportContent += `标题：${novel.title}\n`
      exportContent += `作者：${novel.author || '未设置'}\n`
      exportContent += `类型：${getGenreDisplayName(novel.genre)}\n`
      exportContent += `状态：${getStatusText(novel.status)}\n`
      exportContent += `字数：${formatNumber(novel.wordCount || 0)}字\n`
      exportContent += `章节：${novel.chapters || 0}章\n`
      exportContent += `创建时间：${formatDate(novel.createdAt)}\n`
      exportContent += `更新时间：${formatDate(novel.updatedAt)}\n`

      if (novel.tags && novel.tags.length > 0) {
        exportContent += `标签：${novel.tags.join('、')}\n`
      }

      if (novel.description) {
        exportContent += `\n📖 简介\n`
        exportContent += `${cleanHtml(novel.description)}\n`
      }

      exportContent += `\n${'='.repeat(50)}\n\n`

      // 章节内容
      if (novel.chapterList && novel.chapterList.length > 0) {
        exportContent += `📝 章节内容\n\n`

        novel.chapterList.forEach((chapter, index) => {
          exportContent += `第${index + 1}章 ${chapter.title}\n`
          exportContent += `${'-'.repeat(30)}\n\n`

          if (chapter.description) {
            exportContent += `【章节简介】\n${cleanHtml(chapter.description)}\n\n`
          }

          if (chapter.content) {
            const cleanContent = cleanHtml(chapter.content)
            exportContent += `${cleanContent}\n\n`
          } else {
            exportContent += `（章节内容暂无）\n\n`
          }

          exportContent += `字数：${chapter.wordCount || 0}字\n`
          exportContent += `更新时间：${formatDate(chapter.updatedAt || chapter.createdAt)}\n\n`
          exportContent += `${'='.repeat(50)}\n\n`
        })
      } else {
        exportContent += `📝 章节内容\n\n`
        exportContent += `暂无章节内容\n\n`
      }

      // 统计信息
      exportContent += `📊 创作统计\n`
      exportContent += `总字数：${formatNumber(novel.totalWords || novel.wordCount || 0)}字\n`
      exportContent += `平均章节字数：${novel.avgWordsPerChapter || 0}字\n`
      exportContent += `创作天数：${novel.writingDays || 0}天\n`

      if (novel.writingRecords && novel.writingRecords.length > 0) {
        exportContent += `\n📝 创作记录\n`
        novel.writingRecords.forEach((record) => {
          exportContent += `${formatDate(record.date)}：写作${record.wordsWritten}字，用时${record.timeSpent}分钟\n`
          if (record.note) {
            exportContent += `备注：${cleanHtml(record.note)}\n`
          }
        })
      }

      exportContent += `\n\n导出时间：${new Date().toLocaleString()}\n`
      exportContent += `导出来源：AI小说生成器v0.5.0\n`

      // 创建并下载文件
      const blob = new Blob([exportContent], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url

      // 文件名处理
      const safeTitle = (novel.title || '未命名小说').replace(/[<>:"/\\|?*]/g, '_')
      link.download = `${safeTitle}_${new Date().toISOString().slice(0, 10)}.txt`

      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      ElMessage.success(`《${novel.title}》导出成功！`)
    } catch (error) {
      console.error('导出失败:', error)
      ElMessage.error('导出失败，请重试')
    }
  }

  // 批量导出所有小说
  const exportAllNovels = () => {
    try {
      if (filteredNovels.value.length === 0) {
        ElMessage.warning('没有可导出的小说')
        return
      }

      // 简化的HTML清理函数
      const cleanHtml = (htmlString?: string) => {
        if (!htmlString) return ''
        return htmlString
          .replace(/<br\s*\/?>/gi, '\n') // br标签转换为换行
          .replace(/<\/p>/gi, '\n\n') // p结束标签转换为双换行
          .replace(/<[^>]*>/g, '') // 移除所有HTML标签
          .replace(/&nbsp;/g, ' ') // HTML空格转换为普通空格
          .replace(/&lt;/g, '<') // HTML实体转换
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\n\s*\n\s*\n+/g, '\n\n') // 清理多余换行
          .trim()
      }

      // 构建导出内容
      let exportContent = `📚 小说列表导出\n`
      exportContent += `${'='.repeat(60)}\n\n`
      exportContent += `导出时间：${new Date().toLocaleString()}\n`
      exportContent += `小说数量：${filteredNovels.value.length}部\n`
      exportContent += `导出来源：AI小说生成器v0.5.0\n\n`
      exportContent += `${'='.repeat(60)}\n\n`

      filteredNovels.value.forEach((novel, index) => {
        exportContent += `【第${index + 1}部】《${novel.title}》\n`
        exportContent += `${'='.repeat(50)}\n\n`

        // 基本信息
        exportContent += `📚 小说信息\n`
        exportContent += `标题：${novel.title}\n`
        exportContent += `作者：${novel.author || '未设置'}\n`
        exportContent += `类型：${getGenreDisplayName(novel.genre)}\n`
        exportContent += `状态：${getStatusText(novel.status)}\n`
        exportContent += `字数：${formatNumber(novel.wordCount || 0)}字\n`
        exportContent += `章节：${novel.chapters || 0}章\n`
        exportContent += `创建时间：${formatDate(novel.createdAt)}\n`
        exportContent += `更新时间：${formatDate(novel.updatedAt)}\n`

        if (novel.tags && novel.tags.length > 0) {
          exportContent += `标签：${novel.tags.join('、')}\n`
        }

        if (novel.description) {
          exportContent += `\n📖 简介\n`
          exportContent += `${cleanHtml(novel.description)}\n`
        }

        exportContent += `\n${'='.repeat(50)}\n\n`

        // 章节概要
        if (novel.chapterList && novel.chapterList.length > 0) {
          exportContent += `📝 章节概要\n`
          novel.chapterList.forEach((chapter, chapterIndex) => {
            exportContent += `第${chapterIndex + 1}章 ${chapter.title}`
            if (chapter.wordCount) {
              exportContent += ` (${chapter.wordCount}字)`
            }
            exportContent += `\n`
            if (chapter.description) {
              exportContent += `  简介：${cleanHtml(chapter.description)}\n`
            }
          })
          exportContent += `\n`
        } else {
          exportContent += `📝 章节概要\n`
          exportContent += `暂无章节内容\n\n`
        }

        // 统计信息
        exportContent += `📊 创作统计\n`
        exportContent += `总字数：${formatNumber(novel.totalWords || novel.wordCount || 0)}字\n`
        exportContent += `平均章节字数：${novel.avgWordsPerChapter || 0}字\n`
        exportContent += `创作天数：${novel.writingDays || 0}天\n\n`

        // 分隔符
        if (index < filteredNovels.value.length - 1) {
          exportContent += `\n${'#'.repeat(60)}\n\n`
        }
      })

      exportContent += `\n\n${'='.repeat(60)}\n`
      exportContent += `导出完成！共导出 ${filteredNovels.value.length} 部小说\n`
      exportContent += `感谢使用 AI小说生成器v0.5.0\n`

      // 创建并下载文件
      const blob = new Blob([exportContent], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url

      // 生成文件名
      const dateStr = new Date().toISOString().slice(0, 10)
      const statusText = statusFilter.value === 'all' ? '全部' : getStatusText(statusFilter.value)
      const genreText =
        genreFilter.value === 'all'
          ? '全部类型'
          : genrePresets.value[genreFilter.value]?.name || '未知类型'

      link.download = `小说列表_${statusText}_${genreText}_${dateStr}.txt`

      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      ElMessage.success(`成功导出 ${filteredNovels.value.length} 部小说！`)
    } catch (error) {
      console.error('批量导出失败:', error)
      ElMessage.error('批量导出失败，请重试')
    }
  }

  const duplicateNovel = async (novel: WriterNovel) => {
    if (isSavingNovels.value) return
    const newNovel = {
      ...JSON.parse(JSON.stringify(novel)),
      id: Date.now(),
      title: novel.title + ' (副本)',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    try {
      await saveNovels([...novels.value, newNovel], [newNovel.id])
      ElMessage.success('小说复制成功')
    } catch {
      ElMessage.error('小说复制未保存，请重试')
    }
  }

  const deleteNovel = async (novel: WriterNovel) => {
    if (isSavingNovels.value) return
    try {
      await ElMessageBox.confirm(`确定要删除《${novel.title}》吗？此操作不可恢复。`, '确认删除', {
        type: 'warning',
      })
    } catch {
      return // 用户取消确认
    }
    try {
      if (novels.value.some((n) => n.id === novel.id)) {
        await saveNovels(novels.value.filter((n) => n.id !== novel.id))
        ElMessage.success('删除成功')
      }
    } catch {
      ElMessage.error('删除未保存，请重试')
    }
  }

  const addTag = () => {
    if (tagInput.value.trim() && !createForm.value.tags.includes(tagInput.value.trim())) {
      createForm.value.tags.push(tagInput.value.trim())
      tagInput.value = ''
    }
  }

  const removeTag = (index: number) => {
    createForm.value.tags.splice(index, 1)
  }

  const coverReaders: Record<'create' | 'edit', FileReader | null> = { create: null, edit: null }

  const stopCover = (mode: 'create' | 'edit') => {
    const reader = coverReaders[mode]
    coverReaders[mode] = null
    if (reader?.readyState === FileReader.LOADING) reader.abort()
  }

  const stopCreateCover = () => stopCover('create')

  const stopEditCover = () => stopCover('edit')

  watch(
    showCreateDialog,
    (open) => {
      if (!open) stopCreateCover()
    },
    { flush: 'sync' }
  )

  watch(
    showEditDialog,
    (open) => {
      if (!open) stopEditCover()
    },
    { flush: 'sync' }
  )

  onUnmounted(() => {
    stopCreateCover()
    stopEditCover()
  })

  const readCover = (mode: 'create' | 'edit', event: Event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    const file = input.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      ElMessage.error('只能上传图片文件!')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      ElMessage.error('图片大小不能超过 2MB!')
      return
    }
    stopCover(mode)
    const draft = mode === 'create' ? createForm.value : editForm.value
    const reader = new FileReader()
    coverReaders[mode] = reader
    reader.onload = () => {
      if (coverReaders[mode] !== reader || typeof reader.result !== 'string') return
      draft.cover = reader.result
      coverReaders[mode] = null
      input.value = ''
      ElMessage.success('封面上传成功')
    }
    reader.onerror = () => {
      if (coverReaders[mode] !== reader) return
      coverReaders[mode] = null
      ElMessage.error('封面读取失败，请重试')
    }
    reader.readAsDataURL(file)
  }

  const handleNativeFileChange = (event: Event) => readCover('create', event)

  const removeCover = () => {
    stopCreateCover()
    createForm.value.cover = ''
  }

  const createNovel = async () => {
    if (isSavingNovels.value || isGeneratingDescription.value) return
    try {
      await createFormRef.value!.validate()
    } catch {
      return
    }
    try {
      if (!createDraft.value) createDraft.value = { id: Date.now(), createdAt: new Date() }
      const draft = createDraft.value
      const existing = novels.value.find((novel) => novel.id === draft.id)
      const newNovel = {
        status: 'writing',
        chapters: 0,
        wordCount: 0,
        totalWords: 0,
        avgWordsPerChapter: 0,
        writingDays: 0,
        chapterList: [],
        writingRecords: [],
        characters: [],
        worldSettings: [],
        corpusData: [],
        events: [],
        // 全局重试可能已保存此草稿；再次提交只更新表单字段，保留其章节和素材。
        ...existing,
        ...createForm.value,
        tags: [...createForm.value.tags],
        id: draft.id,
        createdAt: existing?.createdAt ?? draft.createdAt,
        updatedAt: new Date(),
        genrePrompt: genrePresets.value[createForm.value.genre]?.prompt || '',
      }
      const nextNovels = existing
        ? novels.value.map((novel) => (novel.id === draft.id ? newNovel : novel))
        : [newNovel, ...novels.value]
      await saveNovels(nextNovels, [newNovel.id])
      updateGenreUsageCount(newNovel.genre)

      ElMessage.success('小说创建成功！即将跳转到编辑区...')
      showCreateDialog.value = false
      resetCreateForm()

      // 创建成功后跳转到编辑页面
      setTimeout(() => {
        router.push(`/writer?novelId=${newNovel.id}`)
      }, 1000)
    } catch (error) {
      console.error('创建小说失败:', error)
      ElMessage.error('小说尚未保存，表单内容已保留，请重试')
    }
  }

  // 监听类型选择，自动填充标签
  const onGenreChange = (genre: string) => {
    if (genrePresets.value[genre]) {
      createForm.value.tags = [...genrePresets.value[genre].tags]
    }
  }

  const resetCreateForm = () => {
    createDescriptionTask.stop()
    stopCreateCover()
    createDraft.value = null
    createForm.value = {
      title: '',
      genre: '',
      description: '',
      cover: '',
      tags: [],
    }
    tagInput.value = ''
  }

  // 编辑小说信息
  const editNovelInfo = (novel: WriterNovel) => {
    editDescriptionTask.stop()
    stopEditCover()
    editingNovel.value = novel
    editForm.value = {
      title: novel.title || '',
      genre: novel.genre || '',
      status: novel.status || 'writing',
      description: novel.description || '',
      cover: novel.cover || '',
      tags: [...(novel.tags || [])],
    }
    showEditDialog.value = true
  }

  // 重置编辑表单
  const resetEditForm = () => {
    editDescriptionTask.stop()
    stopEditCover()
    editForm.value = {
      title: '',
      genre: '',
      status: '',
      description: '',
      cover: '',
      tags: [],
    }
    editTagInput.value = ''
    editingNovel.value = null
    editFormRef.value?.clearValidate()
  }

  // 编辑表单的类型变化处理
  const _onEditGenreChange = (_genre: string) => {
    // 可以选择是否自动更新标签，这里不自动更新，让用户手动调整
  }

  // 添加编辑标签
  const addEditTag = () => {
    const tag = editTagInput.value.trim()
    if (tag && !editForm.value.tags.includes(tag)) {
      editForm.value.tags.push(tag)
      editTagInput.value = ''
    }
  }

  // 移除编辑标签
  const removeEditTag = (index: number) => {
    editForm.value.tags.splice(index, 1)
  }

  // 处理编辑文件变化
  const handleEditFileChange = (event: Event) => readCover('edit', event)

  const removeEditCover = () => {
    stopEditCover()
    editForm.value.cover = ''
    editFormRef.value?.clearCoverInput()
  }

  // 生成编辑简介
  const generateEditDescription = async () => {
    const form = editForm.value
    const task = editDescriptionTask
    if (task.running.value) return
    const title = form.title.trim()
    if (!title || !form.genre) {
      ElMessage.warning('请先填写小说标题和类型')
      return
    }
    const genreInfo = genrePresets.value[form.genre]
    if (!genreInfo) {
      ElMessage.warning('所选小说类型已不存在')
      return
    }
    const prompt = `请为小说《${title}》重新生成一段简介。

小说信息：
- 标题：${title}
- 类型：${genreInfo.name}
- 标签：${genreInfo.tags.join('、')}

要求：
1. 简介长度控制在100-200字之间
2. 突出${genreInfo.name}类型的特色
3. 包含主角、背景设定、核心冲突等元素
4. 语言要吸引人，能激发读者的阅读兴趣
5. 风格要符合${genreInfo.name}小说的特点

请直接输出简介内容，不要包含其他解释文字：`
    await task.start({
      prompt,
      options: { maxTokens: null, temperature: 0.8, type: 'synopsis' },
      onText: (text) => {
        form.description = text
      },
      onSuccess: () => ElMessage.success('AI简介生成成功！您可以根据需要进行修改'),
      onError: () => {
        ElMessage.error('AI生成失败，请手动修改简介')
      },
    })
  }

  // 保存小说信息修改
  const updateNovelInfo = async () => {
    if (isSavingNovels.value || isSavingEdit.value || isGeneratingEditDescription.value) return
    try {
      await editFormRef.value!.validate()
    } catch {
      return
    }
    isSavingEdit.value = true
    try {
      const editedNovel = editingNovel.value
      const index = novels.value.findIndex((n) => n.id === editedNovel?.id)
      if (index < 0 || !editedNovel) throw new Error('小说已不存在')
      const updated = {
        ...novels.value[index],
        ...editForm.value,
        tags: [...editForm.value.tags],
        updatedAt: new Date(),
      }
      const nextNovels = [...novels.value]
      nextNovels[index] = updated
      await saveNovels(nextNovels, [updated.id])
      if (editedNovel.genre !== updated.genre) updateGenreUsageCount(updated.genre)
      if (selectedNovel.value?.id === editedNovel.id) selectedNovel.value = updated
      ElMessage.success('小说信息更新成功')
      showEditDialog.value = false
      resetEditForm()
    } catch {
      ElMessage.error('小说信息尚未保存，修改内容已保留，请重试')
    } finally {
      isSavingEdit.value = false
    }
  }

  const editChapter = (chapter: WriterChapter) => {
    if (!selectedNovel.value) return
    showDetailsDialog.value = false
    void router.push({
      path: '/writer',
      query: { novelId: selectedNovel.value.id, chapterId: chapter.id },
    })
  }

  const generateDescription = async () => {
    const form = createForm.value
    const task = createDescriptionTask
    if (task.running.value) return
    const title = form.title.trim()
    if (!title || !form.genre) {
      ElMessage.warning('请先填写小说标题和类型')
      return
    }
    const genreInfo = genrePresets.value[form.genre]
    if (!genreInfo) {
      ElMessage.warning('所选小说类型已不存在')
      return
    }
    const prompt = `请为小说《${title}》生成一段简介。

小说信息：
- 标题：${title}
- 类型：${genreInfo.name}
- 标签：${genreInfo.tags.join('、')}

要求：
1. 简介长度控制在100-200字之间
2. 突出${genreInfo.name}类型的特色
3. 包含主角、背景设定、核心冲突等元素
4. 语言要吸引人，能激发读者的阅读兴趣
5. 风格要符合${genreInfo.name}小说的特点

请直接输出简介内容，不要包含其他解释文字：`
    await task.start({
      prompt,
      options: { maxTokens: null, temperature: 0.8, type: 'synopsis' },
      onText: (text) => {
        form.description = text
      },
      onSuccess: () => ElMessage.success('AI简介生成成功！您可以根据需要进行修改'),
      onError: async (_error, isCurrent) => {
        try {
          await ElMessageBox.confirm('AI生成失败，是否使用本地智能模板生成简介？', '生成选项', {
            confirmButtonText: '使用智能模板',
            cancelButtonText: '手动填写',
            type: 'info',
          })
          if (isCurrent()) generateDescriptionFromTemplate()
        } catch {
          if (isCurrent()) ElMessage.info('您可以手动填写简介，或稍后重试AI生成')
        }
      },
    })
  }

  // 备选方案：使用本地模板生成简介
  const generateDescriptionFromTemplate = () => {
    const title = createForm.value.title.trim()
    // 基于类型生成不同风格的简介模板
    const templates: Record<string, string[]> = {
      fantasy: [
        `${title}讲述了一个关于修仙与成长的传奇故事。在这个充满灵气与法宝的异世界中，主角将经历重重考验，突破境界桎梏，最终踏上巅峰之路。书中包含丰富的修炼体系、激烈的战斗场面，以及深刻的人性探索。`,
        `这是一部以${title}为名的玄幻巨作。故事背景设定在一个神秘的异世界，那里有着独特的修炼文明和强者为尊的法则。主角将在这个世界中历经磨难，收获友情、爱情与成长，书写属于自己的传奇。`,
        `${title}是一个关于勇气与梦想的修仙传说。在这个弱肉强食的修真世界里，主角凭借坚韧不拔的意志和独特的机缘，从一个普通人逐步成长为绝世强者，期间经历的种种冒险与情感纠葛构成了这部作品的精彩内核。`,
      ],
      urban: [
        `${title}是一部现代都市题材的力作，以当代社会为背景，描绘了主角在商场、职场、情场中的精彩人生。故事情节紧贴现实，人物形象鲜活生动，展现了现代都市生活的方方面面。`,
        `这是一个发生在繁华都市中的现代传奇。${title}以独特的视角展现了都市精英的奋斗历程，包含商战智慧、情感纠葛和人生感悟，是一部贴近现实又富有戏剧性的精彩作品。`,
        `${title}讲述了在这个快节奏的现代社会中，主角如何在激烈的竞争中脱颖而出的故事。作品融合了职场智慧、情感描写和社会现象的深度思考，展现了都市生活的真实面貌。`,
      ],
      history: [
        `${title}是一部恢弘的历史小说，以真实的历史背景为依托，通过主角的经历展现了那个时代的风云变幻。作品注重历史考证，人物刻画深入，战争场面宏大，是一部兼具文学价值和历史价值的佳作。`,
        `这是一个波澜壮阔的历史传奇。${title}以某个重要历史时期为背景，通过主角的视角展现了朝堂政治、军事战争、民间疾苦等多个层面，构建了一个真实而引人入胜的历史画卷。`,
        `${title}将读者带入了一个充满传奇色彩的历史年代。在那个英雄辈出的时代，主角将经历政治斗争、军事征战、文化碰撞，见证历史的变迁，书写属于自己的历史篇章。`,
      ],
      scifi: [
        `${title}是一部想象力丰富的科幻作品，设定在遥远的未来或广袤的宇宙中。故事融合了先进的科技概念、深刻的哲学思考和紧张刺激的冒险情节，展现了人类文明的无限可能。`,
        `这是一个关于未来与科技的宏大叙事。${title}通过主角在星际时代的经历，探讨了科技发展、人性本质、文明演进等深刻主题，是一部兼具娱乐性和思想性的科幻佳作。`,
        `${title}将读者带入了一个充满科技奇迹的未来世界。在这里，人工智能、星际航行、时空穿越等概念成为现实，主角将在这个充满无限可能的宇宙中展开史诗般的冒险。`,
      ],
      wuxia: [
        `${title}是一部经典的武侠小说，承载着深厚的江湖文化和武学传统。故事中有着精彩的武功描写、复杂的江湖恩怨、深刻的侠义精神，展现了一个充满豪情与柔情的武林世界。`,
        `这是一个侠骨柔情的江湖传说。${title}以武林为背景，通过主角的成长历程展现了江湖的险恶与温情、武学的精深与传承、侠客的义气与情怀，是一部充满武侠韵味的精彩作品。`,
        `${title}讲述了一个关于武功、情义与正邪的江湖故事。在这个刀光剑影的武林中，主角将学习绝世武功，结交生死兄弟，经历爱恨情仇，最终明悟侠道真谛。`,
      ],
      romance: [
        `${title}是一部温馨动人的言情小说，以细腻的笔触描绘了主角们的情感世界。故事情节跌宕起伏，人物情感真挚动人，展现了爱情的美好与复杂，是一部能够触动读者心灵的佳作。`,
        `这是一个关于爱情与成长的美丽故事。${title}通过主角们的相遇、相知、相爱的过程，展现了现代人的情感困惑与追求，用温暖的文字编织了一段动人的爱情童话。`,
        `${title}以爱情为主线，讲述了一段刻骨铭心的情感故事。作品中有欢声笑语，也有离别眼泪，有甜蜜温馨，也有误会波折，最终传达出关于爱情、成长和人生的深刻感悟。`,
      ],
    }

    // 随机选择一个模板
    const genreTemplates = templates[createForm.value.genre] || templates.fantasy
    const randomTemplate = genreTemplates[Math.floor(Math.random() * genreTemplates.length)]

    createForm.value.description = randomTemplate
    ElMessage.success('使用本地模板生成简介成功！')
  }

  // 全局重试也会提交当前页面的待存快照，列表必须同步，避免下一次操作覆盖刚恢复的数据。
  const handlePersistenceStatus = (status: NovelPersistenceStatus) => {
    if (status.phase === 'saved' && status.pending === 0) loadNovels()
  }

  let unsubscribePersistence = () => {}

  onMounted(() => {
    loadNovels()
    loadGenres()
    unsubscribePersistence = subscribeNovelPersistenceStatus(handlePersistenceStatus)
  })

  onUnmounted(() => unsubscribePersistence())

  return {
    editChapter,
    statusFilter,
    genreFilter,
    sortBy,
    searchKeyword,
    showCreateDialog,
    showDetailsDialog,
    showEditDialog,
    selectedNovel,
    activeTab,
    tagInput,
    editTagInput,
    createFormRef,
    editFormRef,
    isSavingEdit,
    isSavingNovels,
    novels,
    createForm,
    editForm,
    createDescriptionTask,
    editDescriptionTask,
    isGeneratingDescription,
    isGeneratingEditDescription,
    genrePresets,
    createRules,
    editRules,
    filteredNovels,
    getStatusType,
    getStatusText,
    getGenreDisplayName,
    formatNumber,
    formatDate,
    handleImageError,
    handleImageLoad,
    openNovel,
    viewNovelDetails,
    exportNovel,
    exportAllNovels,
    duplicateNovel,
    deleteNovel,
    addTag,
    removeTag,
    handleNativeFileChange,
    removeCover,
    createNovel,
    onGenreChange,
    resetCreateForm,
    editNovelInfo,
    resetEditForm,
    addEditTag,
    removeEditTag,
    handleEditFileChange,
    removeEditCover,
    generateEditDescription,
    updateNovelInfo,
    generateDescription,
  }
}
