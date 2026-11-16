import assert from 'node:assert/strict'
import test from 'node:test'
import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

const calls = []
let loadThemes = async () => []

const [{ runAndroidBackgroundSync }] = await importWithStubs([sourceUrl('src/renderer/startup/androidBackgroundSync.js')], {
  [sourceUrl('src/renderer/i18n/index.js')]: { default: { global: { t: key => key } } },
  [sourceUrl('src/datastores/index.js')]: { waitForDatastores: async () => calls.push('datastores') },
  [sourceUrl('src/renderer/helpers/androidBackgroundSync.js')]: {
    finishAndroidBackgroundSync: async () => calls.push('finish'),
    setPeriodicBackgroundSync: enabled => calls.push(`periodic ${enabled}`),
  },
  [sourceUrl('src/renderer/helpers/androidStorage.js')]: { handleRestoredAndroidAppData: async () => calls.push('restore check') },
  [sourceUrl('src/renderer/helpers/customTheme.js')]: { loadCustomThemes: () => loadThemes() },
})

function createStore(settings) {
  return {
    state: {
      settings: {
        syncServerEnabled: true,
        syncServerToken: 'token',
        syncServerAutoSync: true,
        syncServerSyncPlaylists: true,
        ...settings,
      },
    },
    commit: (mutation, value) => calls.push(`${mutation} ${JSON.stringify(value)}`),
    dispatch: async (action, value) => calls.push(value === undefined ? action : `${action} ${JSON.stringify(value)}`),
  }
}

test('the hidden renderer loads everything the sync compares before syncing', async () => {
  calls.length = 0
  loadThemes = async () => [{ id: 'saved' }]
  await runAndroidBackgroundSync(createStore())
  const sync = calls.indexOf('initializeSyncServer {"notifications":false}')
  assert.notEqual(sync, -1)
  // A collection that isn't loaded looks deleted to the sync, which would
  // upload the deletion to every device.
  for (const step of [
    'grabUserSettings',
    'restore check',
    'setCustomThemes [{"id":"saved"}]',
    'grabAllProfiles "Profile.All Channels"',
    'grabHistory',
    'grabAllPlaylists',
  ]) {
    const index = calls.indexOf(step)
    assert.ok(index !== -1 && index < sync, `${step} before the sync`)
  }
  assert.equal(calls.at(-1), 'finish')
})

test('the hidden renderer does not sync when it cannot load the data', async () => {
  calls.length = 0
  loadThemes = async () => { throw new Error('Unreadable themes') }
  const error = console.error
  console.error = () => {}
  try {
    await runAndroidBackgroundSync(createStore())
  } finally {
    console.error = error
  }
  assert.equal(calls.some(call => call.startsWith('initializeSyncServer')), false)
  assert.equal(calls.at(-1), 'finish')
})

test('the hidden renderer cancels the periodic job once automatic sync is off', async () => {
  calls.length = 0
  loadThemes = async () => []
  await runAndroidBackgroundSync(createStore({ syncServerAutoSync: false }))
  assert.ok(calls.includes('periodic false'))
  assert.equal(calls.some(call => call.startsWith('initializeSyncServer')), false)
  assert.equal(calls.at(-1), 'finish')
})
