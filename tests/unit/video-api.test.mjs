import assert from 'node:assert/strict'
import test from 'node:test'
import { createVideoApi } from '../../src/renderer/helpers/api/createVideoApi.js'

const makeApi = providers => createVideoApi({
  ...providers,
  mapLocal: video => video,
  mapInvidious: video => video,
})

test('video API routes information requests to the selected provider', async () => {
  const calls = []
  const localResult = { info: { basic_info: { title: 'Local title' } } }
  const invidiousResult = { title: 'Invidious title' }
  const api = makeApi({
    loadLocal: async videoId => { calls.push(['local', videoId]); return localResult },
    loadInvidious: async videoId => { calls.push(['invidious', videoId]); return invidiousResult },
  })

  assert.equal(await api.getVideoInformation('video-1', 'local'), localResult)
  assert.equal(await api.getVideoInformation('video-2', 'invidious'), invidiousResult)
  assert.deepEqual(calls, [['local', 'video-1'], ['invidious', 'video-2']])
})

test('video API preserves provider failures', async () => {
  const failure = new Error('Provider unavailable')
  const api = makeApi({
    loadLocal: async () => { throw failure },
    loadInvidious: async () => null,
  })

  await assert.rejects(api.getVideoInformation('video-1', 'local'), error => error === failure)
  assert.throws(() => api.getVideoInformation('video-1', 'unknown'), /Unknown video provider/)
})

test('video API resolves initial and reload provider choices', () => {
  const api = makeApi({ loadLocal: async () => null, loadInvidious: async () => null })

  assert.equal(api.resolveProvider('local'), 'local')
  assert.equal(api.resolveProvider('invidious'), 'invidious')
  assert.equal(api.resolveProvider('local', { localAvailable: false }), 'invidious')
  assert.equal(api.resolveProvider('unknown', { defaultProvider: 'local' }), 'local')
  assert.equal(api.resolveProvider('unknown'), null)
})

test('video API only offers a supported, enabled Invidious fallback', () => {
  const api = makeApi({ loadLocal: async () => null, loadInvidious: async () => null })

  assert.equal(api.getFallbackProvider('invidious', { preferredProvider: 'invidious', localAvailable: true, fallbackEnabled: true }), 'local')
  assert.equal(api.getFallbackProvider('invidious', { preferredProvider: 'invidious', localAvailable: false, fallbackEnabled: true }), null)
  assert.equal(api.getFallbackProvider('invidious', { preferredProvider: 'invidious', localAvailable: true, fallbackEnabled: false }), null)
  assert.equal(api.getFallbackProvider('invidious', { preferredProvider: 'local', localAvailable: true, fallbackEnabled: true }), null)
})

test('video API preserves Local fallback exclusions and prevents a second fallback', () => {
  const api = makeApi({ loadLocal: async () => null, loadInvidious: async () => null })
  const options = { preferredProvider: 'local', localAvailable: true, fallbackEnabled: true }

  assert.equal(api.getFallbackProvider('local', { ...options, error: new Error('Network failed') }), 'invidious')
  assert.equal(api.getFallbackProvider('local', { ...options, error: new Error('This video is private') }), null)
  assert.equal(api.getFallbackProvider('local', { ...options, error: new Error('Video unavailable') }), null)
  assert.equal(api.getFallbackProvider('local', { ...options, fallbackEnabled: false }), null)
  assert.equal(api.getFallbackProvider('local', { ...options, preferredProvider: 'invidious' }), null)
})

test('video API owns Watch provider selection and a single fallback handoff', async () => {
  const api = makeApi({ loadLocal: async () => null, loadInvidious: async () => null })
  const calls = []
  const handlers = {
    loadLocal: () => { calls.push('local'); return Promise.resolve('local load') },
    loadInvidious: () => { calls.push('invidious'); return Promise.resolve('invidious load') },
    onFallback: (from, to) => calls.push(`${from} to ${to}`),
  }

  assert.equal(await api.loadWatchMetadata('local', handlers), 'local load')
  assert.equal(api.loadWatchMetadata('invidious', handlers), undefined)
  assert.equal(api.loadWatchMetadata('local', { ...handlers, failedProvider: 'local', error: new Error('network'), fallbackEnabled: true }), undefined)
  assert.deepEqual(calls, ['local', 'invidious', 'local to invidious', 'invidious'])
})
