import { test, expect, goTo, sel, abortUnmockedRequest } from '../../helpers/app.mjs'
import {
  largeSubscriptionsSeed,
  runLargeSubscriptionsBenchmark
} from '../../performance/subscriptions.mjs'

test.use({
  seed: largeSubscriptionsSeed
})

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, abortUnmockedRequest)
})

test('switches a production-profile-sized cached feed without repeating expensive work', async ({ page }) => {
  await page.evaluate(() => {
    window.__switchOriginalSort = Array.prototype.sort
    window.__switchFeedSorts = 0
    // eslint-disable-next-line no-extend-native
    Array.prototype.sort = function (...args) {
      if (this.length >= 30_000) window.__switchFeedSorts++
      return window.__switchOriginalSort.apply(this, args)
    }
  })
  try {
    // `pnpm run test:performance` compares the switch timings between builds.
    await runLargeSubscriptionsBenchmark(page)
    // Repeating the switch must not sort the whole feed again.
    expect(await page.evaluate(() => window.__switchFeedSorts)).toBeLessThanOrEqual(1)
  } finally {
    // eslint-disable-next-line no-extend-native
    await page.evaluate(() => { Array.prototype.sort = window.__switchOriginalSort })
  }
})

test('defers the browsing feed beneath a background watch tab until it is presented', async ({ page }) => {
  await goTo(page, 'subscriptions')
  await expect(page.locator('.ft-list-video').first()).toBeVisible()
  await page.locator('.ft-list-video .title').first().click({ button: 'middle' })
  await expect(page.locator(sel.tabs)).toHaveCount(2)
  const background = page.locator('.tabContent[aria-hidden="true"]').first()
  await expect(background.locator('.watchPreviewHost .routerView')).toBeAttached()
  await expect(background.locator('.browsingBehindWatch')).toHaveCount(0)

  await page.locator(sel.tabs).nth(1).click()
  const browsing = page.locator('.tabContent[aria-hidden="false"] .browsingBehindWatch')
  await expect(browsing.locator('.ft-list-video').first()).toBeAttached()
  const retained = await browsing.elementHandle()
  await page.locator(sel.tabs).first().click()
  expect(await retained.evaluate(element => element.isConnected)).toBe(true)
})

test('opens background videos promptly from a large subscriptions feed', async ({ page }) => {
  await goTo(page, 'subscriptions')
  await expect(page.locator('.ft-list-video').first()).toBeVisible()
  // Load Watch's async bundle before sampling. Its one-time initialization
  // would otherwise measure module parsing alongside each tab's creation.
  const warmLink = page.locator('.ft-list-video .title').first()
  const warmVideoId = /\/watch\/([^?]+)/.exec(await warmLink.getAttribute('href'))[1]
  await warmLink.click({ button: 'middle' })
  await expect(page.locator('.tabContent[aria-hidden="true"] .videoLayout')).toBeAttached()
  await expect(page.locator('.newTabThumbnailMorph')).toHaveCount(0)
  await expect(page.locator('.feed-enter-active, .feed-enter-from, .feed-move')).toHaveCount(0)
  await expect.poll(() => page.evaluate(id => {
    const store = window.$store
    return [...store.getters.getSubscriptionSeenVideos.byId.values()]
      .some(entry => entry.videoId === id && entry.seenAt > (entry.unseenAt ?? 0))
  }, warmVideoId)).toBe(true)
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.evaluate(() => {
    window.__backgroundDocumentSnapshots = 0
    const startViewTransition = document.startViewTransition.bind(document)
    document.startViewTransition = (...args) => {
      window.__backgroundDocumentSnapshots++
      return startViewTransition(...args)
    }
  })
  for (const reducedMotion of ['off', 'on']) {
    await page.evaluate(async value => {
      const store = window.$store
      await store.dispatch('updateReducedMotion', value)
    }, reducedMotion)
    for (let index = 0; index < 3; index++) {
      const link = page.locator('#subscriptionsPanel .ft-list-video .title')
        .nth(index + (reducedMotion === 'on' ? 3 : 0) + 1)
      const videoId = /\/watch\/([^?]+)/.exec(await link.getAttribute('href'))[1]
      const cards = await page.evaluateHandle(() => [...document.querySelectorAll('#subscriptionsPanel .ft-list-video')])
      expect(await cards.evaluate(elements => elements.length)).toBeGreaterThan(0)
      await page.evaluate(() => {
        const initialTabs = document.querySelectorAll('.tabBar .tab').length
        window.__backgroundTabTiming = new Promise(resolve => {
          document.addEventListener('auxclick', () => {
            const startedAt = performance.now()
            let previous = startedAt
            let longestFrame = 0
            function frame() {
              const now = performance.now()
              longestFrame = Math.max(longestFrame, now - previous)
              previous = now
              if (document.querySelectorAll('.tabBar .tab').length > initialTabs) {
                resolve({ elapsed: now - startedAt, longestFrame })
              } else {
                requestAnimationFrame(frame)
              }
            }
            requestAnimationFrame(frame)
          }, { capture: true, once: true })
        })
      })
      await link.click({ button: 'middle' })
      const metrics = await page.evaluate(() => window.__backgroundTabTiming)
      console.log('Background tab opening:', { reducedMotion, ...metrics })
      await expect(page.locator(sel.tabs).first()).toHaveClass(/active/)
      // Opening the tab must neither rebuild the feed nor snapshot the document.
      expect(await cards.evaluate(elements => elements.every(element => element.isConnected))).toBe(true)
      await cards.dispose()
      expect(await page.evaluate(() => window.__backgroundDocumentSnapshots)).toBe(0)
      await expect(page.locator('.newTabThumbnailMorph')).toHaveCount(0)
      await expect.poll(() => page.evaluate(id => {
        const store = window.$store
        return [...store.getters.getSubscriptionSeenVideos.byId.values()]
          .some(entry => entry.videoId === id && entry.seenAt > (entry.unseenAt ?? 0))
      }, videoId)).toBe(true)
    }
  }
  await session.detach()
})

