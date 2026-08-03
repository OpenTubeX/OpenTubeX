import { test, expect, goTo } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

const videos = Array.from({ length: 5 }, (_, index) => ({
  videoId: `video${String(index).padStart(6, '0')}`,
  title: `video ${String(index).padStart(3, '0')}`,
  author: 'Channel A',
  authorId: CHANNEL_ID,
  published: now - index * 3600000,
  viewCount: 1000,
  lengthSeconds: 120,
  liveNow: false,
  isUpcoming: false,
  type: 'video',
  // So that the header also carries the Mark all as seen button
  isNewInSubscriptionFeed: true
}))

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      hideSubscriptionsVideos: false,
      hideSubscriptionsShorts: false,
      showNewSubscriptionFeedIndicators: true
    },
    profiles: [
      {
        _id: 'allChannels',
        name: 'All Channels',
        bgColor: '#000000',
        textColor: '#FFFFFF',
        subscriptions: [{ id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }]
      }
    ],
    subscriptionCache: [
      {
        _id: CHANNEL_ID,
        videos,
        videosTimestamp: new Date(now).toISOString()
      }
    ]
  }
})

async function setWindowWidth (app, width) {
  await app.electronApp.evaluate(({ BrowserWindow }, targetWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0]
    const bounds = browserWindow.getBounds()
    browserWindow.setBounds({ ...bounds, width: targetWidth })
  }, width)
}

function headerBoxes (page) {
  return page.evaluate(() => {
    const toBox = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect()
      return { start: rect.left, end: rect.right, top: rect.top, bottom: rect.bottom }
    }

    return {
      title: toBox('.pageTitle'),
      tabs: toBox('.tabs'),
      refreshWidget: toBox('.headerRefreshWidget'),
      header: toBox('.subscriptionsHeader')
    }
  })
}

test.describe('subscriptions header layout', () => {
  test('puts the tabs beside the title when they fit', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.locator('.subscriptionsHeader')).toHaveClass(/singleRow/)

    const { title, tabs, refreshWidget } = await headerBoxes(page)

    // One line: the tabs follow the title and the refresh widget stays last
    expect(tabs.start).toBeGreaterThanOrEqual(title.end)
    expect(refreshWidget.start).toBeGreaterThanOrEqual(tabs.end)
    expect(tabs.top).toBeLessThan(title.bottom)
    expect(refreshWidget.top).toBeLessThan(tabs.bottom)
  })

  test('drops the tabs onto their own line when the window is too narrow', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await expect(page.locator('.subscriptionsHeader')).toHaveClass(/singleRow/)

    await setWindowWidth(app, 800)

    await expect(page.locator('.subscriptionsHeader')).not.toHaveClass(/singleRow/)

    const { title, tabs, refreshWidget } = await headerBoxes(page)

    // Two lines: title and refresh widget above, the tabs below both
    expect(refreshWidget.top).toBeLessThan(title.bottom)
    expect(refreshWidget.end).toBeGreaterThan(title.end)
    expect(tabs.top).toBeGreaterThanOrEqual(title.bottom)
    expect(tabs.top).toBeGreaterThanOrEqual(refreshWidget.bottom)
  })

  test('merges the rows again when the window grows back', async ({ app, page }) => {
    await goTo(page, 'subscriptions')

    await setWindowWidth(app, 800)
    await expect(page.locator('.subscriptionsHeader')).not.toHaveClass(/singleRow/)

    await setWindowWidth(app, 1600)
    await expect(page.locator('.subscriptionsHeader')).toHaveClass(/singleRow/)

    // The layout has to settle instead of flipping between the two
    const heights = []
    for (let index = 0; index < 3; index++) {
      await page.waitForTimeout(150)
      heights.push(await page.evaluate(() => {
        return document.querySelector('.subscriptionsHeader').getBoundingClientRect().height
      }))
    }

    expect(new Set(heights).size).toBe(1)
    await expect(page.locator('.subscriptionsHeader')).toHaveClass(/singleRow/)
  })

  test('merges the rows when the Mark all as seen button is what did not fit', async ({ app, page }) => {
    await goTo(page, 'subscriptions')

    const header = page.locator('.subscriptionsHeader')
    const markAllSeen = page.locator('.markAllSeenButton')
    await expect(markAllSeen).toBeVisible()

    // Narrow the window step by step until the button is what pushes the tabs
    // onto their own line
    let width = 1920
    while (width > 900) {
      width -= 20
      await setWindowWidth(app, width)

      if (!await header.evaluate(element => element.classList.contains('singleRow'))) {
        break
      }
    }

    await expect(header).not.toHaveClass(/singleRow/)

    // Removing the button frees far more space than the last step took away, so
    // the tabs fit next to the title again. The button leaves without resizing
    // the tabs row, which keeps its full width while it has its own line.
    await markAllSeen.click()
    await expect(markAllSeen).toBeHidden()

    await expect(header).toHaveClass(/singleRow/)
  })

  test('saves vertical space compared to the two line layout', async ({ app, page }) => {
    await goTo(page, 'subscriptions')

    const headerHeight = () => page.evaluate(() => {
      return document.querySelector('.subscriptionsHeader').getBoundingClientRect().height
    })

    const merged = await headerHeight()

    await setWindowWidth(app, 800)
    await expect(page.locator('.subscriptionsHeader')).not.toHaveClass(/singleRow/)

    expect(merged).toBeLessThan(await headerHeight())
  })
})
