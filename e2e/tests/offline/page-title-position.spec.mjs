import { test, expect, goTo, setWindowSize } from '../../helpers/app.mjs'

const now = Date.now()
const CHANNEL_ID = 'UCaaaaaaaaaaaaaaaaaaaaaa'

const videos = Array.from({ length: 2 }, (_, index) => ({
  videoId: `video${String(index).padStart(6, '0')}`,
  title: `video ${index}`,
  author: 'Channel A',
  authorId: CHANNEL_ID,
  published: now - index * 3600000,
  viewCount: 1000,
  lengthSeconds: 120,
  liveNow: false,
  isUpcoming: false,
  type: 'video'
}))

test.use({
  seed: {
    settings: { fetchSubscriptionsAutomatically: false },
    profiles: [{
      _id: 'allChannels',
      name: 'All Channels',
      bgColor: '#000000',
      textColor: '#FFFFFF',
      subscriptions: [{ id: CHANNEL_ID, name: 'Channel A', thumbnail: '' }]
    }],
    subscriptionCache: [{ _id: CHANNEL_ID, videos, videosTimestamp: new Date(now).toISOString() }],
    // History only shows its action buttons beside the title when it has entries
    history: videos.map(video => ({
      ...video,
      _id: video.videoId,
      description: '',
      isLive: false,
      isWatched: false,
      timeWatched: now,
      watchProgress: 10
    }))
  }
})

const TITLES = {
  home: 'Home',
  subscriptions: 'Subscriptions',
  userplaylists: 'Your playlists',
  history: 'History',
  subscribedchannels: 'Channel list',
  trending: 'Trending',
  stats: 'Stats'
}

const DESKTOP = { width: 1200, height: 800 }
const PHONE = { width: 412, height: 860 }

async function resize(app, page, uiScale, size) {
  if (Math.abs(await page.evaluate(() => window.innerWidth) - size.width) <= 1) return
  await setWindowSize(app, page, {
    width: Math.round(size.width * uiScale / 100),
    height: Math.round(size.height * uiScale / 100)
  })
}

// Phones list some of these pages in the More menu, so open them on desktop
async function openPage(app, page, uiScale, route, size) {
  await resize(app, page, uiScale, DESKTOP)
  await goTo(page, route)
  await expect(page.locator('.pageTitle:visible')).toHaveText(TITLES[route])
  await resize(app, page, uiScale, size)
}

/** The title's offset from the top of its card, and its text size. */
function titlePosition(page) {
  return page.evaluate(() => {
    const title = [...document.querySelectorAll('.pageTitle')].find(element => element.checkVisibility())
    const text = document.createRange()
    text.selectNodeContents(title)
    return {
      offset: text.getBoundingClientRect().top - title.closest('.ft-card').getBoundingClientRect().top,
      fontSize: getComputedStyle(title).fontSize
    }
  })
}

test.describe('main page titles', { tag: '@scale' }, () => {
  for (const [layout, size] of [['phone', PHONE], ['desktop', DESKTOP]]) {
    test(`stay in place when switching pages on ${layout}`, async ({ app, page, uiScale }) => {
      const positions = {}
      for (const route of Object.keys(TITLES)) {
        await openPage(app, page, uiScale, route, size)
        positions[route] = await titlePosition(page)
      }

      const expected = positions.subscriptions
      for (const route of Object.keys(TITLES)) {
        expect(positions[route].fontSize, `${route} title size`).toBe(expected.fontSize)
        expect(positions[route].offset, `${route} title offset`).toBeCloseTo(expected.offset, 0)
      }
    })
  }

  test('centers the Home Customize button on the title line', async ({ app, page, uiScale }) => {
    await openPage(app, page, uiScale, 'home', DESKTOP)

    const centers = await page.evaluate(() => {
      const center = rect => rect.top + rect.height / 2
      return {
        title: center(document.querySelector('.homeHeading .pageTitle').getBoundingClientRect()),
        button: center(document.querySelector('.homeHeading .btn').getBoundingClientRect())
      }
    })
    expect(centers.button).toBeCloseTo(centers.title, 0)
  })

  test('keeps the phone subscription tabs clear of the title', async ({ app, page, uiScale }) => {
    await openPage(app, page, uiScale, 'subscriptions', PHONE)

    const gap = await page.evaluate(() => {
      const text = document.createRange()
      text.selectNodeContents(document.querySelector('.pageTitle'))
      return document.querySelector('.tab.selectedTab').getBoundingClientRect().top - text.getBoundingClientRect().bottom
    })
    expect(gap).toBeGreaterThanOrEqual(12)
  })
})
