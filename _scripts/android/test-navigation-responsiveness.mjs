import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, expect } from '@playwright/test'
import { largeSubscriptionsSeed } from '../../e2e/performance/subscriptions.mjs'

// Acquire the Android lab lock and install the current debug APK first.
const serial = process.argv[2]
assert.ok(serial, 'Pass the locked emulator/device serial')
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim()
let browser
let page
let port
try {
  adb('shell', 'am', 'start', '--user', '0', '-n', 'org.opentubex.app.dev/org.opentubex.app.MainActivity')
  let pid = ''
  for (let attempt = 0; attempt < 50; attempt++) {
    try { pid = adb('shell', 'pidof', 'org.opentubex.app.dev') } catch { /* The app process may still be starting. */ }
    if (pid) break
    await delay(100)
  }
  assert.ok(pid, 'Android app process is available')
  port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`)
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true })
      page = browser.contexts()[0].pages()[0]
      if (page) break
      await browser.close()
    } catch { /* The WebView may still be starting. */ }
    await delay(100)
  }
  assert.ok(page, 'Android WebView is available')
  await expect(page.locator('.topNav')).toBeVisible({ timeout: 30000 })
  if (await page.locator('.tutorialOverlay').isVisible()) await page.locator('.tutorialActions button').first().click()
  await page.evaluate(seed => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    window.navigationSavedState = {
      ...store.state,
      settings: { ...store.state.settings },
      profiles: { ...store.state.profiles },
      subscriptionCache: { ...store.state.subscriptionCache }
    }
    for (const [key, value] of Object.entries(seed.settings)) store.state.settings[key] = value
    store.commit('setProfileList', seed.profiles)
    store.commit('setActiveProfile', 'allChannels')
    store.commit('setCaches', {
      videos: Object.fromEntries(seed.subscriptionCache.map(channel => [channel._id, {
        timestamp: new Date(), videos: channel.videos
      }])),
      shorts: {},
      liveStreams: {},
      communityPosts: {}
    })
    store.commit('setSubscriptionCacheReady', true)
  }, {
    ...largeSubscriptionsSeed,
    settings: { ...largeSubscriptionsSeed.settings, currentLocale: 'en-US' },
    profiles: largeSubscriptionsSeed.profiles.map(profile => ({
      ...profile, subscriptions: profile.subscriptions.slice(0, 300)
    })),
    subscriptionCache: largeSubscriptionsSeed.subscriptionCache.slice(0, 300)
  })
  const session = await page.context().newCDPSession(page)
  const tapDelays = []
  async function measureTap(target, destination, selector = null, position = null) {
    await target.scrollIntoViewIfNeeded()
    await target.evaluate((element, selector) => {
      window.navigationTouchMetrics = null
      element.addEventListener('pointerup', () => {
        const start = performance.now()
        let previous = start
        let longestFrame = 0
        let renderedAt = null
        let clickDelay = null
        element.addEventListener('click', () => {
          clickDelay = performance.now() - start
        }, { once: true, capture: true })
        function frame() {
          const now = performance.now()
          longestFrame = Math.max(longestFrame, now - previous)
          previous = now
          if (renderedAt === null && (selector ? document.querySelector(selector) : clickDelay !== null)) renderedAt = now - start
          if (now - start >= 1000 && renderedAt !== null) {
            window.navigationTouchMetrics = { renderedAt, longestFrame, clickDelay }
          } else {
            requestAnimationFrame(frame)
          }
        }
        requestAnimationFrame(frame)
      }, { once: true })
    }, selector)
    const bounds = await target.boundingBox()
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: bounds.x + (position?.x ?? bounds.width / 2), y: bounds.y + (position?.y ?? bounds.height / 2) }]
    })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => page.evaluate(() => window.navigationTouchMetrics)).not.toBeNull()
    const metrics = await page.evaluate(() => window.navigationTouchMetrics)
    console.log(destination, metrics)
    tapDelays.push({ destination, delay: metrics.clickDelay })
  }
  for (const destination of ['playback', 'search-heading', 'search-match', 'home']) {
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      store.dispatch('hideSettingsWindow')
      document.querySelector('.sideNav .inner > a[href="#/userplaylists"]').click()
    })
    await expect(page.locator('.newPlaylistButton')).toBeVisible()
    const searchResult = destination.startsWith('search-')
    if (destination !== 'home') {
      await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow'))
      await page.locator('.settingsSearch input').fill('')
      if (!await page.locator('.settingsMenu [data-section="playback"]').isVisible()) await page.locator('.settingsBackButton').click()
      await expect(page.locator('.settingsMenu [data-section="playback"]')).toBeVisible()
      if (searchResult) await page.locator('.settingsSearch input').fill('Preload Upcoming Videos')
    }
    const target = destination === 'home'
      ? '.sideNav .inner > a[href="#/home"]'
      : searchResult
        ? destination === 'search-heading' ? '.settingsSearchResultHeading' : '.settingsSearchResultMatch'
        : '.settingsMenu [data-section="playback"]'
    const selector = destination === 'home'
      ? '[data-home-section="newSinceLastVisit"] .mediaGrid li'
      : '.settingsContent > [data-section="playback"]'
    await measureTap(page.locator(target), destination, selector)
  }

  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('showSettingsWindow'))
  await page.locator('.settingsSearch input').fill('')
  await page.locator('.settingsMenu [data-section="playback"]').evaluate(element => element.click())
  await expect(page.locator('.settingsContent > [data-section="playback"]')).toBeVisible()
  await measureTap(page.locator('.settingsContent .select-text:enabled').first(), 'select-opener')
  const picker = page.locator('.selectDropdown:visible')
  await expect(picker).toBeVisible()
  // Reselect the current value so this device check does not change preferences.
  await measureTap(picker.locator('[role="option"][aria-selected="true"]'), 'select-option')
  await expect(picker).toBeHidden()

  const settingsContent = page.locator('.settingsContent')
  await settingsContent.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect.poll(() => settingsContent.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await measureTap(page.locator('.settingsBackButton'), 'category-back')
  await expect(page.locator('.settingsMenu [data-section="privacy"]')).toBeVisible()
  await measureTap(page.locator('.settingsMenu [data-section="privacy"]'), 'category-replacement', '.settingsContent > [data-section="privacy"]')
  await expect(settingsContent).toHaveJSProperty('scrollTop', 0)

  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    store.dispatch('hideSettingsWindow')
    document.querySelector('.sideNav .inner > a[href="#/userplaylists"]').click()
  })
  await measureTap(page.locator('.newPlaylistButton'), 'shared-button')
  const prompt = page.locator('.prompt:visible')
  await expect(prompt).toBeVisible()
  await measureTap(prompt, 'prompt-backdrop', null, { x: 8, y: 8 })
  await expect(prompt).toBeHidden()
  // The browser's second-tap timeout is independent of cache size or CPU speed.
  for (const { destination, delay } of tapDelays) {
    assert.ok(Number.isFinite(delay) && delay < 100, `${destination} must accept a tap without waiting for a second one`)
  }
} finally {
  try {
    if (page) {
      await page.evaluate(() => {
        if (window.navigationSavedState) document.querySelector('#app').__vue_app__.config.globalProperties.$store.replaceState(window.navigationSavedState)
        delete window.navigationSavedState
        delete window.navigationTouchMetrics
      }).catch(error => {
        console.error('Failed to restore Android navigation check state:', error)
        throw error
      })
    }
  } finally {
    try {
      if (browser) await browser.close()
    } finally {
      if (port) adb('forward', '--remove', `tcp:${port}`)
    }
  }
}
