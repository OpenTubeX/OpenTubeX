import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { createNetworkRecovery } from '../../src/renderer/helpers/networkRecovery.js'

const source = readFileSync(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const start = source.indexOf('    getVideoInformationLocal: async function (')
const end = source.indexOf('\n    async runIpBlockRecoveryScriptAndReload()', start)
const methodsSource = source.slice(start, end)
const currentLoadStart = source.indexOf('    isCurrentVideoLoad: function (')
const currentLoadSource = source.slice(currentLoadStart, source.indexOf('\n    isYtDlpPlaybackRequested:', currentLoadStart))

for (const backend of ['local', 'invidious']) {
  for (const scenario of ['reconnect', 'navigate away', 'downloaded playback']) {
    test(`${backend} watch opened offline handles ${scenario}`, async t => {
      let online = false
      const events = new EventTarget()
      const recovery = createNetworkRecovery({ eventTarget: events, isOnline: () => online })
      t.after(() => recovery.dispose())
      let requests = 0
      const request = () => recovery.run('https://video.example', async () => {
        requests++
        throw new Error('Video unavailable')
      })
      const methods = vm.runInNewContext(`({${methodsSource}${currentLoadSource}})`, {
        initializeNetworkRecovery: () => recovery,
        getConnectionState: () => recovery.state,
        getLocalVideoInfo: request,
        invidiousGetVideoInformation: request,
        process: { env: { SUPPORTS_LOCAL_API: true } },
        console: { error() {} },
      })
      const watch = {
        ...methods,
        firstLoad: true,
        isLoading: true,
        videoLoadGeneration: 1,
        tabRoute: { params: { id: 'offline-video' } },
        backendPreference: backend,
        backendFallback: false,
        customShortsPlayerActive: false,
        finishDownloadedPlaybackWithoutMetadata() {
          if (scenario !== 'downloaded playback') return false
          this.isLoading = false
          return true
        },
        runIpBlockRecoveryScriptAndReload: async () => false,
        getRestrictedPlaybackErrorType: () => null,
        getUnavailableVideoThumbnail: () => 'unavailable.png',
      }
      const load = backend === 'local'
        ? watch.getVideoInformationLocal(1)
        : watch.getVideoInformationInvidious(1)
      for (let i = 0; i < 20; i++) await Promise.resolve()
      assert.equal(requests, 0, 'metadata requests must wait while offline')
      assert.equal(watch.isLoading, scenario !== 'downloaded playback')
      if (scenario === 'navigate away') {
        watch.videoLoadGeneration++
        watch.tabRoute.params.id = 'another-video'
      }
      online = true
      events.dispatchEvent(new Event('online'))
      await load
      assert.equal(requests, scenario === 'downloaded playback' ? 0 : 1)
      assert.equal(watch.isLoading, scenario === 'navigate away', 'only the current watch request may replace its skeleton')
      assert.equal(watch.errorMessage, scenario === 'reconnect' ? 'Video unavailable' : undefined)
    })
  }
}
