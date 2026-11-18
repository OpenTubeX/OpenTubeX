import { test, expect, sel } from '../../helpers/app.mjs'
import { expectImagesLoaded, fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'

const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

test.describe('Invidious search video avatars', () => {
  const instanceUrl = 'https://invidious.test'
  const avatarUrl = `${instanceUrl}/ggpht/channel-avatar`
  const settings = {
    backendPreference: 'invidious',
    defaultInvidiousInstance: instanceUrl,
    generalAutoLoadMorePaginatedItemsEnabled: false,
    listType: 'list'
  }

  test.use({ seed: { settings: { ...settings, uiScale: 125 } } })

  test.describe('result metadata layout', () => {
    // The scale projects supply the UI scale for these geometry checks.
    test.use({ seed: { settings } })

    test('loads shared avatars and lays out result metadata responsively', { tag: '@scale' }, async ({ page }) => {
      let channelRequests = 0

      await page.route(`${instanceUrl}/api/v1/search/**`, route => route.fulfill({
        json: [
          invidiousVideo('avatar-search-1', 'First avatar search result'),
          invidiousVideo('avatar-search-2', 'Second avatar search result'),
          invidiousPlaylist()
        ]
      }))
      await page.route(`${instanceUrl}/api/v1/channels/${CHANNEL_ID}?**`, route => {
        channelRequests++
        return route.fulfill({
          json: {
            author: 'Channel A',
            authorThumbnails: [{ url: avatarUrl }],
            tabs: []
          }
        })
      })
      await page.route(avatarUrl, route => fulfillVisualFixture(route, 'avatar'))
      await page.route(`${instanceUrl}/vi/**`, route => fulfillVisualFixture(route, 'video-thumbnail'))
      await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))

      await page.locator(sel.searchInput).fill('avatar results')
      await page.locator(sel.searchInput).press('Enter')

      const avatars = page.locator('.ft-list-video .channelAvatarImage')
      await expect(avatars).toHaveCount(3)
      await expect(avatars.first()).toHaveAttribute('src', avatarUrl)
      await expect.poll(() => avatars.evaluateAll(images => {
        return images.every(image => image.complete && image.naturalWidth === 48)
      })).toBe(true)
      await expectImagesLoaded(page.locator('.ft-list-video .thumbnailImage'))
      await expect(page.locator('.ft-list-video').filter({
        has: page.getByRole('heading', { name: 'Avatar search playlist' })
      }).locator('.channelAvatarImage')).toHaveAttribute('src', avatarUrl)
      const infoLine = page.locator('.ft-list-video').filter({
        has: page.getByRole('heading', { name: 'First avatar search result' })
      }).locator('.infoLine')
      // Short channel names still get their own line, so every card shares one layout.
      expect(await infoLine.evaluate(element => {
        const channel = element.querySelector('.channelName').getBoundingClientRect()
        const details = element.querySelector('.videoInfo')
        const view = element.querySelector('.viewCount').getBoundingClientRect()
        const uploaded = element.querySelector('.uploadedTime').getBoundingClientRect()

        return {
          detailsBelowChannel: view.top >= channel.bottom - 0.5,
          detailsShareRow: Math.abs(view.top - uploaded.top) <= 0.5,
          detailsAlignedWithChannel: Math.abs(details.getBoundingClientRect().left - channel.left) <= 0.5,
          separators: [details, ...details.children].map(child => getComputedStyle(child, '::before').content)
        }
      })).toEqual({
        detailsBelowChannel: true,
        detailsShareRow: true,
        detailsAlignedWithChannel: true,
        separators: ['none', 'none', 'none']
      })
      for (const stat of ['.viewCount', '.uploadedTime']) {
        const icon = infoLine.locator(`${stat} .statIcon`)
        await expect(icon).toBeVisible()
        await expect(icon).toHaveAttribute('aria-hidden', 'true')
      }
      await expect(infoLine.locator('.viewCount')).toHaveText('1 view')
      expect(channelRequests).toBe(1)

      // Narrow cards wrap the upload time below the view count, still without separators.
      await infoLine.evaluate(element => { element.style.inlineSize = '110px' })
      await expect.poll(() => infoLine.evaluate(element => {
        const view = element.querySelector('.viewCount').getBoundingClientRect()
        const uploaded = element.querySelector('.uploadedTime').getBoundingClientRect()
        return uploaded.top > view.top && Math.abs(uploaded.left - view.left) <= 0.5
      })).toBe(true)
    })
  })
})

function invidiousVideo(videoId, title) {
  return {
    type: 'video',
    title,
    videoId,
    author: 'Channel A',
    authorId: CHANNEL_ID,
    authorUrl: `/channel/${CHANNEL_ID}`,
    authorVerified: false,
    videoThumbnails: [],
    description: '',
    descriptionHtml: '',
    viewCount: 1,
    published: Math.floor(Date.now() / 1000),
    publishedText: 'now',
    lengthSeconds: 60,
    liveNow: false,
    premium: false,
    isUpcoming: false
  }
}

function invidiousPlaylist() {
  return {
    type: 'playlist',
    title: 'Avatar search playlist',
    playlistId: 'PL-avatar-search',
    playlistThumbnail: 'https://i.ytimg.com/vi/avatar-search-1/hqdefault.jpg',
    author: 'Channel A',
    authorId: CHANNEL_ID,
    authorUrl: `/channel/${CHANNEL_ID}`,
    authorVerified: false,
    videoCount: 2,
    videos: []
  }
}
