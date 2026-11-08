import { test, expect, goTo } from '../../helpers/app.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const videos = Array.from({ length: 5 }, (_, index) => ({
  type: 'video',
  title: `Video ${index + 1}`,
  videoId: `labels0000${index}`,
  author: 'Test channel',
  lengthSeconds: 120,
  playlistItemId: `labels-item-${index}`,
}))

/**
 * @param {import('@playwright/test').Locator} actions
 */
function readLayout(actions) {
  return actions.evaluate(group => {
    const row = group.closest('.channelShareWrapper').getBoundingClientRect()
    const buttons = [...group.children].map(button => ({
      rect: button.getBoundingClientRect(),
      collapsed: button.hasAttribute('data-label-collapsed'),
      labelWidth: button.querySelector('.buttonLabel')?.getBoundingClientRect().width,
    }))
    const labeled = buttons.filter(button => button.labelWidth !== undefined)
    return {
      collapsed: labeled.map(button => button.collapsed),
      labelsHidden: labeled.every(button => button.collapsed === (button.labelWidth <= 1)),
      singleRow: Math.max(...buttons.map(({ rect }) => rect.top)) - Math.min(...buttons.map(({ rect }) => rect.top)) <= 1,
      insideRow: buttons.every(({ rect }) => rect.left >= row.left - 0.5 && rect.right <= row.right + 0.5),
    }
  })
}

/**
 * @param {import('@playwright/test').Locator} actions
 * @param {boolean[] | null} collapsed
 * @param {string} message
 */
async function expectOneRow(actions, collapsed, message) {
  await expect(async () => {
    const layout = await readLayout(actions)
    if (collapsed) expect(layout.collapsed, `labels collapsed ${message}`).toEqual(collapsed)
    expect(layout.labelsHidden, 'only collapsed labels should be hidden').toBe(true)
    expect(layout.singleRow, `actions should stay on one row ${message}`).toBe(true)
    expect(layout.insideRow, `actions should not overflow their row ${message}`).toBe(true)
  }).toPass({ timeout: 15_000 })
}

/**
 * Opens a remote playlist with five actions in a background tab.
 * @param {import('@playwright/test').Page} page
 */
async function openRemotePlaylist(page) {
  await page.route('https://invidious.test/ggpht/**', route => fulfillVisualFixture(route, 'avatar'))
  await page.route(/\/api\/v1\/playlists\/action-labels-remote\?/, route => route.fulfill({
    json: {
      title: 'Remote playlist',
      playlistId: 'action-labels-remote',
      author: 'Test channel',
      authorId: 'UCtestchannel',
      authorThumbnails: [{ url: 'https://yt3.ggpht.com/test=s76' }],
      description: '',
      videoCount: videos.length,
      viewCount: 1000,
      updated: 1700000000,
      videos: videos.map((video, index) => ({ ...video, authorId: 'UCtestchannel', index, videoThumbnails: [] })),
    },
  }))
  const tab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/playlist/action-labels-remote', makeActive: false }))
  await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
  return page.locator('.playlistOptions').filter({ visible: true })
}

