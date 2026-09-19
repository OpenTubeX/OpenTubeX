import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const cleanup = source.slice(source.indexOf('    async cleanupWatchRuntime()'), source.indexOf('\n    async reloadView(')).trim().replace(/,$/, '')
const destroy = source.slice(source.indexOf('    destroyPlayer: async function'), source.indexOf('\n    isSabrVideoStream()')).trim().replace(/,$/, '')

test('closing a watch tab releases its player even when saving progress finishes after unmount', async () => {
  let finishSave
  let released = false
  const player = { async destroyPlayer() { released = true; return {} } }
  const methods = vm.runInNewContext(`({${cleanup},${destroy}})`, { window: { removeEventListener() {} }, process: { env: { IS_CAPACITOR: true } } })
  const watch = {
    ...methods, $store: { commit() {} }, $refs: { player }, tabId: 'closing-tab',
    handleRouteChange: () => new Promise(resolve => { finishSave = resolve }),
    deactivateWatchRuntime() {},
  }
  const pending = watch.cleanupWatchRuntime()
  watch.$refs = {}
  finishSave()
  await pending
  assert.equal(released, true, 'native audio must stop after its tab is removed')
})

test('Back during fullscreen teardown cancels the captured restoration state', async () => {
  let finishDestroy
  let cancelTransition
  let cancelCalls = 0
  const player = {
    isFullscreen: true,
    destroyPlayer: () => new Promise(resolve => { finishDestroy = resolve }),
    cancelPendingFullscreen() { cancelCalls++ },
  }
  const methods = vm.runInNewContext(`({${destroy}})`, {
    process: { env: { IS_CAPACITOR: true } },
    beginAndroidFullscreenTransition(label, thumbnail, onCancel) {
      cancelTransition = onCancel
      return () => {}
    },
  })
  const watch = { ...methods, $refs: { player }, t: value => value, videoId: 'same', tabRoute: { params: { id: 'same' } } }
  const pending = watch.destroyPlayer()
  cancelTransition()
  finishDestroy({ startNextVideoInFullscreen: true })
  await pending
  assert.equal(cancelCalls, 1)
  assert.equal(watch.startNextVideoInFullscreen, false)
})

const utilsSource = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
const thumbnailSource = utilsSource.slice(utilsSource.indexOf('export function getVideoThumbnailUrl('), utilsSource.indexOf('/**', utilsSource.indexOf('export function getVideoThumbnailUrl('))).replace('export ', '')
const getVideoThumbnailUrl = vm.runInNewContext(`${thumbnailSource}; getVideoThumbnailUrl`)
for (const scenario of [
  { name: 'incoming video', id: 'incoming', expected: 'https://i.ytimg.com/vi/incoming/mqdefault.jpg' },
  { name: 'same-video reload', id: 'previous', expected: 'previous.webp' },
  { name: 'Invidious frame preference', id: 'incoming', backend: 'invidious', preference: 'middle', expected: 'https://invidious.example/vi/incoming/mq2.jpg' },
  { name: 'hidden thumbnails', id: 'incoming', preference: 'hidden', expected: null },
]) {
  test(`fullscreen replacement uses the poster for ${scenario.name}`, async () => {
    let shownThumbnail
    const methods = vm.runInNewContext(`({${destroy}})`, {
      process: { env: { IS_CAPACITOR: true } },
      getVideoThumbnailUrl,
      beginAndroidFullscreenTransition(label, thumbnail) {
        shownThumbnail = thumbnail
        return () => {}
      },
    })
    const watch = {
      ...methods, t: value => value, videoId: 'previous', thumbnail: 'previous.webp',
      tabRoute: { params: { id: scenario.id } },
      backendPreference: scenario.backend ?? 'local',
      currentInvidiousInstanceUrl: 'https://invidious.example',
      thumbnailPreference: scenario.preference ?? '',
      $refs: { player: { isFullscreen: true, async destroyPlayer() { return {} } } },
    }
    await watch.destroyPlayer()
    assert.equal(shownThumbnail, scenario.expected)
  })
}
