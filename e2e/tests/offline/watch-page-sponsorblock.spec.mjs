import crypto from 'node:crypto'

import { test, expect } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

test.use({ seed: { settings: WATCH_PAGE_SEED } })

async function expectSponsorBlockContentClamp(content, previousScrollTop) {
  await expect.poll(() => content.evaluate((element, previousScrollTop) => {
    const viewportBounds = element.getBoundingClientRect()
    const contentEndBounds = element.querySelector('.sponsorBlockFooter').getBoundingClientRect()
    const maximumScrollTop = Math.max(
      0,
      element.scrollTop + contentEndBounds.bottom - viewportBounds.bottom
    )
    const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
    const hasVerticalOverflow = maximumScrollTop > 1
    return {
      scrollTopReduced: element.scrollTop < previousScrollTop,
      withinRenderedRange: element.scrollTop <= maximumScrollTop + 1,
      scrollbarMatchesOverflow:
        scrollbar?.classList.contains('os-scrollbar-visible') === hasVerticalOverflow
    }
  }, previousScrollTop)).toEqual({
    scrollTopReduced: true,
    withinRenderedRange: true,
    scrollbarMatchesOverflow: true
  })
}

async function measureSponsorBlockSkipStartTime(app, page, { rendererLoad = false } = {}) {
  await mockPlayableWatchPage(app, page)
  await page.route('**/api/skipSegments/**', route => route.fulfill({
    body: JSON.stringify([{
      videoID: 'jNQXAC9IVRw',
      segments: [{
        UUID: 'timed-skip-segment',
        actionType: 'skip',
        category: 'sponsor',
        description: '',
        locked: 0,
        segment: [15, 20],
        videoDuration: 30,
        votes: 1
      }]
    }]),
    contentType: 'application/json'
  }))
  await page.evaluate(() => {
    const store = window.$store
    store.commit('setUseSponsorBlock', true)
  })

  await openMockedVideo(page)
  await expect(page.locator('.sponsorBlockMarker')).toHaveCount(1)

  const video = page.locator('.ftVideoPlayer video')
  await video.evaluate((element, rendererLoad) => {
    element.pause()
    element.currentTime = 14.57
    element.dispatchEvent(new Event('timeupdate'))

    let loadInterval
    window.__sponsorBlockLoadTasks = 0
    if (rendererLoad) {
      // Use fixed-duration work so the load does not depend on host CPU speed.
      // Leave gaps for the skip scheduler to run while playback advances.
      loadInterval = setInterval(() => {
        const end = performance.now() + 30
        while (performance.now() < end) { /* simulate renderer work */ }
        window.__sponsorBlockLoadTasks++
      }, 50)
    }

    const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
    Object.defineProperty(element, 'currentTime', {
      configurable: true,
      get: currentTime.get,
      set(value) {
        if (value === 20) {
          window.__sponsorBlockSkipStartedAt = currentTime.get.call(this)
          clearInterval(loadInterval)
        }
        currentTime.set.call(this, value)
      }
    })
    element.addEventListener('timeupdate', event => event.stopImmediatePropagation(), { capture: true })
    return element.play()
  }, rendererLoad)

  await expect.poll(() => page.evaluate(() => window.__sponsorBlockSkipStartedAt ?? null)).not.toBeNull()
  if (rendererLoad) {
    expect(await page.evaluate(() => window.__sponsorBlockLoadTasks)).toBeGreaterThan(0)
  }
  return page.evaluate(() => window.__sponsorBlockSkipStartedAt)
}