test('keeps the feed behind Watch as it was while a video opens and on Back', async ({ page }) => {
  // Watch hides the open sidebar, which widened the feed kept behind it.
  await page.evaluate(() => {
    if (!window.$store.getters.getIsSideNavOpen) window.$store.commit('toggleSideNav')
  })
  await goTo(page, 'subscriptions')
  await expect(page.locator('#subscriptionsPanel .ft-list-video').first()).toBeVisible()
  // Scroll like a reader, several screens down the feed.
  await page.evaluate(async () => {
    for (let top = 0; top <= 4000; top += 400) {
      window.scrollTo(0, top)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }
  })
  await expect(page.locator('#subscriptionsPanel .feed-enter-active, #subscriptionsPanel .feed-enter-from')).toHaveCount(0)
  await page.evaluate(() => {
    const panel = document.querySelector('#subscriptionsPanel')
    window.__behindWatchPanel = panel
    const count = nodes => [...nodes].reduce((total, node) => total + (node instanceof Element
      ? Number(node.matches('.ft-list-video')) + node.querySelectorAll('.ft-list-video').length
      : 0), 0)
    window.__behindWatchWork = { cardMounts: 0, cardUnmounts: 0, gridResizes: 0 }
    window.__behindWatchObserver = new MutationObserver(records => {
      for (const record of records) {
        window.__behindWatchWork.cardMounts += count(record.addedNodes)
        window.__behindWatchWork.cardUnmounts += count(record.removedNodes)
      }
    })
    window.__behindWatchObserver.observe(panel, { childList: true, subtree: true })
    const grid = panel.querySelector('.autoGrid')
    const thumbnailSize = () => grid.style.getPropertyValue('--thumbnail-grid-size')
    let size = thumbnailSize()
    window.__behindWatchSizeObserver = new MutationObserver(() => {
      if (thumbnailSize() !== size) window.__behindWatchWork.gridResizes++
      size = thumbnailSize()
    })
    window.__behindWatchSizeObserver.observe(grid, { attributes: true, attributeFilter: ['style'] })
  })
  // Every distant card that would mount, leave or remeasure does so within
  // a few frames of the layout change.
  const settle = () => page.evaluate(async () => {
    for (let frame = 0; frame < 30; frame++) await new Promise(resolve => requestAnimationFrame(resolve))
  })
  const takeWork = () => page.evaluate(() => {
    // A replaced panel would hide its new cards from the observers.
    const panel = window.__behindWatchPanel
    const work = { ...window.__behindWatchWork, panelKept: panel.isConnected && panel === document.querySelector('#subscriptionsPanel') }
    window.__behindWatchWork = { cardMounts: 0, cardUnmounts: 0, gridResizes: 0 }
    return work
  })
  const visibleCard = await page.evaluate(() => [...document.querySelectorAll('#subscriptionsPanel .ft-list-video')]
    .find(card => card.getBoundingClientRect().top > 200).querySelector('.title').getAttribute('href'))

  await page.locator(`#subscriptionsPanel .ft-list-video .title[href="${visibleCard}"]`).click()
  await expect(page).toHaveURL(/#\/watch\//)
  await expect(page.locator('.tabContent[aria-hidden="false"] .browsingBehindWatch')).toHaveCount(1)
  await settle()
  expect(await takeWork(), 'opening a video must leave the hidden feed alone').toEqual({ cardMounts: 0, cardUnmounts: 0, gridResizes: 0, panelKept: true })

  await page.locator(sel.backButton).click()
  await expect(page).toHaveURL(/#\/subscriptions$/)
  await settle()
  expect(await takeWork(), 'Back must show the cards the feed kept').toEqual({ cardMounts: 0, cardUnmounts: 0, gridResizes: 0, panelKept: true })
  await page.evaluate(() => {
    window.__behindWatchObserver.disconnect()
    window.__behindWatchSizeObserver.disconnect()
  })
})
