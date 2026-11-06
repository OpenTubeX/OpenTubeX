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

/**
 * Measures how far a badge circle overhangs the cap band of the name before it.
 * @param {import('@playwright/test').Locator} badge
 */
function capBandOverhang(badge) {
  return badge.evaluate(badge => {
    let node = badge.parentElement.previousSibling
    while (!node.textContent.trim()) node = node.previousSibling
    let text = node
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim()) text = walker.currentNode
    }
    const range = document.createRange()
    range.selectNodeContents(text)
    const line = [...range.getClientRects()].at(-1)
    const context = document.createElement('canvas').getContext('2d')
    context.font = getComputedStyle(text.parentElement).font
    const metrics = context.measureText('H')
    const baseline = line.top + metrics.fontBoundingBoxAscent
    const circle = badge.querySelector('path').getBoundingClientRect()
    return {
      top: baseline - metrics.actualBoundingBoxAscent - circle.top,
      bottom: circle.bottom - baseline
    }
  })
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

  test('keeps badges on the line of the last character of wrapped names', { tag: '@scale' }, async ({ page }) => {
    const channelName = 'Calm Evening Meditation Sounds And Stories'
    const response = structuredClone(searchResponse)
    response.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents = [
      channelRenderer(channelName, 1, VERIFIED),
      videoRenderer('aaaaaaaaaaa', 'Breathing exercise', channelName, 1, VERIFIED_ARTIST)
    ]
    await page.route('https://www.youtube.com/youtubei/v1/search**', route => route.fulfill({ json: response }))

    await page.locator(sel.searchInput).fill('meditation')
    await page.locator(sel.searchInput).press('Enter')

    const badges = [
      page.locator('.ft-list-video .channelName .verifiedBadge'),
      page.locator('.ft-list-channel .title .verifiedBadge')
    ]
    for (const badge of badges) {
      await expect(badge).toBeVisible()
      // Narrow the name one pixel at a time so every wrap position is checked.
      const strandedWidths = await badge.evaluate(badge => {
        const name = badge.closest('.channelNameText, .h3Title')
        const walker = document.createTreeWalker(name, NodeFilter.SHOW_TEXT)
        let text = null
        while (walker.nextNode()) {
          if (/\p{L}/u.test(walker.currentNode.textContent)) text = walker.currentNode
        }
        const end = text.textContent.trimEnd().length
        const range = document.createRange()
        range.setStart(text, end - 1)
        range.setEnd(text, end)

        const stranded = []
        for (let width = 40; width <= 400; width++) {
          name.style.display = 'inline-block'
          name.style.inlineSize = `${width}px`
          const lastCharacter = range.getBoundingClientRect()
          if (badge.getBoundingClientRect().top >= lastCharacter.bottom) stranded.push(width)
        }
        name.style.removeProperty('display')
        name.style.removeProperty('inline-size')
        return stranded
      })
      expect(strandedWidths).toEqual([])
    }
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

  test('aligns badges with the cap height of the names', { tag: '@scale' }, async ({ app, page }) => {
    await mockPlayableWatchPage(app, page, { verifiedAuthors: true })
    await openMockedVideo(page)
    await page.locator('.commentAutoLoadSentinel').scrollIntoViewIfNeeded()

    const badges = [
      page.locator('.watchVideoInfo .channelName .verifiedBadge'),
      page.locator('.commentThread').first().locator('.commentAuthorWrapper .verifiedBadge').first()
    ]
    for (const badge of badges) {
      await expect(badge).toBeVisible()
      // Canvas rounds the cap height to whole pixels.
      const { top, bottom } = await capBandOverhang(badge)
      expect(Math.abs(top)).toBeLessThanOrEqual(1)
      expect(Math.abs(bottom)).toBeLessThanOrEqual(1)
    }
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
    await expect(comments.filter({ hasText: '@creator' }).locator('.verifiedBadge')).toHaveCSS('margin-inline-end', '5px')
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
