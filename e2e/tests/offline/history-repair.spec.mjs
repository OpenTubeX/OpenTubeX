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
  await page.getByRole('button', { name: 'Repair History', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
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
  await page.getByRole('button', { name: 'Repair History', exact: true }).click()
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
    await page.getByRole('button', { name: 'Repair History', exact: true }).click()
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
      await page.getByRole('button', { name: 'Repair History', exact: true }).click()
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
    await page.getByRole('button', { name: 'Repair History', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
    const saved = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getHistoryCacheById.abcdefghijk)
    expect(saved.isLive).toBe(true)
    expect(saved.lengthSeconds).toBe(0)
  })
})
