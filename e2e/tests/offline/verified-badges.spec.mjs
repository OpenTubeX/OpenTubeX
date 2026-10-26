import { test, expect, sel } from '../../helpers/app.mjs'
import { openMockedVideo } from '../../helpers/player.mjs'
import { fulfillVisualFixture } from '../../helpers/visual-fixtures.mjs'
import { mockPlayableWatchPage, watchViewHandle } from '../../helpers/watch.mjs'
import { WATCH_PAGE_SEED } from '../../helpers/watch-page.mjs'

const VERIFIED = 'BADGE_STYLE_TYPE_VERIFIED'
const VERIFIED_ARTIST = 'BADGE_STYLE_TYPE_VERIFIED_ARTIST'

function ownerBadges(style) {
  return style ? [{ metadataBadgeRenderer: { style, icon: { iconType: 'CHECK_CIRCLE_THICK' }, tooltip: 'Verified' } }] : []
}

function videoRenderer(videoId, title, channelName, index, badgeStyle) {
  return {
    videoRenderer: {
      videoId,
      title: { runs: [{ text: title }] },
      ownerText: {
        runs: [{ text: channelName, navigationEndpoint: { browseEndpoint: { browseId: `UC${String(index).padStart(22, '0')}` } } }]
      },
      ownerBadges: ownerBadges(badgeStyle),
      lengthText: { simpleText: '4:20' },
      viewCountText: { simpleText: '12,345 views' },
      publishedTimeText: { simpleText: '2 days ago' }
    }
  }
}

function channelRenderer(channelName, index, badgeStyle) {
  const channelId = `UC${String(index).padStart(22, '0')}`

  return {
    channelRenderer: {
      channelId,
      title: { simpleText: channelName },
      thumbnail: { thumbnails: [{ url: 'https://yt3.ggpht.com/channel-avatar', width: 160, height: 160 }] },
      navigationEndpoint: { browseEndpoint: { browseId: channelId } },
      ownerBadges: ownerBadges(badgeStyle),
      subscriberCountText: { simpleText: `@channel${index}` },
      videoCountText: { simpleText: '1.2K subscribers' },
      descriptionSnippet: { simpleText: '' }
    }
  }
}

const searchResponse = {
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [{
            itemSectionRenderer: {
              contents: [
                channelRenderer('Verified Creator', 1, VERIFIED),
                videoRenderer('aaaaaaaaaaa', 'Building a computer', 'Verified Creator', 1, VERIFIED),
                videoRenderer('bbbbbbbbbbb', 'Official music video', 'Official Artist', 2, VERIFIED_ARTIST),
                videoRenderer('ccccccccccc', 'Unboxing a keyboard', 'Small Channel', 3)
              ]
            }
          }]
        }
      }
    }
  }
}

test.describe('search results', () => {
  test.use({ seed: { settings: { generalAutoLoadMorePaginatedItemsEnabled: false } } })

  test('marks verified channels and official artist channels', async ({ page, attachScreenshot }) => {
    await page.route('https://www.youtube.com/youtubei/v1/search**', route => route.fulfill({ json: searchResponse }))
    await page.route('https://i.ytimg.com/**', route => fulfillVisualFixture(route, 'video-thumbnail'))
    await page.route('https://yt3.ggpht.com/**', route => fulfillVisualFixture(route, 'avatar'))

    await page.locator(sel.searchInput).fill('verified')
    await page.locator(sel.searchInput).press('Enter')

    const videos = page.locator('.ft-list-video')
    const verifiedBadge = videos.filter({ hasText: 'Building a computer' }).locator('.channelName .verifiedBadge')
    await expect(verifiedBadge).toBeVisible()
    await expect(verifiedBadge).toHaveAttribute('role', 'img')
    await expect(verifiedBadge).toHaveAttribute('aria-label', 'Verified')
    await expect(verifiedBadge).toHaveAttribute('title', 'Verified')
    await expect(verifiedBadge).toHaveAttribute('data-icon', 'verified')

    const artistBadge = videos.filter({ hasText: 'Official music video' }).locator('.channelName .verifiedBadge')
    await expect(artistBadge).toHaveAttribute('aria-label', 'Official Artist Channel')
    await expect(artistBadge).toHaveAttribute('data-icon', 'verified-artist')

    await expect(videos.filter({ hasText: 'Unboxing a keyboard' }).locator('.verifiedBadge')).toHaveCount(0)
    await expect(page.locator('.ft-list-channel').filter({ hasText: 'Verified Creator' }).locator('.title .verifiedBadge'))
      .toHaveAttribute('aria-label', 'Verified')

    await attachScreenshot('verified search results')
  })
})