test.describe('watch page', () => {
  test('shows SponsorBlock contribution stats for the existing user ID', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    let expectedPublicUserId = 'test-contributor'
    for (let round = 0; round < 5000; round++) {
      expectedPublicUserId = crypto.createHash('sha256').update(expectedPublicUserId).digest('hex')
    }

    let userInfoRequests = 0
    let requestedUserInfoUrl = null
    let segmentRequests = 0
    await page.route('**/api/skipSegments/**', async (route) => {
      segmentRequests++
      const segments = segmentRequests === 1
        ? Array.from({ length: 18 }, (_, index) => ({
            UUID: `contribution-stats-segment-${index}`,
            actionType: 'skip',
            category: 'sponsor',
            description: '',
            locked: 0,
            segment: [index, index + 0.5],
            videoDuration: 19,
            votes: 1
          }))
        : []
      await route.fulfill({
        body: JSON.stringify([{ videoID: 'jNQXAC9IVRw', segments }]),
        contentType: 'application/json'
      })
    })
    await page.route('**/api/userInfo?*', async (route) => {
      userInfoRequests++
      requestedUserInfoUrl = new URL(route.request().url())
      const publicUserIdMatches = requestedUserInfoUrl.searchParams.get('publicUserID') === expectedPublicUserId
      await route.fulfill({
        body: JSON.stringify(publicUserIdMatches
          ? {
              segmentCount: 42,
              viewCount: 1234,
              minutesSaved: 22759
            }
          : {
              segmentCount: 0,
              viewCount: 0,
              minutesSaved: 0
            }),
        contentType: 'application/json'
      })
    })

    await page.evaluate(async () => {
      const store = window.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockGeneratedUserId', 'test-contributor')
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
      await store.dispatch('updateUiScale', 125)
    })
    await openMockedVideo(page)
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()

    const panel = page.locator('.watchVideoSponsorBlock')
    const stats = panel.locator('.sponsorBlockContributionStats')
    await expect(stats).toContainText('Your contributions')
    await expect(stats.locator('dt')).toHaveText(['Submissions', 'Segments', 'Time saved'])
    await expect(stats.locator('dd')).toHaveText(['42', '1,234', '379 hr 19 min'])
    const metricLayout = await stats.locator('.sponsorBlockContributionMetric').evaluateAll(metrics => {
      return metrics.map((metric) => {
        const labelBounds = metric.querySelector('dt').getBoundingClientRect()
        const valueBounds = metric.querySelector('dd').getBoundingClientRect()
        const metricBounds = metric.getBoundingClientRect()
        return {
          labelBottom: labelBounds.bottom,
          metricCenter: metricBounds.left + metricBounds.width / 2,
          valueCenter: valueBounds.top + valueBounds.height / 2,
          valueTop: valueBounds.top
        }
      })
    })
    expect(metricLayout.every(({ labelBottom, valueTop }) => labelBottom <= valueTop)).toBe(true)
    expect(Math.abs(
      (metricLayout[1].metricCenter - metricLayout[0].metricCenter) -
      (metricLayout[2].metricCenter - metricLayout[1].metricCenter)
    )).toBeLessThanOrEqual(1)
    expect(Math.max(...metricLayout.map(({ valueCenter }) => valueCenter)) -
      Math.min(...metricLayout.map(({ valueCenter }) => valueCenter))).toBeLessThanOrEqual(1)
    await expect(panel.locator('.sponsorBlockSegment')).toHaveCount(18)
    expect(userInfoRequests).toBe(1)
    expect(requestedUserInfoUrl.searchParams.get('publicUserID')).toBe(expectedPublicUserId)
    expect(JSON.parse(requestedUserInfoUrl.searchParams.get('values'))).toEqual([
      'segmentCount',
      'viewCount',
      'minutesSaved'
    ])

    const content = panel.locator('.sponsorBlockContent')
    await panel.evaluate((element) => { element.style.inlineSize = '240px' })
    await expect(panel).toHaveCSS('width', '240px')
    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const narrowScrollTop = await content.evaluate(element => element.scrollTop)
    await panel.evaluate((element) => { element.style.inlineSize = '' })
    await expect.poll(() => panel.evaluate(element => element.getBoundingClientRect().width))
      .toBeGreaterThan(240)
    await expectSponsorBlockContentClamp(content, narrowScrollTop)

    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    const enabledScrollTop = await content.evaluate(element => element.scrollTop)
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateSponsorBlockEnableSubmission', false)
    })
    await expect(stats).toHaveCount(0)
    await expectSponsorBlockContentClamp(content, enabledScrollTop)
    await page.evaluate(async () => {
      const store = window.$store
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })
    await expect(stats).toBeVisible()

    await panel.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()
    await expect.poll(() => userInfoRequests).toBe(1)

    await content.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Refresh SponsorBlock information' }).click()
    await expect.poll(() => userInfoRequests).toBe(2)
    await expect(panel.locator('.sponsorBlockSegment')).toHaveCount(0)
    await expect.poll(() => content.evaluate((element) => {
      const scrollbar = element.querySelector('.os-scrollbar-vertical')
      const hasVerticalOverflow = element.scrollHeight > element.clientHeight + 1
      return {
        hasVerticalOverflow,
        hasVisibleScrollbar: scrollbar?.classList.contains('os-scrollbar-visible'),
        scrollTop: element.scrollTop
      }
    })).toEqual({
      hasVerticalOverflow: false,
      hasVisibleScrollbar: false,
      scrollTop: 0
    })
  })

  test('hides SponsorBlock contribution stats when submission is disabled', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockGeneratedUserId', 'test-contributor')
    })
    await expect.poll(() => page.evaluate(() => {
      return window.$store.getters
        .getSponsorBlockEnableSubmission
    })).toBe(false)
    await openMockedVideo(page)
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()

    await expect(page.locator('.sponsorBlockContributionStats')).toHaveCount(0)
  })

  test('does not create a SponsorBlock user ID to load contribution stats', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)

    let userInfoRequests = 0
    await page.route('**/api/userInfo?*', (route) => {
      userInfoRequests++
      return route.abort()
    })
    await page.evaluate(async () => {
      const store = window.$store
      store.commit('setUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })
    await openMockedVideo(page)
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()

    await expect(page.locator('.sponsorBlockContributionStats')).toContainText(
      'Submit a segment or import your SponsorBlock user ID to see contribution stats.'
    )
    expect(userInfoRequests).toBe(0)
  })

  test('uses a custom SponsorBlock category color for markers and prompts', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{
          UUID: 'custom-color-sponsor',
          actionType: 'skip',
          category: 'sponsor',
          description: '',
          locked: 0,
          segment: [15, 20],
          videoDuration: 30,
          votes: 1
        }]
      }]),
      contentType: 'application/json'
    }))
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockSponsor', { color: '#123456', skip: 'promptToSkip' })
    })

    await openMockedVideo(page)

    const marker = page.locator('.sponsorBlockMarker')
    await expect(marker).toHaveCount(1)
    await expect(marker).toHaveCSS('background-color', 'rgb(18, 52, 86)')

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 16
      element.dispatchEvent(new Event('timeupdate'))
    })
    const prompt = page.locator('.skippedSegment').filter({ hasText: 'Skip Sponsor?' })
    await expect(prompt).toBeVisible()
    await expect(prompt.locator('.skippedSegmentShield')).toHaveCSS('color', 'rgb(18, 52, 86)')
  })

  test('does not restore a SponsorBlock prompt when a skip remains inside the segment', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{
          UUID: 'terminal-outro',
          actionType: 'skip',
          category: 'outro',
          description: '',
          locked: 0,
          segment: [15, 40],
          videoDuration: 40,
          votes: 1
        }]
      }]),
      contentType: 'application/json'
    }))
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setUseSponsorBlock', true)
    })
    await openMockedVideo(page)

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 16
      element.dispatchEvent(new Event('timeupdate'))
    })

    const prompt = page.locator('.skippedSegment').filter({ hasText: 'Skip Endcards/Credits?' })
    await expect(prompt).toBeVisible()
    await prompt.getByRole('button', { name: /Skip/ }).click()
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeLessThan(40)
    await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))

    await expect(page.locator('.skippedSegment').filter({ hasText: 'Endcards/Credits Skipped' })).toBeVisible()
    await expect(prompt).toHaveCount(0)
  })

  test('shows one toast for SponsorBlock segments skipped together', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    // [15, 17] lies inside [13, 20], so the jump covers it without extending the skip
    const segments = [[10, 11.5], [11.51, 14], [13, 20], [15, 17]].map((segment, index) => ({
      UUID: `chained-sponsor-${index}`,
      actionType: 'skip',
      category: 'sponsor',
      description: '',
      locked: 0,
      segment,
      videoDuration: 30,
      votes: 1
    }))
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{ videoID: 'jNQXAC9IVRw', segments }]),
      contentType: 'application/json'
    }))
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setUseSponsorBlock', true)
    })
    await openMockedVideo(page)
    await expect(page.locator('.sponsorBlockMarker')).toHaveCount(4)

    const video = page.locator('.ftVideoPlayer video')
    const seekTo = time => video.evaluate((element, time) => {
      element.pause()
      element.currentTime = time
      element.dispatchEvent(new Event('timeupdate'))
    }, time)

    await seekTo(10.2)
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(20)
    await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))
    const toast = page.locator('.skippedSegment')
    expect(await toast.allInnerTexts()).toEqual([expect.stringContaining('Sponsor Skipped')])

    // unskipping covers the whole group, so playback inside a later segment is not skipped again
    await toast.getByRole('button', { name: 'Unskip' }).click()
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(10)
    await seekTo(13.5)
    await expect(toast.getByRole('button', { name: 'Reskip' })).toBeVisible()
    expect(await video.evaluate(element => element.currentTime)).toBe(13.5)
    await seekTo(16)
    expect(await video.evaluate(element => element.currentTime)).toBe(16)

    await toast.getByRole('button', { name: 'Reskip' }).click()
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(20)
    expect(await toast.count()).toBe(1)
    await expect(toast.locator('.skippedSegmentShield')).toHaveCount(1)
  })

  test('stacks a shield per category in a grouped SponsorBlock skip toast @scale', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const segments = [['selfpromo', [10, 12]], ['sponsor', [12, 20]]].map(([category, segment]) => ({
      UUID: `grouped-${category}`,
      actionType: 'skip',
      category,
      description: '',
      locked: 0,
      segment,
      videoDuration: 30,
      votes: 1
    }))
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{ videoID: 'jNQXAC9IVRw', segments }]),
      contentType: 'application/json'
    }))
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockSelfPromo', { color: '#123456', skip: 'autoSkip' })
      store.commit('setSponsorBlockSponsor', { color: '#654321', skip: 'autoSkip' })
    })
    await openMockedVideo(page)

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 10.2
      element.dispatchEvent(new Event('timeupdate'))
    })
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBe(20)

    const toast = page.locator('.skippedSegment').filter({ hasText: 'Unpaid/Self Promotion and Sponsor Skipped' })
    const shields = toast.locator('.skippedSegmentShield')
    await expect(shields).toHaveCount(2)
    await expect(shields.nth(0)).toHaveCSS('color', 'rgb(18, 52, 86)')
    await expect(shields.nth(1)).toHaveCSS('color', 'rgb(101, 67, 33)')

    const [first, second] = await shields.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))
    expect(second.left).toBeGreaterThan(first.left)
    expect(second.left).toBeLessThan(first.right)
  })

  test('dismisses a SponsorBlock prompt when playback ends', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [{
          UUID: 'terminal-outro-prompt',
          actionType: 'skip',
          category: 'outro',
          description: '',
          locked: 0,
          segment: [15, 30],
          videoDuration: 30,
          votes: 1
        }]
      }]),
      contentType: 'application/json'
    }))
    await page.evaluate(() => {
      const store = window.$store
      store.commit('setUseSponsorBlock', true)
    })
    await openMockedVideo(page)

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(async element => {
      element.pause()
      const seeked = new Promise(resolve => element.addEventListener('seeked', resolve, { once: true }))
      element.currentTime = 29
      await seeked
    })

    const prompt = page.locator('.skippedSegment').filter({ hasText: 'Skip Endcards/Credits?' })
    await expect(prompt).toBeVisible()
    // A synthetic ended event leaves playback inside the segment, where a queued
    // timeupdate can recreate the prompt. Let the media actually finish instead.
    await video.evaluate(element => element.play())
    await expect.poll(() => video.evaluate(element => element.ended)).toBe(true)

    await expect(prompt).toHaveCount(0)
  })

  test('previews and submits edited SponsorBlock timestamps', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    let submittedBody = null
    let userInfoRequests = 0

    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([]),
      contentType: 'application/json'
    }))
    await page.route('**/api/skipSegments', async route => {
      submittedBody = route.request().postDataJSON()
      await route.fulfill({
        body: JSON.stringify([{
          UUID: 'submitted-edited-segment',
          category: 'sponsor',
          segment: [11.722, 12]
        }]),
        contentType: 'application/json'
      })
    })
    await page.route('**/api/userInfo?*', async route => {
      userInfoRequests++
      await route.fulfill({
        body: JSON.stringify({
          segmentCount: userInfoRequests,
          viewCount: 0,
          minutesSaved: 0
        }),
        contentType: 'application/json'
      })
    })
    await page.evaluate(async () => {
      const store = window.$store
      store.commit('setUseSponsorBlock', true)
      store.commit('setSponsorBlockGeneratedUserId', 'test-contributor')
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })

    await openMockedVideo(page)
    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()
    await expect.poll(() => userInfoRequests).toBe(1)
    await page.locator('.watchVideoSponsorBlock').getByRole('button', { name: 'Close' }).click()

    const video = page.locator('.ftVideoPlayer video')
    await video.evaluate(element => {
      element.pause()
      element.currentTime = 11
    })
    await page.locator('.sponsorblock-start-button').click({ force: true })
    await video.evaluate(element => { element.currentTime = 12 })
    await page.locator('.sponsorblock-end-button').click({ force: true })

    const submissionMenu = page.locator('.sponsorBlockSubmissionMenu')
    await submissionMenu.locator('.sponsorBlockDraftTimeInput').first().fill('0:11.722')
    await submissionMenu.getByRole('button', { name: 'Inspect' }).click()
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(11.722, 3)

    await video.evaluate(element => {
      const currentTime = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
      Object.defineProperty(element, 'currentTime', {
        configurable: true,
        get: currentTime.get,
        set(value) {
          window.__sponsorBlockPreviewSeekTime ??= value
          currentTime.set.call(this, value)
        }
      })
    })
    await submissionMenu.getByRole('button', { name: 'Preview' }).click()
    await expect.poll(() => page.evaluate(() => window.__sponsorBlockPreviewSeekTime ?? null))
      .toBeCloseTo(9.722, 3)
    await video.evaluate(element => {
      element.currentTime = 11.8
      element.dispatchEvent(new Event('timeupdate'))
    })
    await submissionMenu.locator('.sponsorBlockSubmissionButton').click()

    await expect.poll(() => submittedBody).not.toBeNull()
    expect(submittedBody.segments).toEqual([{
      actionType: 'skip',
      category: 'sponsor',
      description: '',
      segment: [11.722, 12]
    }])

    await page.getByRole('button', { name: 'Open SponsorBlock info' }).click()
    await expect.poll(() => userInfoRequests).toBe(2)
  })

  test('skips SponsorBlock segments at their boundary without timeupdate events', async ({ app, page }) => {
    const skipStartedAt = await measureSponsorBlockSkipStartTime(app, page)
    expect(skipStartedAt).toBeGreaterThanOrEqual(15)
    expect(skipStartedAt).toBeLessThan(15.05)
  })

  test('skips SponsorBlock segments promptly under renderer load', async ({ app, page }) => {
    const skipStartedAt = await measureSponsorBlockSkipStartTime(app, page, { rendererLoad: true })
    expect(skipStartedAt).toBeGreaterThanOrEqual(15)
    expect(skipStartedAt).toBeLessThan(15.3)
  })

  test('displays and submits full-video SponsorBlock labels', async ({ app, page }) => {
    await mockPlayableWatchPage(app, page)
    const fullVideoSegment = {
      UUID: 'full-video-label',
      actionType: 'full',
      category: 'exclusive_access',
      description: '',
      locked: 0,
      segment: [0, 0],
      videoDuration: 19,
      votes: 1
    }
    let submittedBody = null

    await page.route('**/api/skipSegments/**', route => route.fulfill({
      body: JSON.stringify([{
        videoID: 'jNQXAC9IVRw',
        segments: [fullVideoSegment]
      }]),
      contentType: 'application/json'
    }))
    await page.route('**/api/skipSegments', async route => {
      submittedBody = route.request().postDataJSON()
      await route.fulfill({
        body: JSON.stringify([{
          UUID: 'submitted-full-video-label',
          category: 'exclusive_access',
          segment: [0, 0]
        }]),
        contentType: 'application/json'
      })
    })
    await page.evaluate(async () => {
      const store = window.$store
      store.commit('setUseSponsorBlock', true)
      await store.dispatch('updateSponsorBlockEnableSubmission', true)
    })

    await openMockedVideo(page)

    await expect(page.locator('.watchVideoInfo .videoBadge'))
      .toContainText('Exclusive Access · Full Video')

    await page.locator('.sponsorblock-start-button').click({ force: true })
    await page.locator('.sponsorblock-open-menu-button').click({ force: true })

    const submissionMenu = page.locator('.sponsorBlockSubmissionMenu')
    await expect(submissionMenu).toBeVisible()
    await submissionMenu.locator('select').first().selectOption('exclusive_access')
    await expect(submissionMenu.locator('select').nth(1)).toHaveValue('full')
    await expect(submissionMenu.locator('.sponsorBlockDraftTimeText')).toHaveText('Full Video')

    await submissionMenu.locator('.sponsorBlockSubmissionButton').click()
    await expect.poll(() => submittedBody).not.toBeNull()
    expect(submittedBody.segments).toEqual([{
      actionType: 'full',
      category: 'exclusive_access',
      description: '',
      segment: [0, 0]
    }])
    await expect(page.locator('.sponsorBlockMarker')).toHaveCount(0)
  })
})
