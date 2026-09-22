import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goTo } from '../../helpers/app.mjs'

test('default playlists are created on a fresh profile', async ({ app, page }) => {
  await goTo(page, 'userplaylists')

  await expect(page.getByRole('link', { name: 'Favorites' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Watch Later' })).toBeVisible()

  const db = await readFile(path.join(app.userDataDir, 'playlists.db'), 'utf8')
  expect(db).toContain('"_id":"favorites"')
  expect(db).toContain('"_id":"watchLater"')
  const playlists = db.trim().split('\n').map(line => JSON.parse(line))
  const watchLater = playlists.find(({ _id }) => _id === 'watchLater')
  expect(watchLater).toMatchObject({ quickBookmarkIcon: 'clock' })

  // Defaults must survive a restart without being duplicated
  await app.relaunch()
  await goTo(app.page, 'userplaylists')
  await expect(app.page.getByRole('link', { name: 'Favorites' })).toHaveCount(1)
  await expect(app.page.getByRole('link', { name: 'Watch Later' })).toHaveCount(1)
})

test('custom playlists named Watch Later and Favorites survive adding playlists and restarting', async ({ app, page }) => {
  await goTo(page, 'userplaylists')

  // A renamed built-in playlist leaves its original name available for reuse.
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    for (const id of ['watchLater', 'favorites']) {
      await store.dispatch('updatePlaylist', { _id: id, playlistName: `Renamed ${id}` })
    }
  })

  for (const name of ['Watch Later', 'Favorites', 'Another playlist']) {
    await page.getByTitle('Create New Playlist').click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('.playlistNameInput input').fill(name)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toBeHidden()
  }

  const readPlaylists = currentPage => currentPage.evaluate(() => {
    return document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getAllPlaylists
  })
  const original = await readPlaylists(page)
  expect(original).toHaveLength(5)

  for (let restart = 0; restart < 2; restart++) {
    await app.relaunch()
    await goTo(app.page, 'userplaylists')
    await expect(app.page.getByRole('link', { name: 'Watch Later', exact: true })).toHaveCount(1)
    await expect(app.page.getByRole('link', { name: 'Favorites', exact: true })).toHaveCount(1)
    await expect(app.page.getByRole('link', { name: 'Another playlist', exact: true })).toBeVisible()
    const loaded = await readPlaylists(app.page)
    expect(loaded.toSorted((a, b) => a._id.localeCompare(b._id)))
      .toEqual(original.toSorted((a, b) => a._id.localeCompare(b._id)))
  }
})
