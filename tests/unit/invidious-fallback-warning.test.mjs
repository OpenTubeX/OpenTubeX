import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { usesInvidiousApi } from '../../src/apiBackends.js'

const readSource = path => readFileSync(new URL(`../../src/renderer/${path}`, import.meta.url), 'utf8')
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export /gm, '')

for (const metadataOnly of [false, true]) {
  test(`watch fallback warns once before a direct ${metadataOnly ? 'downloaded metadata' : 'playback'} request`, async () => {
    const source = readSource('views/Watch/Watch.js')
    const start = source.indexOf('    getVideoInformationInvidious:')
    const end = source.indexOf('\n    async runIpBlockRecoveryScriptAndReload()', start)
    const events = []
    const methods = vm.runInNewContext(`({${source.slice(start, end)}})`, {
      process: { env: { SUPPORTS_LOCAL_API: true } },
      initializeNetworkRecovery: () => ({ ready: Promise.resolve() }),
      getConnectionState: () => 'online',
      invidiousGetVideoInformation: async () => { throw new Error('Invidious failed') },
      showInvidiousFallbackToast: backend => events.push(backend === 'yattee' ? 'yattee warning' : 'warning'),
      usesInvidiousApi,
      showApiErrorToast() {},
      console: { error() {} },
    })
    const watch = {
      ...methods,
      tabRoute: { params: { id: 'video' } },
      backendPreference: 'invidious', backendFallback: true,
      isCurrentVideoLoad: () => true,
      t: key => key,
      getVideoInformationLocal: async () => events.push('local'),
    }
    await watch.getVideoInformationInvidious(1, metadataOnly)
    assert.deepEqual(events, ['warning', 'local'])
  })
}

test('a Yattee server watch fallback names the Yattee server in its warning', async () => {
  const source = readSource('views/Watch/Watch.js')
  const start = source.indexOf('    getVideoInformationInvidious:')
  const end = source.indexOf('\n    async runIpBlockRecoveryScriptAndReload()', start)
  const events = []
  const methods = vm.runInNewContext(`({${source.slice(start, end)}})`, {
    process: { env: { SUPPORTS_LOCAL_API: true } },
    initializeNetworkRecovery: () => ({ ready: Promise.resolve() }),
    getConnectionState: () => 'online',
    invidiousGetVideoInformation: async () => { throw new Error('Yattee server failed') },
    showInvidiousFallbackToast: backend => events.push(`${backend} warning`),
    usesInvidiousApi,
    showApiErrorToast: message => events.push(message),
    console: { error() {} },
  })
  const watch = {
    ...methods,
    tabRoute: { params: { id: 'video' } },
    backendPreference: 'yattee', backendFallback: true,
    isCurrentVideoLoad: () => true,
    t: key => key,
    getVideoInformationLocal: async () => events.push('local'),
  }
  await watch.getVideoInformationInvidious(1)
  assert.deepEqual(events, ['yattee warning', 'Yattee Server.API Error (Click to copy)', 'local'])
})

test('privacy warnings broadcast each event with a warning icon and a readable duration', () => {
  const source = readSource('helpers/utils.js')
  const start = source.indexOf('function showInvidiousFallbackToast(')
  const end = source.indexOf('\n}', start) + 2
  const notifications = []
  const context = vm.createContext({
    i18n: { global: { t: key => key } },
    showToastOnAllTabs: (...args) => notifications.push(structuredClone(args)),
  })
  vm.runInContext(source.slice(start, end), context)
  context.showInvidiousFallbackToast()
  context.showInvidiousFallbackToast('invidious')
  context.showInvidiousFallbackToast('yattee')
  assert.deepEqual(notifications, [
    ...Array(2).fill(['Invidious Fallback Warning', 10000, ['fas', 'triangle-exclamation']]),
    ['Yattee Fallback Warning', 10000, ['fas', 'triangle-exclamation']]
  ])
})
