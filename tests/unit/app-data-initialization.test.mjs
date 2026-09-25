import assert from 'node:assert/strict'
import test from 'node:test'

import { initializeApplicationData, loadPersistentApplicationData } from '../../src/renderer/helpers/appDataInitialization.js'

test('initial app data loads independent inputs concurrently and profiles after settings', async () => {
  const calls = []
  let releaseSettings
  const settingsGate = new Promise(resolve => { releaseSettings = resolve })
  const store = {
    dispatch (action, value) {
      calls.push([action, value])
      if (action === 'grabUserSettings') return settingsGate
      if (action === 'grabAllProfiles') return Promise.resolve(true)
      return Promise.resolve()
    },
  }

  const { startupReady, profilesReady } = initializeApplicationData({
    store,
    loadTabs: () => { calls.push(['loadTabs']); return Promise.resolve() },
    afterSettings: async () => { calls.push(['afterSettings']) },
    loadThemes: () => { calls.push(['loadThemes']); return Promise.resolve([{ id: 'custom' }]) },
    preloadInitialRoute: () => { calls.push(['preloadRoute']) },
    allChannelsLabel: 'All Channels',
  })

  assert.deepEqual(calls.slice(0, 3).map(([name]) => name), ['grabUserSettings', 'loadTabs', 'loadThemes'])
  assert.equal(calls.some(([name]) => name === 'fetchInvidiousInstancesFromFile'), true)
  assert.equal(calls.some(([name]) => name === 'grabAllProfiles'), false)
  releaseSettings({ lastUsedVersion: '1.0' })
  assert.deepEqual(await startupReady, {
    tutorialState: { lastUsedVersion: '1.0' },
    themes: [{ id: 'custom' }],
  })
  assert.equal(await profilesReady, true)
  assert.ok(calls.findIndex(([name]) => name === 'afterSettings') < calls.findIndex(([name]) => name === 'grabAllProfiles'))
  assert.equal(calls.some(([name]) => name === 'preloadRoute'), true)
})

test('persistent data is ready before sync startup and search history remains independent', async () => {
  const calls = []
  let releaseHistory
  const historyGate = new Promise(resolve => { releaseHistory = resolve })
  const store = {
    dispatch (action) {
      calls.push(action)
      return action === 'grabHistory' ? historyGate : Promise.resolve()
    },
  }
  const ready = loadPersistentApplicationData(store)
  assert.deepEqual(calls, [
    'grabHistory', 'grabAllPlaylists', 'grabAllSubscriptions', 'grabSearchHistoryEntries',
  ])
  releaseHistory()
  await ready
  assert.equal(calls.at(-1), 'initializeSyncServer')
})
