import { test, expect, goTo, goToSettingsSection } from '../../helpers/app.mjs'
import { largeSubscriptionsSeed } from '../../performance/subscriptions.mjs'

test('opens phone settings without repeated scrollbar remeasurement before painting', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await goTo(page, 'settings')
  const reads = await page.evaluate(() => new Promise(resolve => {
    const originalStyle = window.getComputedStyle
    let reads = 0
    window.getComputedStyle = (...args) => {
      if (args[0].matches('.settingsContent')) reads++
      return originalStyle(...args)
    }
    document.querySelector('.settingsMenu [data-section="playback"]').click()
    requestAnimationFrame(() => {
      window.getComputedStyle = originalStyle
      resolve(reads)
    })
  }))
  await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()
  // Bound layout work instead of asserting machine-dependent milliseconds.
  expect(reads).toBeLessThanOrEqual(20)
})

async function expectCurrentScrollRange(content) {
  let measurements
  await expect.poll(async () => {
    measurements = await content.evaluate(element => {
      const wrapper = element.querySelector(':scope > .section, :scope > .settingsSearchResults')
      const style = getComputedStyle(element)
      const renderedEnd = wrapper.getBoundingClientRect().bottom +
        Number.parseFloat(getComputedStyle(wrapper).marginBottom) + Number.parseFloat(style.paddingBottom)
      const viewportEnd = element.getBoundingClientRect().bottom - Number.parseFloat(style.borderBottomWidth)
      const maximum = Math.max(0, element.scrollTop + renderedEnd - viewportEnd)
      const tolerance = 2 / devicePixelRatio
      const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
      const offsetIsValid = element.scrollTop <= maximum + tolerance &&
        Math.abs(element.scrollHeight - element.clientHeight - maximum) <= tolerance
      const unusable = scrollbar.classList.contains('os-scrollbar-unusable')
      const track = scrollbar.querySelector('.os-scrollbar-track').getBoundingClientRect()
      const handle = scrollbar.querySelector('.os-scrollbar-handle')
      const thumb = handle.getBoundingClientRect()
      const thumbRatio = thumb.height / track.height
      const expectedRatio = Math.max(element.clientHeight / element.scrollHeight,
        Number.parseFloat(getComputedStyle(handle).minHeight) / track.height)
      const thumbOffset = thumb.top - track.top
      const expectedOffset = maximum <= tolerance
        ? 0
        : element.scrollTop / maximum * Math.max(0, track.height - thumb.height)
      // A hidden, unusable thumb has no meaningful position to compare.
      const thumbPositionIsValid = maximum <= tolerance || Math.abs(thumbOffset - expectedOffset) <= tolerance
      const scrollbarIsValid = maximum <= tolerance
        ? unusable && thumbPositionIsValid
        : !unusable && Math.abs(thumbRatio - expectedRatio) < 0.02 && thumbPositionIsValid
      return { valid: offsetIsValid && scrollbarIsValid, maximum, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, thumbRatio, expectedRatio, thumbOffset, expectedOffset, unusable }
    })
    return measurements.valid
  }).toBe(true).catch(error => {
    error.message += `\nScroll measurements: ${JSON.stringify(measurements)}`
    throw error
  })
}

async function scrollSettingsToBottom(content) {
  await content.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expectCurrentScrollRange(content)
}

for (const uiScale of [100, 125]) {
  test.describe(`phone settings scroll ranges at ${uiScale}% UI scale`, () => {
    test.use({ seed: { settings: { uiScale, enableDownloads: true, reducedMotion: 'on', alwaysShowScrollbars: true } } })

    test('reconciles collapsed controls and wider phone layouts from the bottom', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 640 })
      const section = await goToSettingsSection(page, 'download')
      const content = page.locator('.settingsContent')
      await scrollSettingsToBottom(content)
      const previousHeight = await content.evaluate(element => element.scrollHeight)
      // Toggle without Playwright scrolling the control into view first.
      await section.getByRole('checkbox', { name: 'Enable Downloads' }).evaluate(element => element.click())
      await expect(section.locator('.downloadPathInputs')).toHaveCount(0)
      await expectCurrentScrollRange(content)
      expect(await content.evaluate(element => element.scrollHeight)).toBeLessThan(previousHeight)

      await page.locator('.settingsBackButton').click()
      await goToSettingsSection(page, 'playback')
      await scrollSettingsToBottom(content)
      await page.setViewportSize({ width: 640, height: 640 })
      await expectCurrentScrollRange(content)
    })

    test('resets category replacements and shortened search results from the bottom', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 640 })
      await goToSettingsSection(page, 'playback')
      const content = page.locator('.settingsContent')
      await scrollSettingsToBottom(content)
      await page.locator('.settingsBackButton').click()
      await goToSettingsSection(page, 'privacy')
      await expect(content).toHaveJSProperty('scrollTop', 0)
      await expectCurrentScrollRange(content)

      const search = page.getByRole('searchbox', { name: 'Search settings' })
      await search.fill('a')
      await scrollSettingsToBottom(content)
      await search.fill('Default Volume')
      await expect(content).toHaveJSProperty('scrollTop', 0)
      await expectCurrentScrollRange(content)
      await expect(content.locator(':scope > .os-scrollbar-vertical')).toHaveClass(/os-scrollbar-unusable/)
      await page.locator('.settingsSearchResultHeading').click()
      await expect(content.locator(':scope > [data-section="playback"]')).toBeVisible()
      await expect(content).toHaveJSProperty('scrollTop', 0)
      await expectCurrentScrollRange(content)
    })
  })
}