test.describe('playlist actions', { tag: '@scale' }, () => {
  test.use({
    seed: {
      settings: {
        playlistViewType: 'list',
        enableDownloads: true,
        backendPreference: 'invidious',
        backendFallback: false,
        defaultInvidiousInstance: 'https://invidious.test',
      },
      playlists: [{
        _id: 'action-labels',
        playlistName: 'Watch Later',
        description: '',
        protected: false,
        videos,
        lastUpdatedAt: 1700000000000,
      }],
    },
  })

  test('collapse labels from the end instead of wrapping', async ({ page, uiScale, attachScreenshot }) => {
    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name: 'Watch Later', exact: true }).click()
    const actions = page.locator('.playlistOptions')
    const names = ['Edit', 'Add to Queue', 'Download', 'More']
    for (const name of names) {
      await expect(actions.getByRole('button', { name, exact: true })).toBeVisible()
    }

    // The labeled actions need about 480px, so narrower rows show icons, starting with More.
    // Wide windows put the list layout's panel in a narrow side column.
    const expected = [
      [600, [false, false, false, false]],
      [500, [false, false, false, true]],
      [440, [false, false, true, true]],
      [1440, [false, false, true, true]],
      [375, [false, true, true, true]],
    ]
    for (const [width, collapsed] of expected) {
      await page.setViewportSize({ width: Math.round(width * uiScale / 100), height: Math.round(900 * uiScale / 100) })
      await expectOneRow(actions, collapsed, `at ${width}px`)
      // Collapsed labels still name their buttons
      for (const name of names) {
        await expect(actions.getByRole('button', { name, exact: true })).toBeVisible()
      }
    }
    await attachScreenshot('playlist actions at 375px')

    // Edit mode replaces the buttons, so returning from it must collapse the new ones again
    await page.getByTitle('Edit Playlist Info').click()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expectOneRow(actions, expected.at(-1)[1], 'after edit mode')
  })

  test('fit five actions of a remote playlist on one row', async ({ page, uiScale }) => {
    const actions = await openRemotePlaylist(page)
    for (const name of ['Save', 'Add to Queue', 'Download', 'Share Playlist', 'More']) {
      await expect(actions.getByRole('button', { name, exact: true })).toBeVisible()
    }

    // Phones down to 320px and the desktop side column of wide windows
    for (const width of [320, 375, 412, 1440]) {
      await page.setViewportSize({ width: Math.round(width * uiScale / 100), height: Math.round(900 * uiScale / 100) })
      await expectOneRow(actions, null, `at ${width}px`)
    }
  })

  /**
   * Checks that every action is either a button in the one-row action bar or
   * an item of its More menu, never both.
   * @param {import('@playwright/test').Page} page
   * @param {import('@playwright/test').Locator} actions
   * @param {{ button: string, menuItem: string }[]} expected
   * @param {string[]} overflowed The menu items of the actions that should be in the More menu
   * @param {string} message
   */
  async function expectActionsInRowOrMenu(page, actions, expected, overflowed, message) {
    await expectOneRow(actions, null, message)
    for (const { button, menuItem } of expected) {
      await expect(actions.getByRole('button', { name: button, exact: true }), `${button} in the row ${message}`)
        .toHaveCount(overflowed.includes(menuItem) ? 0 : 1)
    }
    await actions.getByRole('button', { name: 'More', exact: true }).click()
    const menu = page.getByRole('menu', { name: 'Context menu', exact: true })
    for (const { menuItem } of expected) {
      const item = menu.getByRole('menuitem', { name: menuItem, exact: true })
      await expect(item, `${menuItem} in the More menu ${message}`).toHaveCount(overflowed.includes(menuItem) ? 1 : 0)
      if (overflowed.includes(menuItem)) await expect(item).toBeEnabled()
    }
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  }

  const remoteActions = [
    { button: 'Save', menuItem: 'Save Playlist' },
    { button: 'Add to Queue', menuItem: 'Add Playlist to Queue' },
    { button: 'Download', menuItem: 'Download Playlist' },
    { button: 'Share Playlist', menuItem: 'Share Playlist' },
  ]

  test('move remote playlist actions that do not fit the side column into the More menu', async ({ page, uiScale }) => {
    const actions = await openRemotePlaylist(page)

    // The list layout's side column is only about 200 to 245px wide in windows
    // 860 to 1000px wide, too narrow for five icon buttons. Share has a menu of
    // its own, so it stays. Actions move out as the window narrows and come
    // back as it widens.
    const expected = [
      [1440, []],
      [1000, ['Download Playlist']],
      [860, ['Download Playlist', 'Add Playlist to Queue']],
      [1000, ['Download Playlist']],
      [1440, []],
    ]
    for (const [width, overflowed] of expected) {
      await page.setViewportSize({ width: Math.round(width * uiScale / 100), height: Math.round(900 * uiScale / 100) })
      await expectActionsInRowOrMenu(page, actions, remoteActions, overflowed, `at ${width}px`)
    }
  })

  test('move user playlist actions that do not fit the side column into the More menu', async ({ page, uiScale, attachScreenshot }) => {
    await goTo(page, 'userplaylists')
    await page.getByRole('link', { name: 'Watch Later', exact: true }).click()
    const actions = page.locator('.playlistOptions')
    const userActions = [
      { button: 'Edit', menuItem: 'Edit Playlist Info' },
      { button: 'Add to Queue', menuItem: 'Add Playlist to Queue' },
      { button: 'Download', menuItem: 'Download Playlist' },
    ]

    for (const [width, overflowed] of [[1440, []], [900, ['Download Playlist']], [1440, []]]) {
      await page.setViewportSize({ width: Math.round(width * uiScale / 100), height: Math.round(900 * uiScale / 100) })
      await expectActionsInRowOrMenu(page, actions, userActions, overflowed, `at ${width}px`)
    }

    // Moved actions stay reachable with the keyboard
    await page.setViewportSize({ width: Math.round(860 * uiScale / 100), height: Math.round(900 * uiScale / 100) })
    await expectOneRow(actions, null, 'at 860px')
    await actions.getByRole('button', { name: 'More', exact: true }).focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu', { name: 'Context menu', exact: true })
    const download = menu.getByRole('menuitem', { name: 'Download Playlist', exact: true })
    await expect(download).toBeVisible()
    await attachScreenshot('playlist More menu at 860px')
    // The menu focuses its first item, which is the first moved action
    await expect(download).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Media Type', { exact: true })).toBeVisible()
  })
})
