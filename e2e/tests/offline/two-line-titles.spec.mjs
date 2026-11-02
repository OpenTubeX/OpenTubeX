import { test, expect, goTo, goToSettingsSection, latestSettings, readDatastore } from '../../helpers/app.mjs'
import { waitForPlayback } from '../../helpers/player.mjs'
import { mockPlayableWatchPage } from '../../helpers/watch.mjs'

const LONG_TITLE = 'An unusually long video title that keeps going with more and more words, so that it wraps across several lines in every grid and list layout, even in the wide list view where each title gets most of the window width to itself, which takes a title far longer than most channels would ever write'
const SHORT_TITLE = 'Short title'
const LONG_PLAYLIST = 'A playlist with an unusually long name that keeps going with more and more words, so that it wraps across several lines in the playlist grid'
// Playlist cards cut names after 255 characters.
const OVERLONG_PLAYLIST = `${LONG_PLAYLIST}, and then goes on for so long that the card itself cuts it off after 255 characters, which the tooltip must never do to the name`

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
      }, {
        _id: 'overlong-playlist',
        playlistName: OVERLONG_PLAYLIST,
        description: '',
        protected: false,
        videos: [],
        lastUpdatedAt: 1700000000001
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

    // Keyboard users cannot open the hover tooltip, so a focused title shows in full.
    const longLink = page.locator('a.title').filter({ has: long })
    await page.keyboard.press('Shift')
    await longLink.focus()
    await expect.poll(() => longLink.evaluate(element => element.matches(':focus-visible'))).toBe(true)
    await expect.poll(async () => (await measure(long)).lines).toBeGreaterThan(2.5)
    await longLink.blur()
    await expectClamped(long, LONG_TITLE, true)

    await goTo(page, 'userplaylists')
    const playlist = page.getByRole('heading', { name: LONG_PLAYLIST, exact: true })
    await expect(playlist).toBeVisible()
    await expectClamped(playlist, LONG_PLAYLIST, true)
    const overlong = page.getByRole('heading', { name: `${OVERLONG_PLAYLIST.slice(0, 255)}...`, exact: true })
    await expect(overlong).toBeVisible()
    expect((await measure(overlong)).tooltip).toBe(OVERLONG_PLAYLIST)

    await disableLimitTitles(page)
    await expect(page.locator(':root')).not.toHaveClass(/\blimitTitlesToTwoLines\b/)
    await expectClamped(playlist, LONG_PLAYLIST, false)
    await expect.poll(() => latestSettings(readDatastore(app.userDataDir, 'settings')).limitTitlesToTwoLines).toBe(false)
    await goTo(page, 'history')
    await expectClamped(long, LONG_TITLE, false)
  })
})

const PLAYLIST_VIDEOS = Array.from({ length: 14 }, (_, index) => ({
  videoId: index === 0 ? 'jNQXAC9IVRw' : `clampvideo${String(index).padStart(2, '0')}`,
  title: `Video ${index + 1}: ${LONG_TITLE}`,
  author: 'Test Channel',
  authorId: 'UC-test-channel-id',
  lengthSeconds: 120,
  viewCount: 1234,
  published: Date.now() - 86_400_000,
  timeAdded: Date.now() + index,
  playlistItemId: `clamp-item-${index}`,
  type: 'video'
}))

/**
 * Checks that a scroller scrolled to its old end has a valid offset after its
 * content got shorter: no offset past the range, no empty space after the last
 * item, and a scrollbar that matches the new range. Scroll anchoring may keep
 * the visible rows in place instead of staying at the end.
 * @param {import('@playwright/test').Locator} scroller
 * @param {string} itemSelector
 */