test.describe('Home subscription processing', () => {
  test.use({
    seed: {
      ...largeSubscriptionsSeed,
      profiles: largeSubscriptionsSeed.profiles.map(profile => ({
        ...profile,
        subscriptions: profile.subscriptions.slice(0, 300)
      })),
      subscriptionCache: largeSubscriptionsSeed.subscriptionCache.slice(0, 300)
    }
  })

  test('opens Home without copying the cache or repeatedly reading reactive sort keys', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await goTo(page, 'userplaylists')
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      window.navigationCopies = 0
      window.navigationTimestampReads = 0
      for (const channel of Object.values(store.getters.getVideoCache)) {
        for (const video of channel.videos) {
          Object.defineProperty(video, 'navigationCopyProbe', {
            configurable: true,
            enumerable: true,
            get() { window.navigationCopies++; return true }
          })
          const published = video.published
          Object.defineProperty(video, 'published', {
            configurable: true,
            enumerable: true,
            get() { window.navigationTimestampReads++; return published }
          })
        }
      }
    })
    await goTo(page, 'home')
    await expect(page.getByText('Video 0-0', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.navigationCopies)).toBe(0)
    expect(await page.evaluate(() => window.navigationTimestampReads)).toBeLessThanOrEqual(3 * 300 * 36)

    // The shelf keeps the source entries reactive after skipping decoration.
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const channel = store.getters.getActiveProfile.subscriptions[0].id
      store.getters.getVideoCache[channel].videos[0].title = 'Updated Home video'
    })
    await expect(page.getByText('Updated Home video', { exact: true })).toBeVisible()
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const channel = store.getters.getActiveProfile.subscriptions[0].id
      store.getters.getVideoCache[channel].videos[0].isNewInSubscriptionFeed = false
    })
    await expect(page.getByText('Updated Home video', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Video 1-0', { exact: true })).toBeVisible()
  })
})

for (const limit of ['global', 'daily']) {
  test.describe(`Home with a ${limit} channel limit`, () => {
    const channel = largeSubscriptionsSeed.profiles[0].subscriptions[0]
    const thumbnail = color => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="${color}"/></svg>`)}`
    const refreshedThumbnail = thumbnail('blue')
    test.use({
      seed: {
        settings: {
          ...largeSubscriptionsSeed.settings,
          hideSubscriptionsVideos: true,
          hideSubscriptionsShorts: false,
          onlyShowLatestFromChannel: limit === 'global',
          onlyShowLatestFromChannelNumber: 1
        },
        profiles: [{
          ...largeSubscriptionsSeed.profiles[0],
          subscriptions: [{ ...channel, ...(limit === 'daily' ? { dailyVideoLimit: 1 } : {}) }]
        }],
        subscriptionCache: [{
          ...largeSubscriptionsSeed.subscriptionCache[0],
          videos: [],
          shorts: largeSubscriptionsSeed.subscriptionCache[0].videos.slice(0, 3).map((video, index) => ({
            ...video,
            title: `Limited Short ${index}`,
            published: new Date(2026, 9, 3, 12, 0, 3 - index).getTime(),
            thumbnailUrl: thumbnail('red')
          }))
        }]
      }
    })

    test('updates retained Home cards when cached Shorts metadata changes in place', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      await goTo(page, 'home')
      const cards = page.locator('[data-home-section="newSinceLastVisit"] .mediaGrid li')
      await expect(cards).toHaveCount(1)
      await expect(cards).toContainText('Limited Short 0')
      await page.evaluate(thumbnailUrl => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
        const channelId = store.getters.getActiveProfile.subscriptions[0].id
        const video = store.state.subscriptionCache.shortsCache[channelId].videos[0]
        store.commit('updateShortsCacheWithChannelPageShorts', {
          channelId,
          entries: [{ ...video, title: 'Refreshed Limited Short', thumbnailUrl }]
        })
      }, refreshedThumbnail)
      await expect(cards).toHaveCount(1)
      await expect(cards).toContainText('Refreshed Limited Short')
      await expect(cards.locator('img')).toHaveAttribute('src', refreshedThumbnail)
    })
  })
}
