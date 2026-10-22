import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

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
  await page.evaluate(() => window.$store.dispatch('updateShowVideoMenuButton', true))
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

test('playlist menu buttons use comfortable touch targets', { tag: '@scale' }, async ({ app, page }, testInfo) => {
  await setWindowSize(app, page, { width: 375, height: 812 })
  await page.evaluate(() => window.$store.dispatch('updateShowVideoMenuButton', true))
  await goTo(page, 'userplaylists')
  const card = page.locator('.ft-list-item').filter({ hasText: 'Playlist menu test' })
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  try {
    expect(await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches)).toBe(true)
    const menu = page.getByRole('menu', { name: 'Context menu', exact: true })
    async function expectTouchFriendly(name) {
      await expect(menu).toBeVisible()
      const actions = menu.getByRole('menuitem')
      await expect(actions.first()).toBeVisible()
      for (const action of await actions.all()) {
        expect(await action.evaluate(element => element.offsetHeight)).toBeGreaterThanOrEqual(48)
        await expect(action).toHaveCSS('font-size', '16px')
      }
      const bounds = await menu.boundingBox()
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1)
      await menu.screenshot({ path: testInfo.outputPath(`${name}.png`) })
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    }

    await card.getByRole('button', { name: /More options/i }).click()
    await expectTouchFriendly('touch-playlist-card-menu')

    await card.locator('.title').click()
    await page.locator('.playlistOptions').filter({ visible: true }).getByRole('button', { name: 'More', exact: true }).click()
    await expectTouchFriendly('touch-playlist-more-menu')
  } finally {
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await session.detach()
  }
})
