/** Isolated driver build uses production transforms without rewriting generated source declarations. */
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { campaignBuildIdentity } from '../campaign-build-identity.mjs'
export function producerDriverBuildOptions(root, outDir, entry, onDriver = () => {}) {
  return { root, configFile: false, base: './', logLevel: 'silent',
    define: { __WRITER_CAMPAIGN_BUILD_IDENTITY__: JSON.stringify(campaignBuildIdentity(root)) },
    resolve: { alias: { '@': path.join(root, 'src') } },
    plugins: [vue(), AutoImport({ resolvers: [ElementPlusResolver()], imports: ['vue', 'vue-router', 'pinia'], dts: false }),
      Components({ resolvers: [ElementPlusResolver()], dts: false }),
      { name: 'body-producer-readiness-entry', generateBundle(_options, bundle) { for (const value of Object.values(bundle)) if (value.type === 'chunk' && value.facadeModuleId === entry) onDriver(value.fileName) } }],
    build: { outDir, emptyOutDir: true, rolldownOptions: { preserveEntrySignatures: 'exports-only', input: { 'body-producer-readiness-driver': entry } } },
  }
}

/** The real shipped index/main/App/router are built unchanged except for this
 * test-only composition root. The ordinary Vite config never loads this plugin. */
export function producerAppBuildOptions(root, outDir, endpoint, onControl = () => {}) {
  const url = new URL(endpoint)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/v1' || !url.port || url.username || url.password || url.search || url.hash || url.href !== endpoint) throw new Error('producer_app_loopback_required')
  const options = producerDriverBuildOptions(root, outDir, path.join(root, 'index.html'))
  options.plugins.unshift({ name: 'body-producer-controlled-app-host', enforce: 'pre', transform(code, id) {
    if (id !== path.join(root, 'src/main.ts')) return null
    const marker = 'const app = createApp(App)'
    if (code.split(marker).length !== 2) throw new Error('producer_app_composition_root_changed')
    return { code: `import { installBodyProducerApp } from '/scripts/fixtures/writer-body-producer-app.ts'\n${code.replace(marker, `${marker}\nawait installBodyProducerApp(app, ${JSON.stringify(endpoint)})`)}`, map: null }
  } })
  const control = path.join(root, 'scripts/fixtures/writer-body-producer-app.ts')
  options.plugins.push({ name: 'body-producer-app-control-entry', generateBundle(_options, bundle) { for (const value of Object.values(bundle)) if (value.type === 'chunk' && value.facadeModuleId === control) onControl(value.fileName) } })
  options.build.rolldownOptions = { preserveEntrySignatures: 'exports-only', input: { app: path.join(root, 'index.html'), 'body-producer-app-control': control } }
  return options
}
