import { test, expect, goTo, goToSettingsSection, latestSettings, readDatastore } from '../../helpers/app.mjs'

const LONG_TITLE = 'An unusually long video title that keeps going with more and more words, so that it wraps across several lines in every grid and list layout, even in the wide list view where each title gets most of the window width to itself, which takes a title far longer than most channels would ever write'
const SHORT_TITLE = 'Short title'
const LONG_PLAYLIST = 'A playlist with an unusually long name that keeps going with more and more words, so that it wraps across several lines in the playlist grid'

function historyEntry(videoId, title, timeWatched) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Test Channel',
    authorId: 'UC-test-channel-id',
    published: Date.now() - 86_400_000,
    description: '',
    viewCount: 1234,
    lengthSeconds: 60,
    watchProgress: 0,
    isWatched: false,
    timeWatched,
    isLive: false,
    type: 'video'
  }
}

/**
 * @param {import('@playwright/test').Locator} heading
 */
function measure(heading) {
  return heading.evaluate(element => {
    const style = getComputedStyle(element)
    return {
      lines: element.getBoundingClientRect().height / Number.parseFloat(style.lineHeight),
      truncated: element.scrollHeight > element.clientHeight,
      tooltip: element.closest('a.title')?.getAttribute('title') ?? null
    }
  })
}

async function disableLimitTitles(page) {
  const appearance = await goToSettingsSection(page, 'appearance')
  const toggle = appearance.getByRole('checkbox', { name: /^Limit titles to two lines/ })
  await expect(toggle).toBeChecked()
  await appearance.locator('label.switch-label').filter({ hasText: 'Limit titles to two lines' }).click()
  await expect(toggle).not.toBeChecked()
  await page.locator('.settingsWindow').getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.settingsWindow')).toBeHidden()
}

/**
 * @param {import('@playwright/test').Locator} heading
 * @param {string} title
 * @param {boolean} clamped
 */
async function expectClamped(heading, title, clamped) {
  await expect.poll(async () => {
    const { lines, truncated, tooltip } = await measure(heading)
    // Exactly two line boxes, so descenders on the second line stay visible
    return { twoLines: Math.abs(lines - 2) < 0.05, truncated, tooltip }
  }).toEqual(clamped ? { twoLines: true, truncated: true, tooltip: title } : { twoLines: false, truncated: false, tooltip: null })
  if (!clamped) expect((await measure(heading)).lines).toBeGreaterThan(2.5)
}

test.describe('limit titles to two lines', { tag: '@scale' }, () => {
  test.use({
    seed: {
      settings: { currentLocale: 'en-US' },
      history: [
        historyEntry('longtitle01', LONG_TITLE, Date.now() - 1000),
        historyEntry('shorttitle1', SHORT_TITLE, Date.now() - 2000)
      ],
      playlists: [{
        _id: 'long-playlist',
        playlistName: LONG_PLAYLIST,
        description: '',
        protected: false,
        videos: [],
        lastUpdatedAt: 1700000000000
      }]
    }
  })

  test('clamps video and playlist titles in grids and lists by default until turned off', async ({ app, page }) => {
    await goTo(page, 'history')
    const long = page.getByRole('heading', { name: LONG_TITLE, exact: true })
    const short = page.getByRole('heading', { name: SHORT_TITLE, exact: true })
    await expect(long).toBeVisible()
    await expect(page.locator(':root')).toHaveClass(/\blimitTitlesToTwoLines\b/)
    for (const listType of ['grid', 'list']) {
      await page.evaluate(listType => window.$store.dispatch('updateListType', listType), listType)
      await expect(page.locator(`.ft-list-video.${listType}`).first()).toBeVisible()
      await expectClamped(long, LONG_TITLE, true)
      const shortTitle = await measure(short)
      expect(shortTitle.lines, listType).toBeCloseTo(1, 1)
      expect(shortTitle.truncated, listType).toBe(false)
    }
    await page.evaluate(() => window.$store.dispatch('updateListType', 'grid'))

    await goTo(page, 'userplaylists')
    const playlist = page.getByRole('heading', { name: LONG_PLAYLIST, exact: true })
    await expect(playlist).toBeVisible()
    await expectClamped(playlist, LONG_PLAYLIST, true)

    await disableLimitTitles(page)
    await expect(page.locator(':root')).not.toHaveClass(/\blimitTitlesToTwoLines\b/)
    await expectClamped(playlist, LONG_PLAYLIST, false)
    await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).limitTitlesToTwoLines).toBe(false)
    await goTo(page, 'history')
    await expectClamped(long, LONG_TITLE, false)
  })
})
