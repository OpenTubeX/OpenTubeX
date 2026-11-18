import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = (await readFile(new URL('../../src/renderer/helpers/capacitorUi.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '')

function loadUi(platform, ScreenOrientation, SettingsLauncher) {
  const exports = '{ setFullscreenOrientation, openNotificationSettings }'
  return vm.runInNewContext(`${source}\n(${exports})`, {
    Capacitor: { isNativePlatform: () => platform !== 'web' },
    OrientationType: { LANDSCAPE: 'landscape' },
    ScreenOrientation,
    SettingsLauncher,
  })
}

for (const platform of ['android']) {
  test(`${platform} locks landscape playback and releases orientation for other player states`, async () => {
    const calls = []
    const ui = loadUi(platform, {
      lock: async ({ type }) => calls.push(type),
      unlock: async () => calls.push('unlock'),
    })
    const landscape = { videoWidth: 1920, videoHeight: 1080 }
    await ui.setFullscreenOrientation(true, landscape)
    await ui.setFullscreenOrientation(false, landscape)
    await ui.setFullscreenOrientation(true, landscape, false)
    await ui.setFullscreenOrientation(true, { videoWidth: 1080, videoHeight: 1920 })
    await ui.setFullscreenOrientation(true, { videoWidth: 1080, videoHeight: 1080 })
    await ui.setFullscreenOrientation(true, null)
    assert.deepEqual(calls, ['landscape', 'unlock', 'unlock', 'unlock', 'unlock'])
  })

  test(`${platform} retains the fullscreen orientation while replacement dimensions are unknown`, async () => {
    const calls = []
    const ui = loadUi(platform, {
      lock: async ({ type }) => calls.push(type),
      unlock: async () => calls.push('unlock'),
    })
    await ui.setFullscreenOrientation(true, { videoWidth: 1920, videoHeight: 1080 })
    await ui.setFullscreenOrientation(true, { videoWidth: 0, videoHeight: 0 })
    assert.deepEqual(calls, ['landscape'])
    await ui.setFullscreenOrientation(true, { videoWidth: 1280, videoHeight: 720 })
    await ui.setFullscreenOrientation(false, null)
    assert.deepEqual(calls, ['landscape', 'landscape', 'unlock'])
  })

  test(`${platform} falls back to app settings when notification settings are unavailable`, async () => {
    const calls = []
    const ui = loadUi(platform, {}, {
      openNotificationSettings: async () => {
        calls.push('notifications')
        throw new Error('Notification settings unavailable')
      },
      openAppSettings: async () => calls.push('app'),
    })
    await ui.openNotificationSettings()
    assert.deepEqual(calls, ['notifications', 'app'])
  })
}

test('fullscreen uses the known aspect ratio before video dimensions arrive', async () => {
  const calls = []
  const ui = loadUi('android', {
    lock: async ({ type }) => calls.push(type), unlock: async () => calls.push('unlock'),
  })
  const loadingVideo = { videoWidth: 0, videoHeight: 0 }

  await ui.setFullscreenOrientation(true, loadingVideo, true, 16 / 9)
  await ui.setFullscreenOrientation(true, loadingVideo, true, 9 / 16)
  await ui.setFullscreenOrientation(false, loadingVideo, true, 16 / 9)

  assert.deepEqual(calls, ['landscape', 'unlock', 'unlock'])
})
