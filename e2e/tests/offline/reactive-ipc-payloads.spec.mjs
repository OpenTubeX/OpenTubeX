import { readFile } from 'node:fs/promises'
import path from 'node:path'

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
    const db = await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')
    expect(db).toContain('"description":"reactive roundtrip"')
  }).toPass({ timeout: 10_000 })
})
