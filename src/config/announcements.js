// 公告配置文件
import { storageGetRaw, storageSetRaw, StorageKeys } from '@/utils/storage'

export const announcements = [
  {
    id: 'v1.0.0',
    version: '1.0.0',
    title: '🎉 欢迎使用 LLM-Writer',
    date: '2026-09-02',
    priority: 1, // 优先级，数字越大越重要
    content: `
# 🎉 欢迎使用 LLM-Writer

## 💡 快速开始

1. 在右上角 **API配置** 中填入您的 API 密钥与服务地址
2. 支持 **OpenAI 兼容格式** 的所有大模型接口（含本地部署的 ollama / lmstudio 等）
3. 创建小说项目，开始创作

## ✨ 核心功能

- **智能章节生成**：AI 帮您构思和生成章节内容
- **AI 续写与润色**：流式输出，随时中断
- **角色设定助手**：快速创建丰富的角色设定
- **世界观构建**：构建完整的小说世界观
- **写作目标跟踪**：掌控您的创作进度

## 🔒 隐私说明

本项目为纯前端应用，所有数据仅保存在您的浏览器本地，API 密钥不会上传到任何第三方服务器。

---

**祝您创作愉快！** ✍️
    `
  }
]

// 获取最新公告
export function getLatestAnnouncement() {
  return announcements
    .sort((a, b) => b.priority - a.priority)
    .find(announcement => announcement.priority > 0) || announcements[0]
}

// 获取指定版本的公告
export function getAnnouncementByVersion(version) {
  return announcements.find(announcement => announcement.version === version)
}

// 检查是否有新版本公告
export function hasNewAnnouncement() {
  const lastReadVersion = storageGetRaw(StorageKeys.lastReadAnnouncementVersion)
  const latestAnnouncement = getLatestAnnouncement()

  if (!lastReadVersion) {
    return true
  }

  return lastReadVersion !== latestAnnouncement.version
}

// 标记公告为已读
export function markAnnouncementAsRead(version) {
  storageSetRaw(StorageKeys.lastReadAnnouncementVersion, version)
  storageSetRaw(StorageKeys.lastReadAnnouncementDate, new Date().toISOString())
}

// 获取用户统计信息
export function getAnnouncementStats() {
  return {
    lastReadVersion: storageGetRaw(StorageKeys.lastReadAnnouncementVersion),
    lastReadDate: storageGetRaw(StorageKeys.lastReadAnnouncementDate)
  }
}
