import assert from 'node:assert/strict'
import test from 'node:test'
import { createWatchPlayerRecovery } from '../../src/renderer/views/Watch/watchPlayerRecovery.js'

const recoveryDependencies = {
  supportsYtDlp: false,
  shaka: {},
  checkYtDlpPlaybackUrl: async () => 'inconclusive',
  invalidateYtDlpPlaybackSource() {},
  MANIFEST_TYPE_SABR: 'sabr',
}

test('stream recovery saves progress and schedules one reload', async () => {
  const toasts = []
  let saves = 0
  let reloads = 0
  const view = {
    ...createWatchPlayerRecovery(recoveryDependencies),
    streamErrorReloadAttemptedForCurrentVideo: false,
    handleWatchProgressAutoSaveWhenProgressEnabled() { saves++ },
    showTabToast(toast) { toasts.push(toast) },
    t: key => key,
    async reloadView() { reloads++ },
  }
  assert.equal(await view.reloadAfterStreamErrorOnce('expired'), true)
  assert.equal(await view.reloadAfterStreamErrorOnce('expired'), false)
  assert.equal(saves, 1)
  assert.equal(reloads, 1)
  assert.equal(toasts.length, 1)
})

test('player recovery aligns format with available sources', () => {
  const view = {
    ...createWatchPlayerRecovery(recoveryDependencies),
    activeFormat: 'dash', manifestSrc: null, legacyFormats: [{}], audioFormatAvailable: false,
  }
  view.alignActiveFormatWithAvailableSources()
  assert.equal(view.activeFormat, 'legacy')
})
