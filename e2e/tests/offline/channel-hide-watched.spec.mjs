import { test, expect } from '../../helpers/app.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'
const OTHER_CHANNEL_ID = 'UCbbbbbbbbbbbbbbbbbbbbbb'
const SINGLE_VIDEO_CHANNEL_ID = 'UCcccccccccccccccccccccc'

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
      historyEntry('watched0002', 'Other watched video', OTHER_CHANNEL_ID)
    ]
  }
})

test.beforeEach(async ({ page }) => {
  await page.route('https://invidious.test/api/v1/channels/**', route => {
    const [, , , , channelId, tab] = new URL(route.request().url()).pathname.split('/')
    const prefix = channelId === CHANNEL_ID ? '' : 'Other '
    const watchedId = channelId === CHANNEL_ID ? 'watched0001' : 'watched0002'
    return route.fulfill({
      json: tab
        ? {
            videos: channelId === SINGLE_VIDEO_CHANNEL_ID
              ? [video('single00001', 'Only video', channelId)]
              : [
                  video(watchedId, `${prefix}Watched video`, channelId),
                  video(channelId === CHANNEL_ID ? 'unwatched01' : 'unwatched02', `${prefix}Unwatched video`, channelId)
                ],
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
