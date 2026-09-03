import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import router from './router'
import App from './App.vue'
import './style.css'
import { initTheme } from './composables/useTheme'
import { initNovelPersistence } from './services/novelPersistence'

// 挂载前应用主题，避免暗色模式首帧闪烁
initTheme()

const app = createApp(App)
const pinia = createPinia()

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(pinia)
app.use(router)
app.use(ElementPlus)

// 挂载前完成小说数据 hydrate（IndexedDB 分层），保证视图同步读取时数据就绪
async function bootstrap(): Promise<void> {
  try {
    await initNovelPersistence()
  } catch (error) {
    console.error('数据层初始化失败，将以降级模式运行:', error)
  }
  app.mount('#app')
}

void bootstrap()
