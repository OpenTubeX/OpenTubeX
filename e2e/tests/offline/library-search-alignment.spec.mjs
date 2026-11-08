import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

const now = Date.now()

/**
 * @param {string} videoId
 * @param {string} title
 * @param {number} timeWatched
 */
function historyEntry(videoId, title, timeWatched) {
  return {
    _id: videoId,
    videoId,
    title,
    author: 'Test Channel',
    authorId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
    published: timeWatched,
    description: '',
    viewCount: 1,
    lengthSeconds: 120,
    watchProgress: 0,
    isWatched: false,
    timeWatched,
    isLive: false,
    type: 'video'
  }
}

test.use({
  seed: {
    history: [
      historyEntry('aaaaaaaaaaa', 'First history video', now - 1000),
      historyEntry('bbbbbbbbbbb', 'Second history video', now - 2000)
    ],
    playlists: ['First', 'Second'].map((name, index) => ({
      _id: `search-alignment-${index}`,
      playlistName: `${name} playlist`,
      protected: false,
      description: '',
      videos: [],
      lastUpdatedAt: now - index
    })),
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [
        { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Channel', thumbnail: '' },
        { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', name: 'Beta Channel', thumbnail: '' }
      ]
    }]
  }
})

// Channels place sorting beside the search, so that row ends at the select
const PAGES = [
  { route: 'history', heading: '.headingRow', search: '.historySearch', rowEnd: '.historySearch' },
  { route: 'userplaylists', heading: '.headingRow', search: '.playlistSearch', rowEnd: '.playlistSearch' },
  { route: 'subscribedchannels', heading: '.heading', search: '.channelSearch', rowEnd: '.sortSelect' }
]

test('library search bars line up with the page and sit below the heading alike', { tag: '@scale' }, async ({ app, page, attachScreenshot }) => {
  for (const width of [1440, 375]) {
    await setWindowSize(app, page, { width, height: width === 1440 ? 950 : 850 })
    const geometry = []
    for (const { route, heading, search, rowEnd } of PAGES) {
      await goTo(page, route)
      await expect(page.locator(`${search} input`)).toBeVisible()
      geometry.push(await page.locator('.card').evaluate((card, selectors) => {
        const bounds = card.getBoundingClientRect()
        const headingBottom = Math.max(...[...card.querySelector(selectors.heading).children].map(child => child.getBoundingClientRect().bottom))
        const field = card.querySelector(`${selectors.search} .ft-input`).getBoundingClientRect()
        const label = card.querySelector(`${selectors.search} .selectLabel`).getBoundingClientRect()
        return {
          start: field.left - bounds.left,
          end: bounds.right - card.querySelector(selectors.rowEnd).getBoundingClientRect().right,
          belowHeading: Math.min(field.top, label.top) - headingBottom,
          fromCardTop: field.top - bounds.top
        }
      }, { heading, search, rowEnd }))
      await attachScreenshot(`${route} search at ${width}px`)
    }
    const [history, ...others] = geometry
    expect(history.start).toBeCloseTo(16, 0)
    expect(history.end).toBeCloseTo(16, 0)
    expect(history.belowHeading).toBeCloseTo(11, 0)
    for (const other of others) {
      expect(other.start).toBeCloseTo(history.start, 0)
      expect(other.end).toBeCloseTo(history.end, 0)
      expect(other.belowHeading).toBeCloseTo(history.belowHeading, 0)
      // On wide windows every heading is one row, so the fields share their height on the page
      if (width === 1440) expect(other.fromCardTop).toBeCloseTo(history.fromCardTop, 0)
    }
    if (width === 375) {
      // Like the History and Playlists options, the stacked sort select keeps its label clear of the search
      await expect.poll(() => page.locator('.controls').evaluate(controls => {
        const label = controls.querySelector('.sortSelect .select-label').getBoundingClientRect()
        return label.top - controls.querySelector('.channelSearch .ft-input').getBoundingClientRect().bottom
      })).toBeCloseTo(20, 0)
    }
  }
})
