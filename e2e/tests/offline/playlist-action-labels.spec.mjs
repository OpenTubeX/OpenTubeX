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
    const actions = page.locator('.playlistOptions').filter({ visible: true })
    for (const name of ['Save', 'Add to Queue', 'Download', 'Share Playlist', 'More']) {
      await expect(actions.getByRole('button', { name, exact: true })).toBeVisible()
    }

    // Phones down to 320px and the desktop side column of wide windows
    for (const width of [320, 375, 412, 1440]) {
      await page.setViewportSize({ width: Math.round(width * uiScale / 100), height: Math.round(900 * uiScale / 100) })
      await expectOneRow(actions, null, `at ${width}px`)
    }
  })
})
