/** Index resolution regression, without building or launching a browser. */
import assert from 'node:assert/strict'
import { assertCreativeIndexAssets, creativeAppBuildOptions } from './lib/creative-pilot-build.mjs'
const html = Buffer.from('<script type="module" src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css">')
const assets = new Map([['/normal/', html], ['/assets/app.js', Buffer.from('')], ['/assets/app.css', Buffer.from('')]])
assert.throws(() => assertCreativeIndexAssets(assets, '/normal/'))
assets.set('/normal/assets/app.js', Buffer.from('')); assets.set('/normal/assets/app.css', Buffer.from(''))
assert.equal(assertCreativeIndexAssets(assets, '/normal/'), 2)
assert.throws(() => creativeAppBuildOptions(process.cwd(), '/tmp/unused', 'https://example.invalid/v1'))
console.log(JSON.stringify({ status: 'pass', scope: 'build_asset_resolution', groups: 3, browserLaunches: 0 }))
