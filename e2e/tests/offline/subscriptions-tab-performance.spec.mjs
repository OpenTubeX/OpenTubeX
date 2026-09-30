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
  const metrics = await runLargeSubscriptionsBenchmark(page)

  expect(metrics.firstSwitchLongestFrameMs).toBeLessThan(200)
  expect(metrics.firstSwitchElapsedMs).toBeLessThan(250)
  expect(metrics.repeatedSwitchLongestFrameMs).toBeLessThan(100)
  expect(metrics.repeatedSwitchElapsedMs).toBeLessThan(150)
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
  await page.locator('.ft-list-video .title').first().click({ button: 'middle' })
  await expect(page.locator('.tabContent[aria-hidden="true"] .videoLayout')).toBeAttached()
  await expect(page.locator('.newTabThumbnailMorph')).toHaveCount(0)
  await expect(page.locator('.feed-enter-active, .feed-enter-from, .feed-move')).toHaveCount(0)
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  for (const reducedMotion of ['off', 'on']) {
    await page.evaluate(async value => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateReducedMotion', value)
    }, reducedMotion)
    for (let index = 0; index < 3; index++) {
      const link = page.locator('#subscriptionsPanel .ft-list-video .title')
        .nth(index + (reducedMotion === 'on' ? 3 : 0) + 1)
      const videoId = /\/watch\/([^?]+)/.exec(await link.getAttribute('href'))[1]
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
      expect.soft(metrics.elapsed).toBeLessThan(400)
      expect.soft(metrics.longestFrame).toBeLessThan(250)
      await expect(page.locator('.newTabThumbnailMorph')).toHaveCount(0)
      await expect.poll(() => page.evaluate(id => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        return JSON.parse(store.getters.getSubscriptionSeenVideos)
          .some(entry => entry.videoId === id && entry.seenAt > (entry.unseenAt ?? 0))
      }, videoId)).toBe(true)
    }
  }
  await session.detach()
})
