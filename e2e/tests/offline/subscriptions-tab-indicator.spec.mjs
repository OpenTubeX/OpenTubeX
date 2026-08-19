import { test, expect, goTo, sel } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

function video (index, kind) {
  return {
    videoId: `${kind}${String(index).padStart(6, '0')}`,
    title: `${kind} video ${String(index).padStart(3, '0')}`,
    author: 'Channel A',
    authorId: CHANNEL_ID,
    published: now - index * 3600000,
    viewCount: 1000,
    lengthSeconds: 120,
    liveNow: false,
    isUpcoming: false,
    type: 'video'
  }
}

// Large feeds so that rendering a panel is expensive enough to stall the
// indicator animation when both happen in the same frame
const videos = Array.from({ length: 150 }, (_, index) => video(index, 'video'))
const shorts = Array.from({ length: 150 }, (_, index) => ({
  ...video(index, 'short'),
  thumbnailUrl: `https://i.ytimg.com/vi/short${index}/hq720_2.jpg?sqp=selected&rs=signature`
}))

test.use({
  seed: {
    settings: {
      fetchSubscriptionsAutomatically: false,
      hideSubscriptionsVideos: false,
      hideSubscriptionsShorts: false,
      reducedMotion: 'off'
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
        videosTimestamp: new Date(now).toISOString(),
        shorts,
        shortsTimestamp: new Date(now).toISOString()
      }
    ]
  }
})

