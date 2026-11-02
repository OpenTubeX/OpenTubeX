import { test, expect, goTo } from '../../helpers/app.mjs'

const title = 'A long video title about food and art that should wrap on a phone ' + 'UnbrokenTitle'.repeat(8)
const channels = ['Alpha Channel', 'A channel with a longer name', 'UnbrokenChannelName'.repeat(8), 'Delta Channel']
  .map((name, index) => ({ id: `UC${String(index).padStart(22, '0')}`, name, thumbnail: '' }))

test.describe('mobile overflow', { tag: '@scale' }, () => {
  test.use({
    seed: {
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

  test('long mobile menu titles wrap without widening or truncating quick actions', async ({ page }) => {
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
        const rows = [...element.querySelectorAll('.mobileLinkQuickActions')].map(row => [...row.querySelectorAll('button')])
        return bounds.left >= 0 && bounds.right <= innerWidth + 1 &&
          heading.scrollWidth <= heading.clientWidth + 1 &&
          heading.clientHeight > parseFloat(getComputedStyle(heading).fontSize) * 2 &&
          rows.length === 2 && rows.every(buttons => buttons.length >= 2 && buttons.every(button => {
          const buttonBounds = button.getBoundingClientRect()
          const label = button.querySelector('.mobileLinkQuickActionLabel')
          return buttonBounds.left >= bounds.left && buttonBounds.right <= bounds.right &&
              label.scrollWidth <= label.clientWidth + 1 &&
              label.getBoundingClientRect().bottom <= buttonBounds.bottom + 1
        }))
      })).toBe(true)
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
    }
  })

  test('a long quick bookmark name does not squeeze neighboring quick actions', async ({ page }) => {
    await goTo(page, 'history')
    await page.setViewportSize({ width: 320, height: 812 })
    await page.evaluate(name => {
      const icon = ['fas', 'clone']
      document.querySelector('#app').__vue_app__._container._vnode.component.provides.openMobileContextActions({
        title: 'Video',
        actions: [],
        thumbnailActions: [
          { label: 'Open in a Background Tab', shortLabel: 'Background Tab', icon, run() {} },
          { label: 'Add to Playlist', shortLabel: 'Save', icon, run() {} },
          { label: `Add to ${name}`, shortLabel: name, icon, pressed: false, run() {} },
          { label: 'Remove from Playlist', shortLabel: 'Remove', icon, run() {} }
        ]
      })
    }, 'Long playlist name '.repeat(14))
    const buttons = page.locator('.mobileThumbnailActionRow button')
    await expect(buttons).toHaveCount(4)
    await expect.poll(() => buttons.evaluateAll(elements => elements.every(element => {
      const bounds = element.getBoundingClientRect()
      const label = element.querySelector('.mobileLinkQuickActionLabel').getBoundingClientRect()
      return bounds.width >= 47.99 && bounds.right <= innerWidth + 1 &&
        label.left >= bounds.left - 1 && label.right <= bounds.right + 1 && label.bottom <= bounds.bottom + 1
    }))).toBe(true)
    await page.keyboard.press('Escape')
  })

  test('channel cards contain subscription controls and show two columns on the Pixel', async ({ page, uiScale }) => {
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