test.describe('watch page', () => {
  test.use({ seed: { settings: WATCH_PAGE_SEED } })

  test('marks the verified video owner and comment authors', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page, { verifiedAuthors: true })
    await openMockedVideo(page)

    await expect(page.locator('.watchVideoInfo .channelName .verifiedBadge')).toHaveAttribute('aria-label', 'Verified')

    await page.locator('.commentAutoLoadSentinel').scrollIntoViewIfNeeded()
    const threads = page.locator('.commentThread')
    const authorBadge = index => threads.nth(index).locator('.commentAuthorWrapper').first().locator('.verifiedBadge')
    await expect(authorBadge(0)).toHaveAttribute('aria-label', 'Verified')
    await expect(authorBadge(1)).toHaveAttribute('aria-label', 'Official Artist Channel')
    await expect(authorBadge(2)).toHaveCount(0)

    await threads.first().scrollIntoViewIfNeeded()
    await attachScreenshot('verified comment authors')
  })

  test('marks verified live chat authors', async ({ app, page, attachScreenshot }) => {
    await mockPlayableWatchPage(app, page)
    await openMockedVideo(page)
    const view = await watchViewHandle(page)
    await view.evaluate(async view => {
      const avatar = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      const message = (id, name, badges) => ({
        is: type => type.type === 'AddChatItemAction',
        item: {
          is: type => type.type === 'LiveChatTextMessage',
          id,
          timestamp: Date.now(),
          message: { text: `Hello from ${name}` },
          author: { id: `${id}-channel`, name, thumbnails: [{ url: avatar }], badges, is_moderator: false }
        }
      })
      const verifiedBadge = { is: type => type.type === 'LiveChatAuthorBadge', icon_type: 'VERIFIED', tooltip: 'Verified' }
      const listeners = new Map()
      const chat = new EventTarget()
      chat.is_replay = false
      chat.on = (event, listener) => listeners.set(listener, event)
      chat.once = chat.on
      chat.off = (_event, listener) => listeners.delete(listener)
      chat.stop = () => {}
      chat.start = () => {
        for (const [listener, event] of listeners) {
          if (event === 'start') {
            listener({ actions: [message('verified', '@creator', [verifiedBadge]), message('viewer', '@viewer', [])] })
          }
        }
      }
      view.$store.commit('setHideLiveChat', false)
      view.liveChat = chat
      view.liveChatIsReplay = false
      view.liveChatOpen = true
      view.isLive = true
      view.isUpcoming = false
      await view.$nextTick()
    })

    const comments = page.locator('.liveChatComments .comment')
    await expect(comments.filter({ hasText: '@creator' }).locator('.verifiedBadge')).toHaveAttribute('aria-label', 'Verified')
    await expect(comments.filter({ hasText: '@viewer' })).toBeVisible()
    await expect(comments.filter({ hasText: '@viewer' }).locator('.verifiedBadge')).toHaveCount(0)
    await attachScreenshot('verified live chat author')
  })
})

test.describe('channel page', () => {
  test.use({
    seed: {
      settings: {
        backendPreference: 'invidious',
        defaultInvidiousInstance: 'https://invidious.test'
      }
    }
  })

  test('marks a verified channel in its header', async ({ page }) => {
    await page.route('https://invidious.test/api/v1/channels/**', route => route.fulfill({
      json: {
        author: 'Verified Creator',
        authorId: new URL(route.request().url()).pathname.split('/')[4],
        authorVerified: true,
        authorThumbnails: [],
        authorBanners: [],
        description: '',
        subCount: 10,
        totalViews: 0,
        joined: 0,
        tabs: ['videos'],
        relatedChannels: [],
        videos: [],
        latestVideos: []
      }
    }))

    const tab = await page.evaluate(() => window.ftElectron.tabs.create({ route: '/channel/UCaaaaaaaaaaaaaaaaaaaaaa', makeActive: false }))
    await page.locator(`.tab[data-tab-id="${tab.id}"]`).click()
    const name = page.locator('.channelDetails:visible .name')
    await expect(name).toHaveText('Verified Creator')
    await expect(name.locator('.verifiedBadge')).toHaveAttribute('aria-label', 'Verified')
  })
})
