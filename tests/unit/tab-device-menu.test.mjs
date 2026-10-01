import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = (await readFile(new URL('../../src/renderer/helpers/tab-device-menu.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace('export function', 'function')

function setup({ enabled = true, live = true, devices = [{ id: 'laptop', name: 'Laptop', platform: 'linux' }], error = null } = {}) {
  const calls = []
  const toasts = []
  const context = vm.createContext({
    store: {
      getters: { getSyncServerEnabled: enabled, getSyncServerLiveSupported: live, getSyncServerDevices: devices },
      async dispatch(action, request) {
        calls.push({ action, ...request })
        if (error) throw new Error(error)
      },
    },
    formatTabTitle: title => title,
    getSyncServerDeviceIcon: platform => ['fas', platform === 'android' ? 'smartphone' : 'display'],
    showToast: toast => toasts.push(toast),
  })
  vm.runInContext(source, context)
  return { menu: tabs => context.getTabDeviceMenuItem(tabs, key => key), calls, toasts }
}

const video = { route: { fullPath: '/watch/jNQXAC9IVRw?timestamp=12' }, title: 'Video', contentTitle: 'Video title' }

for (const options of [{ enabled: false }, { live: false }]) {
  test(`device menu requires live sync: ${JSON.stringify(options)}`, () => {
    assert.equal(setup(options).menu([video]), null)
  })
}

test('device menu only offers video tabs and disables an empty device list', () => {
  const { menu } = setup({ devices: [] })
  assert.equal(menu([]), null)
  assert.equal(menu([{ route: { fullPath: '/channel/test' } }]), null)
  assert.equal(menu([{ route: { fullPath: '/watch/invalid' } }]), null)
  assert.equal(menu([video, { route: { fullPath: '/history' } }]), null)
  assert.equal(menu([video]).enabled, false)
})

test('device menu sends every selected video with its title to the chosen device', async () => {
  const { menu, calls, toasts } = setup()
  const item = menu([video, { route: { fullPath: '/watch/aqz-KE-bpKQ' }, title: 'Second video' }])
  assert.equal(item.enabled, true)
  assert.equal(item.submenu[0].label, 'Laptop')
  assert.deepEqual([...item.submenu[0].icon], ['fas', 'display'])
  await item.submenu[0].run()
  assert.deepEqual(calls, [
    { action: 'sendSyncServerVideo', recipient: 'laptop', videoId: 'jNQXAC9IVRw', title: 'Video title' },
    { action: 'sendSyncServerVideo', recipient: 'laptop', videoId: 'aqz-KE-bpKQ', title: 'Second video' },
  ])
  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].message, 'Settings.Sync Settings.Video Sent')
})

test('device menu reports a send failure', async () => {
  const { menu, calls, toasts } = setup({ error: 'Device unavailable' })
  await menu([video]).submenu[0].run()
  assert.equal(calls.length, 1)
  assert.equal(toasts[0].message, 'Device unavailable')
  assert.deepEqual([...toasts[0].icon], ['fas', 'circle-exclamation'])
})
