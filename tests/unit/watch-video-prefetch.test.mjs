import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')

function slice(name, nextName) {
  const start = source.indexOf(`    ${name}`)
  return source.slice(start, source.indexOf(`\n    ${nextName}`, start))
}

function load(requests, { env = {}, options = [] } = {}) {
  return vm.runInNewContext(
    `({ ${slice('async reloadView(', 'getPendingVideoTitle:')} ${slice('prefetchLocalVideoInfo:', 'getVideoInformationLocal:')} })`,
    {
      initializeNetworkRecovery: () => ({ ready: Promise.resolve() }),
      getConnectionState: () => 'online',
      getLocalVideoInfo: async (videoId, requestOptions) => {
        requests.push(videoId)
        options.push(requestOptions)
        return { videoId }
      },
      supportsYtDlp: true,
      process: { env },
    }
  )
}

function watchFor(methods, { backendPreference = 'local', short = false } = {}) {
  let current = true
  let releaseRouteChange
  const watch = {
    ...methods,
    tabId: 'tab', videoId: 'previous001', videoLoadGeneration: 0, backendPreference,
    tabRoute: { params: { id: 'nextVideo01' }, query: short ? { short: 'true' } : {} },
    saveShortsPlaybackPosition() {},
    handleRouteChange: () => new Promise(resolve => { releaseRouteChange = resolve }),
    isCurrentVideoLoad: () => current,
    $store: { commit() {} },
  }
  return {
    watch,
    // Stop the reload after the route change; only the prefetch matters here.
    finish() { current = false; releaseRouteChange() },
  }
}

test('the next video is requested while the previous one is still saving its progress', async () => {
  const requests = []
  const { watch, finish } = watchFor(load(requests))
  const reloading = watch.reloadView()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(requests, ['nextVideo01'])
  finish()
  await reloading
})

for (const [label, options] of [['Shorts', { short: true }], ['Invidious', { backendPreference: 'invidious' }]]) {
  test(`${label} are not requested early`, async () => {
    const requests = []
    const { watch, finish } = watchFor(load(requests), options)
    const reloading = watch.reloadView()
    await new Promise(resolve => setImmediate(resolve))
    finish()
    await reloading
    assert.deepEqual(requests, [])
  })
}

test('on Android, the previous video\'s yt-dlp fallback does not skip the next video\'s PoToken', async () => {
  const requests = []
  const options = []
  const { watch, finish } = watchFor(load(requests, { env: { IS_CAPACITOR: true }, options }))
  Object.assign(watch, {
    videoPlaybackEngine: 'built-in',
    // The previous video fell back to yt-dlp; that resets only after its player is gone.
    isYtDlpPlaybackRequested: () => true,
  })
  const reloading = watch.reloadView()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(options[0].shouldGeneratePoToken(), true)
  watch.videoPlaybackEngine = 'yt-dlp'
  assert.equal(options[0].shouldGeneratePoToken(), false)
  finish()
  await reloading
})
