import { test, expect, scrollPageToEnd, expectPageScrollWithinRenderedRange } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const OTHER_CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const SINGLE_VIDEO_CHANNEL_ID = 'UCcccccccccccccccccccccc'
const LONG_CHANNEL_ID = 'UCdddddddddddddddddddddd'
// Every other video of the long channel is watched.
const LONG_CHANNEL_VIDEO_IDS = Array.from({ length: 40 }, (_, index) => `long${String(index).padStart(7, '0')}`)
const LONG_CHANNEL_WATCHED_IDS = LONG_CHANNEL_VIDEO_IDS.filter((_, index) => index % 2 === 0)

const video = (videoId, title, authorId) => ({
  type: 'video',
  title,
  videoId,
  author: 'Channel',
  authorId,
  videoThumbnails: [],
  description: '',
  viewCount: 1234,
  published: 1700000000,
  publishedText: '1 year ago',
  lengthSeconds: 60,
  liveNow: false,
  isUpcoming: false
})

const historyEntry = (videoId, title, authorId) => ({
  _id: videoId,
  videoId,
  title,
  author: 'Channel',
  authorId,
  published: 1700000000000,
  timeWatched: 1700000001000,
  description: '',
  viewCount: 1234,
  lengthSeconds: 60,
  watchProgress: 0,
  isWatched: true,
  isLive: false,
  type: 'video'
})

test.use({
  seed: {
    settings: {
      backendPreference: 'invidious',
      backendFallback: false,
      defaultInvidiousInstance: 'https://invidious.test'
    },
    history: [
      historyEntry('watched0001', 'Watched video', CHANNEL_ID),
      historyEntry('watched0002', 'Other watched video', OTHER_CHANNEL_ID),
      ...LONG_CHANNEL_WATCHED_IDS.map(videoId => historyEntry(videoId, videoId, LONG_CHANNEL_ID))
    ]
  }
})

function channelVideos(channelId) {
  switch (channelId) {
    case LONG_CHANNEL_ID: return LONG_CHANNEL_VIDEO_IDS.map(videoId => video(videoId, videoId, channelId))
    case SINGLE_VIDEO_CHANNEL_ID: return [video('single00001', 'Only video', channelId)]
    case CHANNEL_ID: return [
      video('watched0001', 'Watched video', channelId),
      video('unwatched01', 'Unwatched video', channelId)
    ]
    default: return [
      video('watched0002', 'Other Watched video', channelId),
      video('unwatched02', 'Other Unwatched video', channelId)
    ]
  }
}

test.beforeEach(async ({ page }) => {
  await page.route('https://invidious.test/api/v1/channels/**', route => {
    const [, , , , channelId, tab] = new URL(route.request().url()).pathname.split('/')
    return route.fulfill({
      json: tab
        ? {
            videos: channelVideos(channelId),
            continuation: null
          }
        : {
            author: 'Channel',
            authorId: channelId,
            authorThumbnails: [],
            authorBanners: [],
            description: '',
            subCount: 0,
            totalViews: 0,
            joined: 0,
            tabs: ['videos'],
            relatedChannels: []
          }
    })
  })
})

async function openChannel(page, channelId) {
  const tab = await page.evaluate(id => window.ftElectron.tabs.create({
    route: `/channel/${id}`,
    makeActive: true
  }), channelId)
  await expect(page.locator(`.tab[data-tab-id="${tab.id}"]`)).toHaveClass(/\bactive\b/)
  const content = page.locator('.channelContent:visible')
  return {
    tabId: tab.id,
    titles: content.locator('#videoPanel').getByRole('heading', { level: 3 }),
    toggle: content.getByRole('checkbox', { name: 'Hide Watched', exact: true }),
    toggleLabel: content.locator('.hideWatchedSwitch label')
  }
}

test('the channel switch hides watched videos without changing the setting', async ({ page }) => {
  let channel = await openChannel(page, CHANNEL_ID)
  await expect(channel.titles).toHaveText(['Watched video', 'Unwatched video'])
  await expect(channel.toggle).not.toBeChecked()

  await channel.toggleLabel.click()
  await expect(channel.toggle).toBeChecked()
  await expect(channel.titles).toHaveText(['Unwatched video'])
  expect(await page.evaluate(() => window.$store.getters.getHideWatchedSubs)).toBe(false)

  // The choice carries over to other channel pages in this session.
  channel = await openChannel(page, OTHER_CHANNEL_ID)
  await expect(channel.toggle).toBeChecked()
  await expect(channel.titles).toHaveText(['Other Unwatched video'])

  await channel.toggleLabel.click()
  await expect(channel.toggle).not.toBeChecked()
  await expect(channel.titles).toHaveText(['Other Watched video', 'Other Unwatched video'])
})

test('changing the setting resets the channel switch to it', async ({ page }) => {
  const channel = await openChannel(page, CHANNEL_ID)
  await channel.toggleLabel.click()
  await expect(channel.titles).toHaveText(['Unwatched video'])

  await page.evaluate(() => window.$store.dispatch('updateHideWatchedSubs', true))
  await page.evaluate(() => window.$store.dispatch('updateHideWatchedSubs', false))
  await expect(channel.toggle).not.toBeChecked()
  await expect(channel.titles).toHaveText(['Watched video', 'Unwatched video'])
})

test('changing the setting while no channel page is open resets the switch', async ({ page }) => {
  let channel = await openChannel(page, CHANNEL_ID)
  await channel.toggleLabel.click()
  await expect(channel.toggle).toBeChecked()
  await channel.toggleLabel.click()
  await expect(channel.toggle).not.toBeChecked()
  await page.evaluate(id => window.ftElectron.tabs.close(id), channel.tabId)
  await expect(page.locator('.channelContent')).toHaveCount(0)

  await page.evaluate(() => window.$store.dispatch('updateHideWatchedSubs', true))
  channel = await openChannel(page, CHANNEL_ID)
  await expect(channel.toggle).toBeChecked()
  await expect(channel.titles).toHaveText(['Unwatched video'])
})

test('the switch is hidden like the sort select when the channel has a single video', async ({ page }) => {
  const channel = await openChannel(page, SINGLE_VIDEO_CHANNEL_ID)
  await expect(channel.titles).toHaveText(['Only video'])
  await expect(channel.toggle).toHaveCount(0)
})

test('hiding watched videos from the bottom of a long channel keeps a valid scroll position', { tag: '@scale' }, async ({ page }) => {
  const channel = await openChannel(page, LONG_CHANNEL_ID)
  // Cards outside the first screen render lazily, so count the list items.
  const items = page.locator('.channelContent:visible #videoPanel [data-feed-item-key]')
  await expect(items).toHaveCount(LONG_CHANNEL_VIDEO_IDS.length)

  await scrollPageToEnd(page)
  // A focused switch toggles with Space without scrolling back to it.
  await channel.toggle.evaluate(element => element.click())
  await expect(channel.toggle).toBeChecked()
  await expect(items).toHaveCount(LONG_CHANNEL_VIDEO_IDS.length - LONG_CHANNEL_WATCHED_IDS.length)
  await expectPageScrollWithinRenderedRange(page)
})
