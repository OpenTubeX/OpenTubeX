import { test, expect, goTo, sel } from '../../helpers/app.mjs'
import { expectTabHighlightAligned, expectTabHighlightStyle, tabHighlightAnimations } from '../../helpers/tabs.mjs'
import { sampleColors } from '../../helpers/colors.mjs'

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
      showNewSubscriptionFeed: true,
      generalAutoLoadMorePaginatedItemsEnabled: false,
      reducedMotion: 'off',
      uiScale: 95
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
  test.describe('fractional device pixel ratio', () => {
    test.use({ launchArgs: ['--force-device-scale-factor=2.625'] })

    test('paints both tonal pills within the selected tab edges', async ({ app, page }) => {
      await goTo(page, 'subscriptions')
      await page.locator('[data-subscription-feed-tab="all"]').click()
      await page.getByRole('button', { name: 'Show tabbed view' }).click()
      await app.electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setSize(375, 900)
      })
      await page.evaluate(() => {
        document.querySelector('.subscriptionsHeader').style.setProperty('--primary-color', '#ff0000')
      })

      for (const selector of ['.newFeedTab.selectedTab', '[data-subscription-feed-tab="videos"]']) {
        const tab = page.locator(selector)
        await tab.click()
        const { width, height } = await tab.boundingBox()
        const colors = await sampleColors(app, tab, [
          [4, height / 2], [width - 4, height / 2], [1, 1]
        ])
        // The translucent accent must paint both ends, while the rounded
        // corner stays clear rather than becoming a rectangular highlight.
        for (const color of colors.slice(0, 2)) {
          expect(color[0] - color[1]).toBeGreaterThan(35)
        }
        expect(Math.abs(colors[2][0] - colors[2][1])).toBeLessThan(10)
      }
    })
  })

  test('rounds both feed pills with the configured UI roundness', async ({ app, page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.getByRole('button', { name: 'Show tabbed view' }).click()

    for (const width of [1600, 375]) {
      await app.electronApp.evaluate(({ BrowserWindow }, width) => {
        BrowserWindow.getAllWindows()[0].setSize(width, 900)
      }, width)
      for (const roundness of [0, 50, 100, 200]) {
        await page.evaluate(value => {
          window.$store.commit('setUiRoundness', value)
        }, roundness)
        for (const selector of ['.tabs [role="tab"][aria-selected="true"]', '.newFeedTabs [role="tab"][aria-selected="true"]']) {
          await expectTabHighlightAligned(page.locator(selector))
          await expectTabHighlightStyle(page.locator(selector), 'borderRadius', `${24 * roundness / 100}px`)
        }
      }
    }
  })

  test('falls back when the persisted tab is hidden on startup', async ({ page }) => {
    await page.evaluate(async () => {
      localStorage.setItem('Subscriptions/currentTab', 'videos')

      const store = window.$store
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

  test('only animates opacity, so it runs on the compositor', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expectTabHighlightAligned(page.locator('.tabs [aria-selected="true"]'))

    // The initial placement is intentionally not animated
    await page.locator('[data-subscription-feed-tab="shorts"]').click()

    await expectTabHighlightStyle(page.locator('.tabs [aria-selected="true"]'), 'transitionProperty', 'opacity')
  })

  test('paints selection feedback before mounting the selected feed', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    await expectTabHighlightAligned(page.locator('.tabs [aria-selected="true"]'))
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.locator('#subscriptionsPanel.newFeed')).toBeVisible()

    const state = await page.evaluate(() => {
      return new Promise(resolve => {
        requestAnimationFrame(() => {
          document.querySelector('[data-subscription-feed-tab="videos"]').click()

          requestAnimationFrame(() => resolve({
            visuallySelectedTab: document.querySelector('.tab.selectedTab')
              ?.dataset.subscriptionFeedTab,
            panelIsStillNew: document.querySelector('#subscriptionsPanel')
              ?.classList.contains('newFeed')
          }))
        })
      })
    })

    expect(state.visuallySelectedTab).toBe('videos')
    expect(state.panelIsStillNew).toBe(true)
    await expect(page.getByText('video video 000')).toBeVisible()
  })

  test('runs the indicator transition while rendering a large feed', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    await expectTabHighlightAligned(page.locator('.tabs [aria-selected="true"]'))

    await expectTabHighlightStyle(page.locator('.tabs [aria-selected="true"]'), 'opacity', '1')
    const animation = await page.getByRole('tablist', { name: 'Subscriptions tabs' }).evaluate(tablist => new Promise(resolve => {
      // Observe both incoming and outgoing pseudo-element opacity transitions.
      const timeout = setTimeout(() => {
        tablist.removeEventListener('transitionrun', onTransition)
        resolve(null)
      }, 2000)
      function onTransition(event) {
        if (event.propertyName !== 'opacity' || !(event.target instanceof Element) ||
            event.pseudoElement !== '::before' || !event.target.matches('[role="tab"]')) return
        clearTimeout(timeout)
        tablist.removeEventListener('transitionrun', onTransition)
        resolve(Number.parseFloat(getComputedStyle(event.target, '::before').transitionDuration))
      }
      tablist.addEventListener('transitionrun', onTransition)
      tablist.querySelector('[data-subscription-feed-tab="shorts"]').click()
    }))

    expect(animation).toBeCloseTo(0.14, 2)
  })

  test('does not replay cached feed appearance when switching back to it', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await expect(page.getByText('video video 000')).toBeVisible()
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.locator('#subscriptionsPanel.newFeed')).toBeVisible()
    await page.evaluate(() => {
      window.__cachedFeedAnimationCount = 0
      window.__originalFeedAnimate = Element.prototype.animate
      Element.prototype.animate = function (...args) {
        if (this.matches('.autoGrid')) window.__cachedFeedAnimationCount++
        return window.__originalFeedAnimate.apply(this, args)
      }
    })
    try {
      await page.locator('[data-subscription-feed-tab="videos"]').click()
      await expect(page.getByText('video video 000')).toBeVisible()
      expect(await page.evaluate(() => window.__cachedFeedAnimationCount)).toBe(0)
    } finally {
      await page.evaluate(() => { Element.prototype.animate = window.__originalFeedAnimate })
    }
  })

  test('does not animate a cached empty-state message', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.getByText('There is no new content.')).toBeVisible()
    await page.locator('[data-subscription-feed-tab="videos"]').click()
    await expect(page.getByText('video video 000')).toBeVisible()

    const messageIsAnimated = await page.evaluate(() => new Promise(resolve => {
      const target = document.querySelector('[data-subscription-feed-tab="all"]')

      function inspectFrame() {
        if (target.getAttribute('aria-selected') !== 'true') {
          requestAnimationFrame(inspectFrame)
          return
        }

        requestAnimationFrame(() => {
          const panel = document.querySelector('#subscriptionsPanel')
          const message = panel.querySelector('.message')
          resolve(panel.getAnimations({ subtree: true }).some(animation => {
            return animation.effect.target === message || animation.effect.target.contains(message)
          }))
        })
      }

      target.click()
      requestAnimationFrame(inspectFrame)
    }))

    expect(messageIsAnimated).toBe(false)
  })

  test('defers hidden feed cache updates until it is activated', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    const retainedPanel = await page.locator('#subscriptionsPanel').elementHandle()

    await page.locator('[data-subscription-feed-tab="all"]').click()
    await expect(page.locator('#subscriptionsPanel.newFeed')).toBeVisible()
    await page.evaluate(channelId => {
      const store = window.$store
      const replacement = {
        ...store.getters.getVideoCache[channelId].videos[0],
        videoId: 'background-update',
        title: 'Background update'
      }

      store.commit('updateVideoCacheByChannel', {
        channelId,
        entries: [replacement],
        timestamp: new Date()
      })
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-channel', {
        detail: { tab: 'videos' }
      }))
    }, CHANNEL_ID)

    // Give a background refresh time to (wrongly) reach the retained panel.
    await page.waitForTimeout(600)
    expect(await retainedPanel.textContent()).not.toContain('Background update')

    await page.locator('[data-subscription-feed-tab="videos"]').click()
    await expect(page.getByText('Background update')).toBeVisible()
  })

  test('ends up aligned with the selected tab', async ({ page, attachScreenshot }) => {
    await goTo(page, 'subscriptions')

    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.locator('.tab.selectedTab')).toHaveText(/Shorts/)

    const shorts = page.locator('[data-subscription-feed-tab="shorts"]')
    await expect.poll(() => shorts.evaluate(tabHighlightAnimations)).toEqual([])
    await expectTabHighlightAligned(shorts)
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

    // Let a stale Shorts activation land if it would.
    await page.waitForTimeout(400)

    await expect(page.locator('.tab.selectedTab')).toHaveText(/Videos/)
    await expect(page.getByText('video video 000')).toBeVisible()

    await expectTabHighlightAligned(page.locator('[data-subscription-feed-tab="videos"]'))
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

  test('keeps pagination limits separate between feed tabs', async ({ page }) => {
    await goTo(page, 'subscriptions')

    const panelItems = page.locator('#subscriptionsPanel .autoGrid').first().locator(':scope > div')
    await expect(panelItems).toHaveCount(100)
    await page.getByRole('button', { name: 'Load More Videos' }).click()
    await expect(panelItems).toHaveCount(150)

    await page.locator('[data-subscription-feed-tab="shorts"]').click()
    await expect(page.locator('[data-subscription-feed-tab="shorts"]'))
      .toHaveAttribute('aria-selected', 'true')
    await expect(panelItems).toHaveCount(100)
    await expect(page.getByRole('button', { name: 'Load More Videos' })).toBeVisible()
  })

  test('restores the fallback feed scroll after a background visibility change', async ({ page }) => {
    await goTo(page, 'subscriptions')

    await expect(page.getByText('video video 000')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

    await page.locator(sel.newTabButton).click()
    await goTo(page, 'settings')
    await page.evaluate(async () => {
      const store = window.$store
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
      const store = window.$store

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
