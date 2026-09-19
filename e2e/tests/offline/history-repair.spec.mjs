import { test, expect, goTo } from '../../helpers/app.mjs'

const timeWatched = Date.now() - 1000
const original = {
  _id: 'abcdefghijk',
  videoId: 'abcdefghijk',
  title: 'Imported video',
  author: '',
  authorId: '',
  lengthSeconds: 0,
  isLive: true,
  isWatched: true,
  watchProgress: 42,
  timeWatched,
  published: 0,
  type: 'video'
}

test.use({ seed: { history: [original] } })

async function startRepair(page) {
  await page.getByRole('button', { name: 'Repair History', exact: true }).click()
  await page.getByRole('dialog', { name: 'Repair History' }).getByRole('button', { name: 'Start repair', exact: true }).click()
}

test('repairs imported history metadata without changing watch state', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.route('**/youtubei/v1/player*', route => route.fulfill({
    json: {
      videoDetails: {
        videoId: original.videoId,
        title: 'Imported video',
        author: 'Recovered channel',
        channelId: 'UCabcdefghijklmnopqrstuv',
        lengthSeconds: '120',
        isLiveContent: true
      },
      microformat: { playerMicroformatRenderer: { publishDate: '2025-01-01' } }
    }
  }))
  await goTo(page, 'history')
  await startRepair(page)
  await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
  await expect(page.getByRole('heading', { name: 'Repair finished', exact: true })).toBeVisible()
  await expect(page.getByText('Recovered channel', { exact: true })).toBeVisible()
  const saved = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.abcdefghijk)
  expect(saved).toMatchObject({
    isLive: false,
    liveNow: false,
    isUpcoming: false,
    lengthSeconds: 120,
    isWatched: true,
    watchProgress: 42,
    published: Date.parse('2025-01-01'),
    timeWatched
  })
  await page.screenshot({ path: testInfo.outputPath('history-repair.png') })
  await page.reload()
  await goTo(page, 'history')
  await expect(page.getByText('Recovered channel', { exact: true })).toBeVisible()
})

test('failed history metadata requests leave imported entries intact', async ({ page }) => {
  await page.route('**/youtubei/v1/player*', route => route.fulfill({ json: { playabilityStatus: { status: 'ERROR' } } }))
  await goTo(page, 'history')
  await startRepair(page)
  await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 0 · Failed 1')
  await expect(page.getByRole('button', { name: 'Repair History', exact: true })).toBeEnabled()
  await expect(page.getByText('Imported video', { exact: true })).toBeVisible()
})

test('keeps Cancel available if history is cleared during a repair', async ({ page }) => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  await page.route('**/youtubei/v1/player*', async route => {
    await pending
    await route.fulfill({ json: {} }).catch(() => {})
  })
  try {
    await goTo(page, 'history')
    await startRepair(page)
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('removeAllHistory'))
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
  } finally {
    release()
  }
})

test.describe('Invidious history repair', () => {
  test.use({
    seed: {
      settings: { backendPreference: 'invidious', defaultInvidiousInstance: 'https://history-repair.test' },
      history: [original]
    }
  })

  for (const isUpcoming of [false, true]) {
    test(`uses Invidious metadata with upcoming status ${isUpcoming}`, async ({ page }) => {
      await page.route('https://history-repair.test/api/v1/videos/**', route => route.fulfill({
        json: {
          videoId: original.videoId,
          title: original.title,
          author: 'Invidious channel',
          authorId: 'UCabcdefghijklmnopqrstuv',
          lengthSeconds: 120,
          liveNow: false,
          isUpcoming,
          published: 1735689600
        }
      }))
      await goTo(page, 'history')
      await startRepair(page)
      await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
      await expect(page.getByText('Invidious channel', { exact: true })).toBeVisible()
      const saved = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.abcdefghijk)
      expect(saved.isUpcoming).toBe(isUpcoming)
      expect(saved.isLive).toBe(false)
      expect(saved.liveNow).toBe(false)
    })
  }

  test('preserves live flags when Invidious omits the upcoming status', async ({ page }) => {
    await page.route('https://history-repair.test/api/v1/videos/**', route => route.fulfill({
      json: {
        videoId: original.videoId,
        title: original.title,
        author: 'Invidious channel',
        authorId: 'UCabcdefghijklmnopqrstuv',
        lengthSeconds: 120,
        liveNow: false,
        published: 1735689600
      }
    }))
    await goTo(page, 'history')
    await startRepair(page)
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
    const saved = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.abcdefghijk)
    expect(saved.isLive).toBe(true)
    expect(saved.lengthSeconds).toBe(0)
  })
})

for (const failure of ['HTTP', 'missing metadata']) {
  test(`retries a temporary ${failure} failure without restarting repair`, async ({ page }) => {
    let requests = 0
    await page.route('**/youtubei/v1/player*', async route => {
      if (++requests === 1) {
        if (failure === 'HTTP') await route.fulfill({ status: 503, body: 'Service unavailable' })
        else await route.fulfill({ json: { playabilityStatus: { status: 'ERROR' } } })
        return
      }
      await route.fulfill({
        json: {
          videoDetails: {
            videoId: original.videoId,
            title: original.title,
            author: 'Recovered channel',
            channelId: 'UCabcdefghijklmnopqrstuv',
            lengthSeconds: '120'
          },
          microformat: { playerMicroformatRenderer: { publishDate: '2025-01-01' } }
        }
      })
    })
    await goTo(page, 'history')
    await startRepair(page)
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
    await expect(page.getByRole('button', { name: 'Repair History', exact: true })).toBeEnabled()
    expect(requests).toBe(2)
    const saved = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.abcdefghijk)
    expect(saved).toMatchObject({
      author: 'Recovered channel',
      lengthSeconds: 120,
      isLive: false,
      watchProgress: original.watchProgress,
      timeWatched: original.timeWatched,
      isWatched: original.isWatched
    })
  })
}

