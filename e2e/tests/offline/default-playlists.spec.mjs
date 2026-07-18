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

  // Defaults must survive a restart without being duplicated
  await app.relaunch()
  await goTo(app.page, 'userplaylists')
  await expect(app.page.getByRole('link', { name: 'Favorites' })).toHaveCount(1)
  await expect(app.page.getByRole('link', { name: 'Watch Later' })).toHaveCount(1)
})