async function expectValidScrollRange(scroller, itemSelector) {
  await expect.poll(() => scroller.evaluate((element, itemSelector) => {
    const page = element === document.body
    const scrollElement = page ? document.documentElement : element
    const viewportEnd = page ? window.innerHeight : element.getBoundingClientRect().bottom
    const lastItem = [...element.querySelectorAll(itemSelector)].at(-1)
    // The overlay scrollbar follows the rows, so the last row keeps its gap.
    const end = lastItem.getBoundingClientRect().bottom + (Number.parseFloat(getComputedStyle(lastItem).marginBlockEnd) || 0)
    const maximum = scrollElement.scrollHeight - scrollElement.clientHeight
    const scrollbar = element.querySelector(':scope > .os-scrollbar-vertical')
    const handle = scrollbar?.querySelector('.os-scrollbar-handle')?.getBoundingClientRect()
    const track = scrollbar?.querySelector('.os-scrollbar-track')?.getBoundingClientRect()
    return {
      // scrollHeight and clientHeight are rounded, while offsets at a
      // fractional UI scale are not. Allow both roundings, in device pixels.
      offsetValid: (scrollElement.scrollTop - Math.max(0, maximum)) * devicePixelRatio <= 2,
      scrolled: scrollElement.scrollTop > 0,
      // The list still reaches the bottom of the viewport, so nothing empty trails it.
      contentEndValid: end >= viewportEnd - 2 || page,
      // The thumb sits where the offset puts it within the new range.
      scrollbarValid: !scrollbar || (maximum > 0
        ? scrollbar.classList.contains('os-scrollbar-visible') && !scrollbar.classList.contains('os-scrollbar-unusable') &&
          Math.abs((handle.top - track.top) - (track.height - handle.height) * scrollElement.scrollTop / maximum) * devicePixelRatio <= 2
        : !scrollbar.classList.contains('os-scrollbar-visible') || scrollbar.classList.contains('os-scrollbar-unusable'))
    }
  }, itemSelector)).toEqual({ offsetValid: true, scrolled: true, contentEndValid: true, scrollbarValid: true })
}

/**
 * @param {import('@playwright/test').Locator} scroller
 */
async function scrollToEnd(scroller) {
  await scroller.evaluate(async element => {
    const scrollElement = element === document.body ? document.documentElement : element
    for (let attempt = 0; attempt < 3; attempt++) {
      scrollElement.scrollTop = scrollElement.scrollHeight
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
  })
}

/**
 * @param {import('@playwright/test').Locator} scroller
 */
function scrollHeight(scroller) {
  return scroller.evaluate(element => (element === document.body ? document.documentElement : element).scrollHeight)
}

test.describe('enabling two-line titles while scrolled to the end', { tag: '@scale' }, () => {
  test.describe.configure({ timeout: 120_000 })
  test.use({
    seed: {
      settings: {
        currentLocale: 'en-US',
        limitTitlesToTwoLines: false,
        animationSpeed: 0,
        userPlaylistSortOrder: 'custom',
        videoPlaybackEngine: 'built-in',
        ytDlpPlaybackEngineDefaultMigration: true
      },
      history: PLAYLIST_VIDEOS.slice(1).map((video, index) => historyEntry(video.videoId, video.title, Date.now() - index * 1000)),
      playlists: [{
        _id: 'clamp-playlist',
        playlistName: 'Long title playlist',
        protected: false,
        description: '',
        videos: PLAYLIST_VIDEOS,
        createdAt: Date.now(),
        lastUpdatedAt: Date.now()
      }]
    }
  })

  test('clamps the page and the watch-page playlist panel to their shorter ranges', async ({ app, page }) => {
    const enable = value => page.evaluate(value => window.$store.dispatch('updateLimitTitlesToTwoLines', value), value)

    await goTo(page, 'history')
    await expect(page.getByRole('heading', { name: PLAYLIST_VIDEOS[1].title, exact: true })).toBeVisible()
    const body = page.locator('body')
    await scrollToEnd(body)
    const pageHeight = await scrollHeight(body)
    await enable(true)
    await expect.poll(() => scrollHeight(body)).toBeLessThan(pageHeight)
    await expectValidScrollRange(body, '.ft-list-video')

    await enable(false)
    await mockPlayableWatchPage(app, page)
    await goTo(page, 'userplaylists')
    await page.getByText('Long title playlist', { exact: true }).click()
    await page.getByRole('heading', { name: PLAYLIST_VIDEOS[0].title, exact: true }).click()
    await waitForPlayback(page)
    const panel = page.locator('.watchVideoPlaylist .playlistItemsWrapper').filter({ visible: true })
    await expect(panel.locator(':scope > .playlistItem')).toHaveCount(PLAYLIST_VIDEOS.length)
    await scrollToEnd(panel)
    const panelHeight = await scrollHeight(panel)
    await enable(true)
    await expect.poll(() => scrollHeight(panel)).toBeLessThan(panelHeight)
    await expectValidScrollRange(panel, ':scope > .playlistItem')
  })
})
