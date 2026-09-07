import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      imports: ['vue', 'vue-router', 'pinia'],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 7520,
    open: true,
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Rolldown 默认递归收集分组依赖。先分配 Vue，再分配 UI 和编辑器，
          // 防止 Vue runtime 被编辑器收走，导致首页反向加载整个编辑器。
          groups: [
            {
              name: 'vendor-vue',
              test: /[/\\]node_modules[/\\](?:@vue[/\\]|vue[/\\]|vue-router[/\\]|pinia[/\\])/,
              priority: 30,
            },
            {
              name: 'vendor-element',
              test: /[/\\]node_modules[/\\](?:element-plus[/\\]|@element-plus[/\\])/,
              priority: 20,
            },
            {
              name: 'vendor-editor',
              test: /[/\\]node_modules[/\\]@wangeditor[/\\]/,
              priority: 10,
            },
          ],
          // 其余依赖按实际引用拆分，保留 AI SDK、导图等动态 import 的边界。
          // 不使用 vendor-misc 兜底混装首页依赖和功能页依赖。
        },
      },
    },
  },
})