for (const responseType of ['bot check', 'HTTP 429']) {
  test(`waits before recovering from a ${responseType}`, async ({ page }, testInfo) => {
    let requests = 0
    await page.route('**/youtubei/v1/player*', async route => {
      if (++requests === 1) {
        if (responseType === 'HTTP 429') await route.fulfill({ status: 429, body: 'Too many requests' })
        else await route.fulfill({ json: { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } } })
        return
      }
      await route.fulfill({
        json: {
          videoDetails: { videoId: original.videoId, author: 'Recovered channel', channelId: 'UCabcdefghijklmnopqrstuv', lengthSeconds: '120' },
          microformat: { playerMicroformatRenderer: { publishDate: '2025-01-01' } }
        }
      })
    })
    await goTo(page, 'history')
    await page.clock.install()
    await startRepair(page)
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 0 · Failed 1')
    await expect(page.getByRole('heading', { name: 'Waiting for YouTube. Repair will resume automatically.' })).toBeVisible()
    await expect(page.getByRole('progressbar')).not.toHaveAttribute('value')
    if (responseType === 'bot check') await page.screenshot({ path: testInfo.outputPath('repair-waiting.png') })
    await page.clock.fastForward(29000)
    expect(requests).toBe(1)
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    await page.clock.fastForward(1000)
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
    await expect(page.getByRole('button', { name: 'Repair History', exact: true })).toBeEnabled()
    expect(requests).toBe(2)
  })
}

test('reports a persistent bot check and stops retrying', async ({ page }) => {
  const reason = 'Sign in to confirm you’re not a bot'
  let requests = 0
  await page.route('**/youtubei/v1/player*', async route => {
    requests++
    await route.fulfill({ json: { playabilityStatus: { status: 'LOGIN_REQUIRED', reason } } })
  })
  await goTo(page, 'history')
  await page.clock.install()
  await startRepair(page)
  await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 0 · Failed 1')
  await page.clock.fastForward(30000)
  await expect.poll(() => requests).toBe(2)
  await expect.poll(async () => {
    await page.clock.fastForward(1000)
    return requests
  }, { intervals: [50] }).toBe(3)
  await expect(page.getByRole('alert')).toHaveText(reason)
  await expect(page.getByRole('heading', { name: 'Repair stopped', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Repair History', exact: true })).toBeEnabled()
  expect(requests).toBe(3)
})

for (const width of [1280, 375]) {
  test(`explains repair before starting at ${width}px`, async ({ page }, testInfo) => {
    let requests = 0
    await page.route('**/youtubei/v1/player*', async route => {
      requests++
      await route.fulfill({ json: {} })
    })
    await page.setViewportSize({ width, height: 812 })
    await page.evaluate(theme => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateBaseTheme', theme), width === 1280 ? 'dark' : 'light')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Repair History', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Repair History' })
    await expect(dialog).toContainText('Use this after importing history')
    await expect(dialog).toContainText('Your watch progress and watched status stay unchanged.')
    await expect(dialog).toContainText('Deleted or private videos may stay incomplete.')
    await expect(dialog.getByRole('button', { name: 'Start repair' })).toBeInViewport()
    expect(requests).toBe(0)
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`repair-explanation-${width}.png`), animations: 'disabled' })
    await dialog.screenshot({ path: testInfo.outputPath(`repair-dialog-${width}.png`), animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Repair History', exact: true })).toBeFocused()
    expect(requests).toBe(0)
  })
}

test.describe('German repair explanation', () => {
  test.use({ seed: { history: [original], settings: { currentLocale: 'de-DE', baseTheme: 'light', uiScale: 125 } } })

  test('fits the explanation and actions at 125% scale in a short window', async ({ app, page }, testInfo) => {
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setContentSize(850, 450)
      window.webContents.setZoomFactor(1.25)
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await goTo(page, 'history')
    await page.getByRole('button', { name: 'Verlauf reparieren', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Verlauf reparieren' })
    await expect(dialog.getByRole('button', { name: 'Reparatur starten' })).toBeInViewport()
    await expect(dialog.getByRole('heading')).toBeInViewport()
    const scroller = dialog.locator('.promptContentScroller')
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(dialog.getByRole('heading')).toBeInViewport()
    await expect(dialog.getByRole('button', { name: 'Reparatur starten' })).toBeInViewport()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('repair-explanation-german.png'), animations: 'disabled' })
    expect(await dialog.getByRole('button', { name: 'Reparatur starten' }).evaluate(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight
    })).toBe(true)
    await app.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(850, 900)
    })
    await expect.poll(() => scroller.evaluate(element => ({
      scrollTop: element.scrollTop,
      hasVisibleScrollbar: element.querySelector(':scope > .os-scrollbar-vertical')?.classList.contains('os-scrollbar-visible') ?? false
    }))).toEqual({ scrollTop: 0, hasVisibleScrollbar: false })
  })
})
