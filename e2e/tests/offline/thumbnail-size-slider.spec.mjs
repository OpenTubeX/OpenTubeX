import { test, expect, goTo } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

const videos = Array.from({ length: 80 }, (_, index) => ({
  videoId: `video${String(index).padStart(6, '0')}`,
  title: `Feed video ${String(index).padStart(2, '0')}`,
  author: 'Channel A',
  authorId: CHANNEL_ID,
  published: now - index * 3600000,
  viewCount: 1000,
  lengthSeconds: 120,
  liveNow: false,
  isUpcoming: false,
  type: 'video'
}))

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      thumbnailSize: 100
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

/**
 * Emit the `input` events a real drag produces, without going through the mouse
 * so the number of steps is deterministic. Each step gets its own frame,
 * otherwise Vue batches the whole drag into a single update.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number[]} values
 */
async function dragSlider(page, values) {
  for (const value of values) {
    await page.evaluate((size) => {
      const slider = document.querySelector('.thumbnailSizeSlider .input')
      slider.value = String(size)
      slider.dispatchEvent(new Event('input', { bubbles: true }))

      return new Promise((resolve) => requestAnimationFrame(() => resolve()))
    }, value)
  }
}

test.describe('thumbnail size slider', () => {
  test('resizes the feed without re-measuring every card', async ({ page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')
    await expect(page.getByText('Feed video 00')).toBeVisible()

    const grid = page.locator('.autoGrid')
    const initialSize = await grid.evaluate((element) => {
      return element.style.getPropertyValue('--thumbnail-grid-size')
    })
    expect(initialSize).not.toBe('')

    await page.locator('.profileTrigger').click()
    await expect(page.locator('.thumbnailSizeSlider')).toBeVisible()
    await attachScreenshot('feed at the default thumbnail size')

    // TransitionGroup measures every child whenever it re-renders, so a
    // reactive thumbnail size would cost one getBoundingClientRect per card per
    // slider step. Counting the calls catches that without timing anything.
    const cardCount = await page.locator('.autoGrid > *').count()
    expect(cardCount).toBeGreaterThan(15)

    await page.evaluate(() => {
      window.__rectCalls = 0
      const original = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = function () {
        window.__rectCalls++
        return original.call(this)
      }
    })

    const steps = [110, 120, 130, 140, 150, 160, 170, 180]
    await dragSlider(page, steps)

    const rectCalls = await page.evaluate(() => window.__rectCalls)
    expect(rectCalls).toBeLessThan(cardCount)

    // The resize still has to happen, on both the grid and the list variables.
    await expect
      .poll(() => grid.evaluate((element) => element.style.getPropertyValue('--thumbnail-grid-size')))
      .not.toBe(initialSize)
    await attachScreenshot('feed at the largest thumbnail size')

    const listSize = await page.evaluate(() => {
      return document.body.style.getPropertyValue('--thumbnail-list-size')
    })
    expect(Number.parseFloat(listSize)).toBeCloseTo(336 * 1.8)
  })
})
