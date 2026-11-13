import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

import { sourceUrl } from '../helpers/module-stubs.mjs'

// The mobile bridge loads with a dynamic import, which the hooks have to
// cover after the module loaded, so they stay registered for this file
const bridge = { calls: 0, fetch: () => new Promise(() => {}) }
globalThis.__platformFetchBridge = bridge
const stubs = {
  [sourceUrl('src/renderer/helpers/ytDlp.js')]: 'export const fetchMobileRumblePage = url => { globalThis.__platformFetchBridge.calls++; return globalThis.__platformFetchBridge.fetch(url) }',
  [sourceUrl('src/renderer/helpers/rssHub.js')]: 'export const appFetch = () => { throw new Error("Unexpected request") }'
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = specifier.startsWith('.') && !/\.m?js$/.test(specifier)
      ? nextResolve(`${specifier}.js`, context)
      : nextResolve(specifier, context)
    return Object.hasOwn(stubs, resolved.url)
      ? { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(stubs[resolved.url])}` }
      : resolved
  }
})
const { getPlatformFetch } = await import(sourceUrl('src/renderer/helpers/platformFetch.js'))

test('stops waiting for a mobile Rumble page once its request aborts', async (t) => {
  const env = process.env
  process.env = { ...env, IS_CAPACITOR: 'true' }
  t.after(() => { process.env = env })
  const fetch = getPlatformFetch('rumble')
  const url = 'https://rumble.com/c/Example'

  // Aborted while the bridge loads, so it doesn't request the page
  const early = new AbortController()
  const loading = fetch(url, { signal: early.signal })
  early.abort()
  await assert.rejects(loading, { name: 'AbortError' })
  assert.equal(bridge.calls, 0)

  // The bridge can't cancel a page it loads, which never ends here
  const late = new AbortController()
  const waiting = fetch(url, { signal: late.signal })
  while (bridge.calls === 0) await new Promise(resolve => setImmediate(resolve))
  late.abort()
  await assert.rejects(waiting, { name: 'AbortError' })

  bridge.fetch = async () => ({ status: 200, text: '<html></html>' })
  const page = await fetch(url, { signal: new AbortController().signal })
  assert.equal(page.status, 200)
  assert.equal(await page.text(), '<html></html>')
})
