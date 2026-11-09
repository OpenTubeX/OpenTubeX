import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { ANDROID_PROXY_SETTING_KEYS } from '../../src/renderer/helpers/androidProxy.js'

const source = await readFile(new URL('../../src/renderer/store/modules/settings.js', import.meta.url), 'utf8')

function fixture(configure, { failWrite = false, persisted = null, permission = async () => {} } = {}) {
  const writes = []
  const errors = []
  const context = vm.createContext({
    process: { env: { IS_CAPACITOR: true } },
    ANDROID_PROXY_SETTING_KEYS,
    configureAndroidProxy: configure,
    ensureAndroidLocalNetworkAccess: permission,
    readAndroidProxySettings: async () => persisted,
    defaultUpdaterId: key => key,
    defaultMutationId: key => key,
    DBSettingHandlers: { upsert: async (key, value) => {
      if (failWrite) throw new Error('Renderer database is full')
      writes.push([key, value])
    } },
    showToast: toast => errors.push(toast),
    i18n: { global: { t: key => key } },
  })
  const start = source.indexOf('let androidProxyUpdate =')
  const end = source.indexOf('  async mergeSubscriptionSeenVideos(')
  assert.ok(start !== -1 && end > start, 'Expected Android proxy action anchors in settings.js')
  vm.runInContext(source.slice(start, end) + '\n};globalThis.actions = customActions', context)
  const state = { useProxy: false, proxyHostname: 'old', proxyPort: '9050', proxyProtocol: 'socks5' }
  return {
    writes,
    errors,
    state,
    wait: () => context.actions.waitForAndroidProxySettings(),
    restore: () => context.actions.loadAndroidProxySettings({ commit: (key, value) => { state[key] = value } }),
    update: (key, value) => context.actions[key]({ state, commit: (key, value) => { state[key] = value } }, value),
  }
}

test('Android proxy edits apply natively before saving and serialize across fields', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const applied = []
  const settings = fixture(async value => { applied.push(value); await gate })
  const enable = settings.update('useProxy', true)
  const host = settings.update('proxyHostname', 'new')
  const port = settings.update('proxyPort', '1080')
  let appliedAll = false
  const ready = settings.wait().then(() => { appliedAll = true })
  await Promise.resolve()
  assert.equal(applied.length, 1)
  assert.equal(applied[0].useProxy, true)
  assert.deepEqual(settings.writes, [])
  assert.equal(appliedAll, false)
  release()
  await Promise.all([enable, host, port, ready])
  assert.equal(appliedAll, true)
  assert.equal(applied[1].useProxy, true)
  assert.equal(applied[2].proxyHostname, 'new')
  assert.equal(applied[2].proxyPort, '1080')
  assert.equal(settings.state.proxyHostname, 'new')
  assert.equal(settings.state.useProxy, true)
})

test('a failed renderer database write cannot hide an enabled native proxy', async () => {
  const settings = fixture(async () => {}, { failWrite: true })
  await settings.update('useProxy', true)
  assert.equal(settings.state.useProxy, true)
  assert.equal(settings.errors.length, 1)
})

test('denied LAN access keeps proxy edits visible and subsequent edits use the saved host', async () => {
  const applied = []
  const settings = fixture(async value => { applied.push(value) }, {
    permission: async () => { throw Object.assign(new Error('Translated permission denial'), { code: 'LOCAL_ACCESS_DENIED' }) },
  })
  await settings.update('useProxy', true)
  await settings.update('proxyHostname', '192.168.1.2')
  await settings.update('proxyPort', '1080')
  assert.equal(settings.errors.length, 3)
  assert.ok(settings.errors.every(error => error.message === 'Translated permission denial'))
  assert.equal(settings.state.useProxy, true)
  assert.equal(settings.state.proxyHostname, '192.168.1.2')
  assert.equal(applied[2].proxyHostname, '192.168.1.2')
  assert.deepEqual(settings.writes, [['useProxy', true], ['proxyHostname', '192.168.1.2'], ['proxyPort', '1080']])
})

test('startup reads the native persisted proxy instead of applying stale renderer settings', async () => {
  let configured = false
  const persisted = { useProxy: true, proxyProtocol: 'socks5', proxyHostname: 'proxy.example', proxyPort: '1080', proxyUsername: '', proxyPassword: '' }
  const settings = fixture(async () => { configured = true }, { persisted })
  await settings.restore()
  assert.equal(settings.state.useProxy, true)
  assert.equal(settings.state.proxyHostname, 'proxy.example')
  assert.equal(configured, false)
})

test('failed native proxy changes are reported and a subsequent edit can recover', async () => {
  let failed = false
  const settings = fixture(async () => {
    if (!failed) { failed = true; throw new Error('Native failure') }
  })
  await settings.update('useProxy', true)
  assert.deepEqual(settings.writes, [])
  assert.equal(settings.state.useProxy, false)
  assert.equal(settings.errors.length, 1)
  await settings.update('useProxy', true)
  assert.equal(settings.state.useProxy, true)
})
