import assert from 'node:assert/strict'
import test from 'node:test'

import { IpcChannels } from '../../src/constants.js'
import { registerSystemInfoIpc } from '../../src/main/systemInfoIpc.js'

function setup() {
  const registrations = new Map()
  let distributionCalls = 0
  registerSystemInfoIpc({
    ipcMain: { handle: (channel, handler) => registrations.set(channel, handler) },
    app: { getSystemLocale: () => 'de-DE' },
    isTrustedUrl: url => url === 'app://bundle/index.html',
    hostname: () => 'desktop',
    release: () => 'kernel',
    getLinuxDistributionInfo: async () => {
      distributionCalls += 1
      return { platform: 'Arch Linux', release: 'rolling' }
    },
    getFonts: async () => [' Figtree ', 'Figtree', '', null, 'Geist'],
    platform: 'linux',
    architecture: 'x64',
    isWaylandPlatform: true,
    supportsAutoPictureInPictureMinimize: Promise.resolve(false)
  })
  return {
    registrations,
    event: { senderFrame: { url: 'app://bundle/index.html' } },
    getDistributionCalls: () => distributionCalls
  }
}

test('system information IPC returns desktop details and unique font names', async () => {
  const { registrations, event } = setup()
  assert.equal(await registrations.get(IpcChannels.GET_DEVICE_NAME)(event), 'desktop')
  assert.deepEqual(await registrations.get(IpcChannels.GET_DEVICE_INFO)(event), {
    platform: 'Arch Linux', architecture: 'x64', release: 'rolling'
  })
  assert.equal(await registrations.get(IpcChannels.GET_SYSTEM_LOCALE)(event), 'de-DE')
  assert.deepEqual(await registrations.get(IpcChannels.GET_SYSTEM_FONTS)(event), ['Figtree', 'Geist'])
  assert.equal(await registrations.get(IpcChannels.IS_WAYLAND_PLATFORM)(event), true)
  assert.equal(await registrations.get(IpcChannels.SUPPORTS_AUTO_PICTURE_IN_PICTURE_MINIMIZE)(event), false)
})

test('system information IPC does not expose information to untrusted frames', async () => {
  const { registrations, event, getDistributionCalls } = setup()
  event.senderFrame.url = 'https://example.com'
  for (const channel of [
    IpcChannels.GET_DEVICE_NAME,
    IpcChannels.GET_DEVICE_INFO,
    IpcChannels.GET_SYSTEM_LOCALE,
    IpcChannels.IS_WAYLAND_PLATFORM,
    IpcChannels.SUPPORTS_AUTO_PICTURE_IN_PICTURE_MINIMIZE
  ]) {
    assert.equal(await registrations.get(channel)(event), undefined)
  }
  assert.deepEqual(await registrations.get(IpcChannels.GET_SYSTEM_FONTS)(event), [])
  assert.equal(getDistributionCalls(), 0)
})
