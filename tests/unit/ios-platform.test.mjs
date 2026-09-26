import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'

async function helper(name, exports, ios = true) {
  const registrations = []
  const calls = []
  const source = (await readFile(new URL(`../../src/renderer/helpers/${name}.js`, import.meta.url), 'utf8'))
    .replace(/^import .*\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({
    process: { env: { IS_CAPACITOR: true, IS_IOS: ios } },
    registerPlugin: name => {
      registrations.push(name)
      return new Proxy({}, { get: (_, method) => async options => {
        calls.push({ name, method, options })
        return { remove() {}, attached: true }
      } })
    },
    ref: value => ({ value }),
    Capacitor: { getPlatform: () => ios ? 'ios' : 'android', isNativePlatform: () => true, isPluginAvailable: () => false },
    createSubscriptionRefreshStartController: () => ({}),
    Promise,
    console,
  })
  vm.runInContext(`${source}\nglobalThis.result = {${exports.join(',')}}`, context)
  return { ...context.result, registrations, calls }
}

test('iOS startup does not register Android UI, dynamic colors or background workers', async () => {
  const ui = await helper('androidUi', ['getAndroidHardwareKeyboardState', 'getAndroidDeviceArchitecture', 'exitAndroidApp'])
  assert.equal(await ui.getAndroidHardwareKeyboardState(), true)
  assert.equal((await ui.getAndroidDeviceArchitecture()).architecture, '')
  await ui.exitAndroidApp()
  assert.deepEqual(ui.registrations, ['IOSUi'])
  assert.deepEqual(ui.calls.map(call => call.method), ['getHardwareKeyboardState'])
  const colors = await helper('dynamicColors', ['getAndroidDynamicColors'])
  assert.equal((await colors.getAndroidDynamicColors()).supported, false)
  assert.deepEqual(colors.registrations, [])
  const refresh = await helper('androidSubscriptionRefresh', ['isAndroidSubscriptionRefreshActive', 'getNextAndroidSubscriptionRefreshResult', 'configureAndroidSubscriptionRefresh', 'startAndroidSubscriptionRefresh'])
  assert.equal(await refresh.isAndroidSubscriptionRefreshActive(), false)
  assert.equal(await refresh.getNextAndroidSubscriptionRefreshResult(), null)
  await refresh.configureAndroidSubscriptionRefresh({})
  assert.equal((await refresh.startAndroidSubscriptionRefresh('test', 'Refresh', 'Cancel')).acquired, true)
  assert.deepEqual(refresh.registrations, [])
})

test('iOS media controls and file operations dispatch to their own native services', async () => {
  const media = await helper('androidMediaSession', ['addAndroidMediaSessionActionListener'])
  const remove = await media.addAndroidMediaSessionActionListener(() => {})
  await remove()
  assert.deepEqual(media.registrations, ['IOSMediaSession'])
  const storage = await helper('androidStorage', ['clearAndroidCache'])
  await storage.clearAndroidCache()
  assert.deepEqual(storage.registrations, ['IOSStorage'])
  assert.equal(storage.calls[0].method, 'clearCache')
})

test('iOS folder preferences display the selected name instead of bookmark data', async () => {
  const storage = await helper('androidStorage', ['displayAndroidPath'])
  assert.equal(storage.displayAndroidPath(JSON.stringify({ name: 'Screenshots', bookmark: 'private-bookmark' })), 'Screenshots')
  assert.equal(storage.displayAndroidPath(''), '')
})

test('unsupported iOS proxy configuration rejects instead of pretending it applied', async () => {
  const proxy = await helper('androidProxy', ['configureAndroidProxy', 'readAndroidProxySettings'])
  await assert.rejects(proxy.configureAndroidProxy({ useProxy: true }), /unavailable on iOS/)
  await proxy.configureAndroidProxy({ useProxy: false })
  assert.equal(await proxy.readAndroidProxySettings(), null)
  assert.deepEqual(proxy.registrations, [])
})

test('Android keeps its native platform implementations', async () => {
  for (const [name, plugin] of [['androidUi', 'AndroidUi'], ['androidMediaSession', 'AndroidMediaSession'], ['androidStorage', 'AndroidStorage'], ['androidProxy', 'AndroidProxy'], ['androidSubscriptionRefresh', 'SubscriptionRefresh']]) {
    const result = await helper(name, [], false)
    assert.deepEqual(result.registrations, [plugin])
  }
})

test('iOS pauses on app hiding when background playback is disabled', async () => {
  const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
  const handler = source.match(/function handleMobileAdjustmentsVisibility\(\) \{[\s\S]*?\n    \}/)?.[0]
  assert.ok(handler)
  for (const [ios, hidden, continuePlaying, expectedPauses] of [
    [true, true, false, 1], [true, true, true, 0],
    [true, false, false, 0], [false, true, false, 0],
  ]) {
    let pauses = 0
    const context = vm.createContext({
      process: { env: { IS_IOS: ios } },
      isAppHidden: () => hidden,
      mobileAdjustmentsVisible: { value: true },
      store: { getters: { getContinuePlaybackWhenScreenIsLocked: continuePlaying } },
      video: { value: { pause: () => pauses++ } },
    })
    vm.runInContext(`${handler}\nhandleMobileAdjustmentsVisibility()`, context)
    assert.equal(pauses, expectedPauses)
    assert.equal(context.mobileAdjustmentsVisible.value, !hidden)
  }
})


test('iOS webpack configuration loads with the current shared build rules', async () => {
  await promisify(execFile)(process.execPath, ['-e', `
    const assert = require('node:assert/strict')
    const configs = require('./_scripts/webpack.ios.config.js')
    assert.equal(process.env.CAPACITOR_PLATFORM, 'ios')
    assert.deepEqual(configs.map(config => config.name), ['capacitor', 'capacitorBotGuardScript'])
  `], { cwd: new URL('../../', import.meta.url) })
})
