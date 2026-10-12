import { readPersistedDatastore } from '../../helpers/datastore.mjs'
import path from 'node:path'
import { DBActions, IpcChannels } from '../../../src/constants.js'
import { migrateLegacyHistoryRecord } from '../../../src/history.js'

import { test, expect, goTo } from '../../helpers/app.mjs'

// Vuex state objects are Vue 3 reactive Proxies, which Electron IPC cannot
// structured-clone. Datastore writes must strip reactivity at the IPC
// boundary (src/datastores/handlers/electron.js) or they fail silently.
test('a reactive store object can be persisted over IPC', async ({ app, page }) => {
  await goTo(page, 'userplaylists')
  await expect(page.getByRole('link', { name: 'Favorites' })).toBeVisible()

  const result = await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    // A reactive Proxy straight out of Vuex state, passed as the payload
    const playlist = store.state.playlists.playlists.find((p) => p._id === 'favorites')
    playlist.description = 'reactive roundtrip'
    try {
      await store.dispatch('updatePlaylist', playlist)
      return 'ok'
    } catch (e) {
      return `dispatch threw: ${e.message}`
    }
  })
  expect(result).toBe('ok')

  await expect(async () => {
    const db = await readPersistedDatastore(path.join(app.userDataDir, 'playlists.db'), 'utf8')
    expect(db).toContain('"description":"reactive roundtrip"')
  }).toPass({ timeout: 10_000 })
})

test('history overwrite caches durable IDs without another full history read over IPC', async ({ app, page }) => {
  await app.electronApp.evaluate(({ ipcMain }, { channel, find }) => {
    const handler = ipcMain._invokeHandlers.get(channel)
    ipcMain.removeHandler(channel)
    globalThis.historyOverwriteReadAttempts = 0
    globalThis.restoreHistoryOverwriteHandler = () => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, handler)
    }
    ipcMain.handle(channel, (event, request) => {
      if (request.action === find) {
        globalThis.historyOverwriteReadAttempts++
        throw new Error('simulated post-overwrite history read failure')
      }
      return handler(event, request)
    })
  }, { channel: IpcChannels.DB_HISTORY, find: DBActions.GENERAL.FIND })
  const imported = { videoId: 'abcdefghijk', title: 'Restored history', timeWatched: 1, watchProgress: 12, isWatched: true, unknown: { keep: true } }
  const saved = await page.evaluate(async imported => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const success = await store.dispatch('overwriteHistory', new Map([[imported.videoId, imported]]))
    return { success, records: store.state.history.historyCacheSorted, byId: store.state.history.historyCacheById, inputHasId: Object.hasOwn(imported, '_id') }
  }, imported)
  expect(saved.success).toBe(true)
  expect(saved.inputHasId).toBe(false)
  expect(saved.records).toHaveLength(1)
  expect(typeof saved.records[0]._id).toBe('string')
  expect(saved.records[0]).toStrictEqual({ ...migrateLegacyHistoryRecord(imported), _id: saved.records[0]._id })
  expect(saved.byId).toStrictEqual({ [imported.videoId]: saved.records[0] })
  expect(await app.electronApp.evaluate(() => globalThis.historyOverwriteReadAttempts)).toBe(0)
  await app.electronApp.evaluate(() => globalThis.restoreHistoryOverwriteHandler())
  expect(await page.evaluate(find => window.ftElectron.dbHistory(find), DBActions.GENERAL.FIND)).toStrictEqual(saved.records)
})
