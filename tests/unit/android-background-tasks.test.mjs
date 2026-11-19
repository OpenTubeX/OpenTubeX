import assert from 'node:assert/strict'
import test from 'node:test'
import { importWithStubs, sourceUrl } from '../helpers/module-stubs.mjs'

const calls = []
let loadThemes = async () => []
let checkReplies = async () => calls.push('replies')

const [{ runAndroidBackgroundTasks }] = await importWithStubs([sourceUrl('src/renderer/startup/androidBackgroundTasks.js')], {
  [sourceUrl('src/renderer/i18n/index.js')]: { default: { global: { t: key => key } } },
  [sourceUrl('src/datastores/index.js')]: { waitForDatastores: async () => calls.push('datastores') },
  [sourceUrl('src/renderer/helpers/androidBackgroundSync.js')]: {
    finishAndroidBackgroundTasks: async () => calls.push('finish'),
    setPeriodicBackgroundTask: (task, enabled) => calls.push(`periodic ${task} ${enabled}`),
  },
  [sourceUrl('src/renderer/helpers/commentReplyNotifications.js')]: { checkCommentRepliesInBackground: () => checkReplies() },
  [sourceUrl('src/renderer/helpers/platformFeed.js')]: { checkTwitchLiveInBackground: async () => calls.push('twitch') },
  [sourceUrl('src/renderer/helpers/androidStorage.js')]: { handleRestoredAndroidAppData: async () => calls.push('restore check') },
  [sourceUrl('src/renderer/helpers/androidNotificationSuppressions.js')]: {
    suppressWatchedAndroidNotifications: async () => calls.push('suppress watched'),
  },
  [sourceUrl('src/renderer/helpers/customTheme.js')]: { loadCustomThemes: () => loadThemes() },
})

// What each loader resolves to after a successful read
const loaded = {
  grabUserSettings: { hasExistingSettings: true },
  grabAllProfiles: true,
  grabHistory: true,
}

function createStore(settings, results = loaded) {
  return {
    state: {
      playlists: { playlistsReady: true },
      settings: {
        syncServerEnabled: true,
        syncServerToken: 'token',
        syncServerAutoSync: true,
        syncServerSyncPlaylists: true,
        ...settings,
      },
    },
    commit: (mutation, value) => calls.push(`${mutation} ${JSON.stringify(value)}`),
    dispatch: async (action, value) => {
      calls.push(value === undefined ? action : `${action} ${JSON.stringify(value)}`)
      return results[action]
    },
  }
}

test('the hidden renderer loads everything the sync compares before syncing', async () => {
  calls.length = 0
  loadThemes = async () => [{ id: 'saved' }]
  await runAndroidBackgroundTasks(createStore())
  const sync = calls.indexOf('initializeSyncServer')
  assert.notEqual(sync, -1)
  // A collection that isn't loaded looks deleted to the sync, which would
  // upload the deletion to every device.
  for (const step of [
    'grabUserSettings',
    'restore check',
    'loadAndroidProxySettings',
    'setCustomThemes [{"id":"saved"}]',
    'grabAllProfiles "Profile.All Channels"',
    'grabHistory',
    'grabAllPlaylists',
  ]) {
    const index = calls.indexOf(step)
    assert.ok(index !== -1 && index < sync, `${step} before the sync`)
  }
  // Android leaves out uploads the sync brought in as watched.
  assert.ok(calls.indexOf('suppress watched') > sync)
  assert.equal(calls.at(-1), 'finish')
})

test('the hidden renderer does not sync when it cannot load the data', async () => {
  const error = console.error
  console.error = () => {}
  try {
    // A loader that throws, and one that only reports its failure
    for (const [themes, results] of [
      [async () => { throw new Error('Unreadable themes') }, loaded],
      [async () => [], { ...loaded, grabHistory: false }],
    ]) {
      calls.length = 0
      loadThemes = themes
      await runAndroidBackgroundTasks(createStore({}, results))
      assert.equal(calls.some(call => call.startsWith('initializeSyncServer')), false)
      assert.equal(calls.at(-1), 'finish')
    }
  } finally {
    console.error = error
  }
})

test('the hidden renderer turns the sync task off once automatic sync is off', async () => {
  calls.length = 0
  loadThemes = async () => []
  await runAndroidBackgroundTasks(createStore({ syncServerAutoSync: false }))
  assert.ok(calls.includes('periodic sync false'))
  assert.equal(calls.some(call => call.startsWith('initializeSyncServer')), false)
  // The other tasks still run.
  assert.ok(calls.includes('replies') && calls.includes('twitch'))
  assert.equal(calls.at(-1), 'finish')
})

test('the hidden renderer reports the end only once every task ended', async () => {
  const error = console.error
  console.error = () => {}
  try {
    for (const failing of [false, true]) {
      calls.length = 0
      loadThemes = async () => []
      let release
      checkReplies = () => new Promise((resolve, reject) => {
        release = () => {
          calls.push('replies')
          if (failing) reject(new Error('Unreachable'))
          else resolve()
        }
      })
      const run = runAndroidBackgroundTasks(createStore())
      // The sync can end first; the slower check keeps the job running.
      await new Promise(resolve => setTimeout(resolve, 0))
      assert.ok(calls.includes('initializeSyncServer'))
      assert.equal(calls.includes('finish'), false)
      release()
      await run
      assert.deepEqual(calls.slice(-2), ['replies', 'finish'])
    }
  } finally {
    console.error = error
    checkReplies = async () => calls.push('replies')
  }
})

test('a hidden app stays awake until every periodic task ended', async () => {
  const ended = []
  let wake
  const plugin = {
    addListener: async (event, listener) => { if (event === 'sync') wake = listener },
    end: async ({ id }) => ended.push(id),
  }
  const { IS_CAPACITOR, IS_IOS } = process.env
  process.env.IS_CAPACITOR = 'true'
  delete process.env.IS_IOS
  globalThis.window ??= /** @type {any} */ ({})
  let helpers
  try {
    [helpers] = await importWithStubs([sourceUrl('src/renderer/helpers/androidBackgroundSync.js')], {
      '@capacitor/core': { registerPlugin: () => plugin },
    })
  } finally {
    if (IS_CAPACITOR === undefined) delete process.env.IS_CAPACITOR
    else process.env.IS_CAPACITOR = IS_CAPACITOR
    if (IS_IOS !== undefined) process.env.IS_IOS = IS_IOS
  }
  const error = console.error
  console.error = () => {}
  try {
    let release
    helpers.onPeriodicBackgroundTask(async () => { throw new Error('Offline') })
    helpers.onPeriodicBackgroundTask(() => new Promise(resolve => { release = resolve }))
    wake({ id: 'hold' })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(ended, [])
    release()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(ended, ['hold'])
  } finally {
    console.error = error
  }
})
