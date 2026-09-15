import { test, expect, goTo } from '../../helpers/app.mjs'

test.use({
  seed: {
    settings: { enableDownloads: true },
    playlists: [{ _id: 'menu-test', playlistName: 'Playlist menu test', description: '', videos: [{ videoId: 'jNQXAC9IVRw', title: 'Video', author: 'Channel', lengthSeconds: 10 }], createdAt: 1, lastUpdatedAt: 1 }],
  }
})

test('playlist actions use the context menu and respect the menu icon setting', async ({ page }) => {
  await goTo(page, 'userplaylists')
  const card = page.locator('.ft-list-item').filter({ hasText: 'Playlist menu test' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name: 'Download Playlist', exact: true })).toHaveCount(0)
  await expect(card.getByRole('button', { name: /More options/i })).toHaveCount(0)
  await card.locator('.title').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Context menu', exact: true })
  await expect(menu.getByRole('menuitem', { name: 'Download Playlist', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Quick bookmark enabled/i })).toBeDisabled()
  await expect(menu.getByRole('menuitem', { name: 'Download Playlist', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateShowVideoMenuButton', true))
  await card.getByRole('button', { name: /More options/i }).click()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 375, height: 812 })
  await card.locator('.title').scrollIntoViewIfNeeded()
  const bounds = await card.locator('.title').boundingBox()
  const url = page.url()
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 1 }] })
    await expect(page.locator('.mobileLinkActions')).toBeVisible()
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page).toHaveURL(url)
  } finally {
    await session.detach()
  }
  await page.locator('.mobileLinkActions').getByRole('menuitem', { name: 'Download Playlist', exact: true }).click()
  await expect(page.getByText('Media Type', { exact: true })).toBeVisible()
})
