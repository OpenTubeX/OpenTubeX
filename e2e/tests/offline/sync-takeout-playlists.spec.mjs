import { expect, goTo, test } from '../../helpers/app.mjs'
import { createTakeoutSyncServer, verifyTakeoutPlaylistSync } from '../../helpers/sync-takeout-playlists.mjs'

test('encrypted sync uploads and restores Takeout playlist videos without uploader metadata', async ({ page }, testInfo) => {
  const server = await createTakeoutSyncServer()
  try {
    await verifyTakeoutPlaylistSync(page, server, async () => {
      await goTo(page, 'userplaylists')
      const card = page.locator('.playlistList .ft-list-item').filter({ has: page.getByText('Imported', { exact: true }) })
      await expect(card.locator('.videoCountContainer')).toContainText('2')
      await testInfo.attach('Downloaded Takeout playlist', { body: await card.screenshot(), contentType: 'image/png' })
    })
  } finally {
    await server.close()
  }
})
