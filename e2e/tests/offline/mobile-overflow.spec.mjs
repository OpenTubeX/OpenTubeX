import { test, expect, goTo } from '../../helpers/app.mjs'

const title = 'A long video title about food and art that should wrap on a phone ' + 'UnbrokenTitle'.repeat(8)
const channels = ['Alpha Channel', 'A channel with a longer name', 'UnbrokenChannelName'.repeat(8), 'Delta Channel']
  .map((name, index) => ({ id: `UC${String(index).padStart(22, '0')}`, name, thumbnail: '' }))

for (const uiScale of [100, 125]) {
  test.describe(`mobile overflow at ${uiScale}% UI scale`, () => {
    test.use({
      seed: {
        settings: { uiScale },
        profiles: [{ _id: 'allChannels', name: 'All Channels', bgColor: '#000000', textColor: '#FFFFFF', subscriptions: channels }],
        history: [{
          _id: 'jNQXAC9IVRw',
          videoId: 'jNQXAC9IVRw',
          title,
          author: 'Test Channel',
          authorId: channels[0].id,
          published: 1700000000000,
          timeWatched: 1700000000000,
          description: '',
          viewCount: 1234,
          lengthSeconds: 60,
          watchProgress: 10,
          isWatched: false,
          isLive: false,
          type: 'video'
        }]
      }
    })

    test('long mobile menu titles wrap without widening quick actions', async ({ page }) => {
      await goTo(page, 'history')
      for (const viewport of [{ width: 320, height: 812 }, { width: 461, height: 1026 }, { width: 812, height: 375 }]) {
        await page.setViewportSize(viewport)
        await page.locator('.ft-list-video .title').first().evaluate(element => element.dispatchEvent(new PointerEvent('contextmenu', {
          bubbles: true, cancelable: true, pointerType: 'touch'
        })))
        const menu = page.locator('.mobileLinkActions')
        await expect(menu).toBeVisible()
        await expect(menu.locator('strong')).toHaveText(title)
        await expect.poll(() => menu.evaluate(element => {
          const bounds = element.getBoundingClientRect()
          const heading = element.querySelector('strong')
          const rows = [...element.querySelectorAll('.mobileLinkQuickActions')].map(row =>
            [...row.querySelectorAll('button')].map(button => button.getBoundingClientRect()))
          return bounds.left >= 0 && bounds.right <= innerWidth + 1 &&
            heading.scrollWidth <= heading.clientWidth + 1 &&
            heading.clientHeight > parseFloat(getComputedStyle(heading).fontSize) * 2 &&
            rows.length === 2 && rows.every(buttons => buttons.length >= 2 &&
              buttons.every(button => button.left >= bounds.left && button.right <= bounds.right &&
                Math.abs(button.width - buttons[0].width) < 1))
        })).toBe(true)
        await page.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)
      }
    })

    test('channel cards contain subscription controls and show two columns on the Pixel', async ({ page }) => {
      await goTo(page, 'subscribedchannels')
      await expect(page.locator('.channels .channel')).toHaveCount(channels.length)
      for (const width of [320, 375, 461, 680, 800]) {
        await page.setViewportSize({ width, height: 1026 })
        await expect.poll(() => page.locator('.channels .channel').evaluateAll(elements => elements.every(element => {
          const card = element.getBoundingClientRect()
          const buttons = element.querySelector('.buttonList').getBoundingClientRect()
          return card.left >= 0 && card.right <= innerWidth + 1 &&
            buttons.left >= card.left && buttons.right <= card.right
        }))).toBe(true)
        if (width <= 375) {
          await expect.poll(() => page.locator('.channels').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1)
        }
        if (width === 461 && uiScale === 100) {
          await expect.poll(() => page.locator('.channels').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2)
        }
      }
    })
  })
}
