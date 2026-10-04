import { test, expect, goTo } from '../../helpers/app.mjs'

// Trace screenshots/snapshots compete with the throttled renderer and distort
// frame timings. Keep the functional suites traced, but measure without them.
test.use({ trace: 'off', seed: { settings: { landingPage: 'history' } } })

async function settleSeededHistory(page) {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  }))
}

async function seedLargeHistory(page) {
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const now = Date.now()
    const history = Array.from({ length: 45000 }, (_, index) => ({
      videoId: `history-${index}`,
      title: `Linux desktop customization ${index}`,
      description: 'KDE Plasma widgets, desktop configuration and application shortcuts',
      authorId: `channel-${index % 50}`,
      lengthSeconds: 600,
      watchProgress: index < 1000 ? 400 : 0,
      timeWatched: now - index * 1000,
      isWatched: false,
      type: 'video',
    }))
    store.commit('setHistoryCacheSorted', history)
    store.commit('setHistoryCacheById', Object.fromEntries(history.map(video => [video.videoId, video])))
    store.commit('setEnableHomeRecommendations', true)
  })
}

// Match a large imported library without putting personal profile data in fixtures.
test('Home paints and stays responsive while learning from a large history', async ({ page }) => {
  await page.context().route(/https?:\/\//, route => route.abort())
  await seedLargeHistory(page)
  await settleSeededHistory(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  try {
    const timing = await page.evaluate(() => new Promise(resolve => {
      const start = performance.now()
      let previous = start
      let longestFrame = 0
      let firstPaint = null
      document.querySelector('.sideNav a[href="#/home"]').click()
      function sample(now) {
        longestFrame = Math.max(longestFrame, now - previous)
        previous = now
        if (firstPaint === null && document.querySelector('.homeIntro')) firstPaint = now - start
        if (now - start > 3500) {
          resolve({ firstPaint, longestFrame })
          return
        }
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }))
    expect(timing.firstPaint, JSON.stringify(timing)).toBeLessThan(500)
    expect(timing.longestFrame, JSON.stringify(timing)).toBeLessThan(300)
    await expect(page.locator('[data-home-section="continueWatching"] .mediaThumbnail').first()).toBeVisible()
    // A second visit must not repeat full-library preparation.
    await goTo(page, 'history')
    await goTo(page, 'home')
    await expect(page.locator('.homeIntro')).toBeVisible()
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await cdp.detach()
  }
})

test('history search stays responsive with a large imported library', async ({ page }) => {
  await page.context().route(/https?:\/\//, route => route.abort())
  await seedLargeHistory(page)
  await goTo(page, 'history')
  await settleSeededHistory(page)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  try {
    const timing = await page.evaluate(() => new Promise(resolve => {
      const start = performance.now()
      let previous = start
      let longestFrame = 0
      const input = document.querySelector('.historySearch input')
      input.value = 'customziation'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      function sample(now) {
        longestFrame = Math.max(longestFrame, now - previous)
        previous = now
        if (now - start > 4000 && !document.querySelector('.historySearchLoader')) {
          resolve({ longestFrame })
          return
        }
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }))
    // Include result mounting/layout on CI's software renderer. This budget
    // still catches the original 1.75–3 second synchronous search freezes.
    expect(timing.longestFrame, JSON.stringify(timing)).toBeLessThan(600)
    await expect(page.locator('.ft-list-video').first()).toContainText('Linux desktop customization')
    // Clearing/replacing a pending query must discard its previous results.
    await page.locator('.historySearch input').fill('unfindableword')
    await page.locator('.historySearchLoader').waitFor()
    await page.locator('.historySearch input').fill('')
    await expect(page.locator('.historySearchLoader')).toHaveCount(0)
    await expect(page.locator('.ft-list-video').first()).toContainText('Linux desktop customization')
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await cdp.detach()
  }
})
