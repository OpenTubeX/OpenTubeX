import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { usesInvidiousApi } from '../../src/apiBackends.js'

const readSource = path => readFileSync(new URL(`../../src/renderer/${path}`, import.meta.url), 'utf8')
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export /gm, '')

function playlistLoader({ backend = 'invidious', fallback = true, supportsLocal = true, fail = true, abort = false } = {}) {
  const events = []
  const controller = new AbortController()
  const context = vm.createContext({
    process: { env: { SUPPORTS_LOCAL_API: supportsLocal } },
    getLocalPlaylist() {}, parseLocalPlaylistVideos() {}, invidiousGetPlaylistInfo() {},
    loadLocalPlaylistSnapshot: async () => {
      events.push('local')
      if (backend === 'local' && fail) throw new Error('Local failed')
      return 'snapshot'
    },
    loadInvidiousPlaylistSnapshot: async () => {
      events.push('invidious')
      if (abort) controller.abort()
      if (backend !== 'local' && fail) throw new Error('Invidious failed')
      return 'snapshot'
    },
    showInvidiousFallbackToast: () => events.push('warning'),
    usesInvidiousApi,
  })
  vm.runInContext(readSource('helpers/api/playlist-snapshot.js'), context)
  return {
    events,
    load: () => context.getPlaylistSnapshot('source', { backend, fallback, signal: controller.signal }),
  }
}

test('each playlist fallback warns once before contacting YouTube directly', async () => {
  const h = playlistLoader()
  await h.load()
  await h.load()
  assert.deepEqual(h.events, ['invidious', 'warning', 'local', 'invidious', 'warning', 'local'])
})

test('a fallback to Invidious does not show a direct-connection warning', async () => {
  const h = playlistLoader({ backend: 'local' })
  await h.load()
  assert.deepEqual(h.events, ['local', 'invidious'])
})

for (const options of [{ fallback: false }, { supportsLocal: false }, { abort: true }]) {
  test(`a blocked playlist fallback makes no direct request or warning: ${JSON.stringify(options)}`, async () => {
    const h = playlistLoader(options)
    await assert.rejects(h.load())
    assert.deepEqual(h.events, ['invidious'])
  })
}

test('a successful Invidious request does not warn', async () => {
  const h = playlistLoader({ fail: false })
  await h.load()
  assert.deepEqual(h.events, ['invidious'])
})

test('channel metadata fallback warns before its direct request', async () => {
  const events = []
  const context = vm.createContext({
    process: { env: { SUPPORTS_LOCAL_API: true } },
    invidiousGetChannelInfo: async () => { throw new Error('Invidious failed') },
    getLocalChannel: async () => { events.push('local'); return {} },
    showInvidiousFallbackToast: () => events.push('warning'),
    usesInvidiousApi,
  })
  vm.runInContext(readSource('helpers/channels.js'), context)
  await context.findChannelById('channel', { preference: 'invidious', fallback: true })
  assert.deepEqual(events, ['warning', 'local'])
})

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

test('a Yattee server playlist fallback warns before contacting YouTube directly', async () => {
  const h = playlistLoader({ backend: 'yattee' })
  await h.load()
  assert.deepEqual(h.events, ['invidious', 'warning', 'local'])
})

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