test.describe('subscriptions feed tab indicator', () => {
  test('falls back when the persisted tab is hidden on startup', async ({ page }) => {
    await page.evaluate(async () => {
      localStorage.setItem('Subscriptions/currentTab', 'videos')

      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateHideSubscriptionsVideos', true)
    })

    await goTo(page, 'subscriptions')

    await expect(page.locator('[data-subscription-feed-tab="videos"]')).toHaveCount(0)
    await expect(page.locator('[data-subscription-feed-tab="shorts"]'))
      .toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('short video 000')).toBeVisible()
  })

  test('keeps tab widths stable when hovering with fonts whose bold glyphs are wider', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await page.locator('body').evaluate(element => {
      element.style.fontFamily = 'Arial, sans-serif'
    })

    const tab = page.locator('[data-subscription-feed-tab="shorts"]')
    const widthBeforeHover = (await tab.boundingBox()).width

    await tab.hover()

    expect((await tab.boundingBox()).width).toBe(widthBeforeHover)
  })

  test('only animates the transform, so it runs on the compositor', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.locator('.tabsIndicator')).toBeVisible()

    // The initial placement is intentionally not animated
    await page.locator('[data-subscription-feed-tab="shorts"]').click()

    await expect(page.locator('.tabsIndicator')).toHaveCSS('transition-property', 'transform')
  })

  test('renders the selected feed by the next frame', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    await expect(page.locator('.tabsIndicator')).toBeVisible()

    const state = await page.evaluate(() => {
      document.querySelector('[data-subscription-feed-tab="shorts"]').click()

      return new Promise(resolve => {
        requestAnimationFrame(() => {
          resolve({
            selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')
              ?.dataset.subscriptionFeedTab,
            panelText: document.querySelector('#subscriptionsPanel')?.textContent
          })
        })
      })
    })

    expect(state.selectedTab).toBe('shorts')
    expect(state.panelText).toContain('short video 000')
    expect(state.panelText).not.toContain('video video 000')
  })

  test('animates through an intermediate position after rendering a large feed', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    await expect(page.locator('.tabsIndicator')).toBeVisible()

    const animation = await page.evaluate(() => {
      const indicator = document.querySelector('.tabsIndicator')
      const targetTab = document.querySelector('[data-subscription-feed-tab="shorts"]')
      const startX = indicator.getBoundingClientRect().x
      const endX = targetTab.getBoundingClientRect().x

      return new Promise(resolve => {
        let sawIntermediatePosition = false
        let animationFrame = 0

        const samplePosition = () => {
          const currentX = indicator.getBoundingClientRect().x
          const progress = (currentX - startX) / (endX - startX)

          if (progress > 0.05 && progress < 0.95) {
            sawIntermediatePosition = true
          }

          animationFrame = requestAnimationFrame(samplePosition)
        }

        indicator.addEventListener('transitionend', event => {
          if (event.propertyName !== 'transform') {
            return
          }

          cancelAnimationFrame(animationFrame)
          resolve({
            elapsedTime: event.elapsedTime,
            sawIntermediatePosition
          })
        }, { once: true })

        animationFrame = requestAnimationFrame(samplePosition)
        targetTab.click()
      })
    })

    expect(animation.sawIntermediatePosition).toBe(true)
    expect(animation.elapsedTime).toBeCloseTo(0.2, 2)
  })

  test('ends up aligned with the selected tab', async ({ page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')

    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.locator('.tab.selectedTab')).toHaveText(/Shorts/)

    // Wait out the 200ms transition
    await page.waitForTimeout(400)

    const { indicator, tab } = await page.evaluate(() => {
      const toBox = (element) => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x, width: rect.width, top: rect.top, bottom: rect.bottom }
      }

      return {
        indicator: toBox(document.querySelector('.tabsIndicator')),
        tab: toBox(document.querySelector('[data-subscription-feed-tab="shorts"]'))
      }
    })

    expect(Math.abs(indicator.x - tab.x)).toBeLessThan(1)
    expect(Math.abs(indicator.width - tab.width)).toBeLessThan(1)
    expect(Math.abs(indicator.top - tab.bottom)).toBeLessThan(1)
    await attachScreenshot('indicator under the Shorts tab')
  })

  test('keeps the last clicked tab when switching back and forth quickly', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()

    // Both clicks happen in the same task, so the last activation must win.
    await page.evaluate(() => {
      document.querySelector('[data-subscription-feed-tab="shorts"]').click()
      document.querySelector('[data-subscription-feed-tab="videos"]').click()
    })

    await page.waitForTimeout(400)

    await expect(page.locator('.tab.selectedTab')).toHaveText(/Videos/)
    await expect(page.getByText('video video 000')).toBeVisible()

    const { indicator, tab } = await page.evaluate(() => {
      const toX = (element) => element.getBoundingClientRect().x

      return {
        indicator: toX(document.querySelector('.tabsIndicator')),
        tab: toX(document.querySelector('[data-subscription-feed-tab="videos"]'))
      }
    })

    expect(Math.abs(indicator - tab)).toBeLessThan(1)
  })

  test('keeps feed scroll positions across microtask-separated switches', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    const videosScrollTop = await page.evaluate(() => window.scrollY)

    await page.evaluate(() => {
      document.querySelector('[data-subscription-feed-tab="shorts"]').click()
      queueMicrotask(() => {
        document.querySelector('[data-subscription-feed-tab="videos"]').click()
      })
    })

    await expect(page.locator('[data-subscription-feed-tab="videos"]'))
      .toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(videosScrollTop)

    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.locator('[data-subscription-feed-tab="shorts"]'))
      .toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('restores the fallback feed scroll after a background visibility change', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

    await page.locator(sel.newTabButton).click()
    await goTo(page, 'settings')
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateHideSubscriptionsVideos', true)
    })

    await page.locator(sel.tabs).first().click()
    const subscriptionsView = page.locator('.tabContent[aria-hidden="false"]')

    await expect(subscriptionsView.locator('[data-subscription-feed-tab="shorts"]'))
      .toHaveAttribute('aria-selected', 'true')
    await expect(subscriptionsView.getByText('short video 000')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('keeps the panel hidden after every tab is hidden', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store

      document.querySelector('[data-subscription-feed-tab="shorts"]').click()
      await Promise.all([
        store.dispatch('updateHideSubscriptionsVideos', true),
        store.dispatch('updateHideSubscriptionsShorts', true),
        store.dispatch('updateHideSubscriptionsLive', true),
        store.dispatch('updateHideSubscriptionsCommunity', true)
      ])
    })

    await expect(page.locator('.tabs [role="tab"]')).toHaveCount(0)
    await expect(page.locator('#subscriptionsPanel')).toHaveCount(0)
    await expect(page.getByText('All subscription tabs are hidden', { exact: false })).toBeVisible()
  })
})
