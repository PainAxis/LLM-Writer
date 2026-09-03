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
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('element-plus') || id.includes('@element-plus')) return 'vendor-element'
          if (id.includes('@wangeditor')) return 'vendor-editor'
          // AI SDK 仅通过动态 import 使用：不分配静态 chunk，让其独立按需加载
          if (id.includes('/node_modules/ai/') || id.includes('@ai-sdk') || id.includes('/node_modules/zod')) {
            return undefined
          }
          // mind-elixir 导图库仅思维导图页动态使用：独立按需加载
          if (id.includes('mind-elixir')) {
            return undefined
          }
          if (
            id.includes('/vue/') ||
            id.includes('vue-router') ||
            id.includes('/pinia/') ||
            id.includes('@vue/')
          ) {
            return 'vendor-vue'
          }
          return 'vendor-misc'
        },
      },
    },
  },
})
