<template>
  <div id="app">
    <div v-if="persistence.phase === 'error'" class="persistence-error" role="alert">
      <div>
        <strong>{{ persistence.blocked ? '小说数据加载失败，已暂停打开项目' : '小说尚未保存成功' }}</strong>
        <p>{{ persistence.blocked ? '已保存的数据保留原样。请恢复存储访问后重试。' : '请保留此页面，恢复存储空间或权限后重试保存。' }}</p>
        <p class="persistence-detail">{{ persistence.error }}</p>
      </div>
      <el-button :loading="retrying" @click="retryPersistence">
        {{ persistence.blocked ? '重新加载' : '重试保存' }}
      </el-button>
    </div>
    <router-view v-if="!persistence.blocked" />
    
    <!-- 公告对话框 -->
    <AnnouncementDialog
      v-model:visible="showAnnouncement"
      :announcement="currentAnnouncement"
      @close="handleAnnouncementClose"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { getNovelPersistenceStatus, subscribeNovelPersistenceStatus, retryNovelPersistence } from './services/novelPersistence'
import AnnouncementDialog from './components/AnnouncementDialog.vue'
import { 
  hasNewAnnouncement, 
  getLatestAnnouncement, 
  markAnnouncementAsRead
} from './config/announcements.js'

const persistence = ref(getNovelPersistenceStatus())
const retrying = ref(false)
const unsubscribePersistence = subscribeNovelPersistenceStatus((value) => { persistence.value = value })
const warnBeforeUnload = (event) => {
  if (persistence.value.pending > 0 || (persistence.value.phase === 'error' && !persistence.value.blocked)) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => { window.addEventListener('beforeunload', warnBeforeUnload) })
onUnmounted(() => {
  unsubscribePersistence()
  window.removeEventListener('beforeunload', warnBeforeUnload)
})
const retryPersistence = async () => {
  retrying.value = true
  try {
    await retryNovelPersistence()
  } catch {
    // 后端状态保留具体错误；全局提示持续显示直到保存/加载成功。
  } finally {
    retrying.value = false
  }
}

// 公告相关状态
const showAnnouncement = ref(false)
const currentAnnouncement = ref({})

// 检查并显示公告
const checkAnnouncement = () => {
  try {
    if (hasNewAnnouncement()) {
      const latestAnnouncement = getLatestAnnouncement()
      currentAnnouncement.value = latestAnnouncement
      
      // 延迟显示，确保页面完全加载
      setTimeout(() => {
        showAnnouncement.value = true
      }, 1000)
    }
  } catch (error) {
    console.error('检查公告时出错:', error)
  }
}

// 处理公告关闭
const handleAnnouncementClose = () => {
  const version = currentAnnouncement.value.version
  
  // 标记为已读
  markAnnouncementAsRead(version)
  
  showAnnouncement.value = false
}

onMounted(() => {
  // 页面加载完成后检查公告
  if (!persistence.value.blocked) checkAnnouncement()
})
</script>

<style>
#app {
  width: 100%;
  height: 100vh;
}
.persistence-error {
  position: fixed;
  z-index: 3000;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: min(680px, calc(100vw - 32px));
  box-sizing: border-box;
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 16px;
  border: 1px solid var(--el-color-danger);
  border-radius: 8px;
  background: var(--el-bg-color);
  box-shadow: var(--el-box-shadow-light);
  color: var(--el-text-color-primary);
}
.persistence-error p { margin: 6px 0 0; font-size: 14px; }
.persistence-detail { color: var(--el-color-danger); overflow-wrap: anywhere; }
</style>
