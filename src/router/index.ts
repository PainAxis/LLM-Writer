import { createRouter, createWebHashHistory } from 'vue-router'
import Dashboard from '@/views/Dashboard.vue'

const routes = [
  {
    path: '/',
    component: Dashboard,
    children: [
      { path: '', name: 'HomePage', component: () => import('@/views/HomePage.vue') },
      { path: 'prompts', name: 'PromptsLibrary', component: () => import('@/views/PromptsLibrary.vue') },
      { path: 'assistants', name: 'AssistantManagement', component: () => import('@/views/AssistantManagement.vue') },
      { path: 'novels', name: 'NovelManagement', component: () => import('@/views/NovelManagement.vue') },
      { path: 'goals', name: 'WritingGoals', component: () => import('@/views/WritingGoals.vue') },
      { path: 'billing', name: 'TokenBilling', component: () => import('@/views/TokenBilling.vue') },
      { path: 'config', name: 'ApiConfig', component: () => import('@/views/ApiConfig.vue') },
      { path: 'settings', name: 'Settings', component: () => import('@/views/Settings.vue') },
      { path: 'chapters', name: 'ChapterManagement', component: () => import('@/views/ChapterManagement.vue') },
      { path: 'writer', name: 'Writer', component: () => import('@/views/Writer.vue') },
      { path: 'genres', name: 'GenreManagement', component: () => import('@/views/GenreManagement.vue') },
      { path: 'tools', name: 'ToolsLibrary', component: () => import('@/views/ToolsLibrary.vue') },
      { path: 'short-story', name: 'ShortStory', component: () => import('@/views/ShortStory.vue') },
      { path: 'book-analysis', name: 'BookAnalysis', component: () => import('@/views/BookAnalysis.vue') },
      { path: 'mindmap', name: 'MindMap', component: () => import('@/views/MindMap.vue') },
      { path: ':pathMatch(.*)*', name: 'NotFound', component: () => import('@/views/NotFound.vue') },
    ],
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
