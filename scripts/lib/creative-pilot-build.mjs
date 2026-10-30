/** Controlled composition root only; no generated declarations or production entry edits. */
import path from 'node:path'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { campaignBuildIdentity } from '../campaign-build-identity.mjs'
export function creativeAppBuildOptions(root, outDir, endpoint, onControl = () => {}) {
  const url = new URL(endpoint)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/v1' || !url.port || url.username || url.password || url.search || url.hash || url.href !== endpoint) throw new Error('creative_app_loopback_required')
  const control = path.join(root, 'scripts/lib/creative-pilot-app.ts')
  return { root, configFile: false, base: '/controlled/', logLevel: 'silent', define: { __WRITER_CAMPAIGN_BUILD_IDENTITY__: JSON.stringify(campaignBuildIdentity(root)) }, resolve: { alias: { '@': path.join(root, 'src') } },
    plugins: [{ name: 'creative-pilot-controlled-app', enforce: 'pre', transform(code, id) {
      if (id !== path.join(root, 'src/main.ts')) return null
      const marker = 'const app = createApp(App)'
      if (code.split(marker).length !== 2) throw new Error('creative_app_composition_root_changed')
      return { code: `import { installCreativePilotApp } from '/scripts/lib/creative-pilot-app.ts'\n${code.replace(marker, `${marker}\nawait installCreativePilotApp(app, ${JSON.stringify(endpoint)})`)}`, map: null }
    } }, vue(), AutoImport({ resolvers: [ElementPlusResolver()], imports: ['vue', 'vue-router', 'pinia'], dts: false }), Components({ resolvers: [ElementPlusResolver()], dts: false }),
    { name: 'creative-pilot-control-entry', generateBundle(_options, bundle) { for (const value of Object.values(bundle)) if (value.type === 'chunk' && value.facadeModuleId === control) onControl(value.fileName) } }],
    build: { outDir, emptyOutDir: true, rolldownOptions: { preserveEntrySignatures: 'exports-only', input: { app: path.join(root, 'index.html'), 'creative-pilot-app-control': control } } },
  }
}

/** Resolve the emitted index's local script/styles exactly as a browser would. */
export function assertCreativeIndexAssets(assets, prefix) {
  const index = assets.get(prefix) ?? assets.get(prefix + 'index.html')
  if (!index) throw new Error('creative_index_missing')
  const html = index.toString('utf8'), base = new URL(prefix, 'http://127.0.0.1:1')
  let checked = 0
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    const attribute = tag[0].match(/\b(?:src|href)=["']([^"']+)["']/)
    if (!attribute) continue
    const url = new URL(attribute[1], base)
    if (url.origin !== base.origin || !assets.has(url.pathname)) throw new Error('creative_index_asset_missing')
    checked++
  }
  if (checked === 0) throw new Error('creative_index_has_no_assets')
  return checked
}
