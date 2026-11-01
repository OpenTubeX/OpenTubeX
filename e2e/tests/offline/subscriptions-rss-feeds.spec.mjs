import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

import {
  test,
  expect,
  goTo,
  goToSettingsSection,
  abortUnmockedRequest,
  expectScrollAtRenderedEnd,
  setWindowSize
} from '../../helpers/app.mjs'

const THUMBNAIL_PATH = fileURLToPath(new URL('../../fixtures/images/opentubex-playlist.jpg', import.meta.url))

const now = Date.now()
// An RSSHub route for a Twitch channel
const RSS_URL = 'https://rss.example.test/twitch/video/Streamer'
const ATOM_URL = 'https://rss.example.test/peertube/channel.atom'
const BROKEN_URL = 'https://rss.example.test/broken.xml'
const RSS_FEED = { url: RSS_URL, title: "Streamer's Twitch videos" }
const BROKEN_FEED = { url: BROKEN_URL, title: 'Broken feed' }
const TWITCH_AVATAR = 'https://rss.example.test/twitch-avatar.jpg'
const PEERTUBE_AVATAR = 'https://rss.example.test/peertube-avatar.jpg'

const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Streamer's Twitch videos</title>
    <link>https://www.twitch.tv/streamer/videos</link>
    <generator>RSSHub</generator>
    <item>
      <title>Older VOD</title>
      <link>https://www.twitch.tv/videos/1</link>
      <description><![CDATA[<img src="https://rss.example.test/thumb-1.jpg"><br>Stream description]]></description>
      <pubDate>${new Date(now - 3 * 86400000).toUTCString()}</pubDate>
      <guid isPermaLink="false">vod-1</guid>
      <dc:creator>Streamer</dc:creator>
    </item>
    <item>
      <title>Newest VOD</title>
      <link>https://www.twitch.tv/videos/3</link>
      <pubDate>${new Date(now - 3600000).toUTCString()}</pubDate>
      <guid isPermaLink="false">vod-3</guid>
      <dc:creator>Streamer</dc:creator>
    </item>
    <item>
      <title>Item without a web link</title>
      <link>javascript:alert(1)</link>
    </item>
  </channel>
</rss>`

const atomFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <title>PeerTube channel</title>
  <icon>${PEERTUBE_AVATAR}</icon>
  <entry>
    <id>urn:peertube:2</id>
    <title type="html">Atom &lt;b&gt;video&lt;/b&gt;</title>
    <link rel="alternate" href="/w/abc"/>
    <updated>${new Date(now).toISOString()}</updated>
    <published>${new Date(now - 2 * 86400000).toISOString()}</published>
    <author><name>PeerTube creator</name></author>
    <media:thumbnail url="https://rss.example.test/thumb-2.jpg"/>
  </entry>
</feed>`

const brokenFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Broken feed</title>
    <item>
      <title>Repaired item</title>
      <link>https://rss.example.test/repaired</link>
      <pubDate>${new Date(now - 2 * 3600000).toUTCString()}</pubDate>
    </item>
  </channel>
</rss>`

/**
 * @param {import('@playwright/test').Page} page
 */
async function mockFeeds(page) {
  const state = { brokenFeedWorks: false, twitchLogins: [] }
  await page.route(/^https?:\/\//, abortUnmockedRequest)
  await page.route('https://rss.example.test/**', route => {
    const url = route.request().url()
    if (url === RSS_URL) return route.fulfill({ contentType: 'application/rss+xml', body: rssFeed })
    if (url === ATOM_URL) return route.fulfill({ contentType: 'application/atom+xml', body: atomFeed })
    if (url === BROKEN_URL) {
      return state.brokenFeedWorks
        ? route.fulfill({ contentType: 'application/rss+xml', body: brokenFeed })
        : route.fulfill({ status: 500, body: 'Server error' })
    }
    if (url.endsWith('.jpg')) return route.fulfill({ path: THUMBNAIL_PATH })
    return route.abort()
  })
  await page.route('https://gql.twitch.tv/gql', route => {
    state.twitchLogins.push(route.request().postDataJSON().variables.login)
    return route.fulfill({ json: { data: { user: { profileImageURL: TWITCH_AVATAR } } } })
  })
  return state
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function openFeedManager(page) {
  const section = await goToSettingsSection(page, 'subscriptions')
  await section.getByRole('button', { name: 'Manage RSS Feeds' }).click()
  return page.locator('.settingsSubpageContent')
}

test.describe('with followed feeds', () => {
  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        enableRssFeeds: true,
        followedRssFeeds: [RSS_FEED, BROKEN_FEED]
      }
    }
  })

  test('shows the items of followed feeds and opens them with yt-dlp', async ({ page }) => {
    const mock = await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()

    const panel = page.locator('#subscriptionsPanel')
    const titles = panel.locator('.ft-list-item .h3Title')
    await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])
    await expect(panel.locator('.ft-list-item').nth(1).locator('img.thumbnailImage'))
      .toHaveAttribute('src', 'https://rss.example.test/thumb-1.jpg')
    await expect(panel.locator('.ft-list-item').first().locator('.channelName')).toHaveText('Streamer')
    // The RSSHub route identifies the Twitch channel
    await expect(panel.locator('.ft-list-item').first().locator('.channelName img'))
      .toHaveAttribute('src', TWITCH_AVATAR)
    await expect(panel.getByText('1 feed could not be refreshed.')).toBeVisible()
    await expect(panel.getByRole('textbox')).toHaveCount(0)
    expect(mock.twitchLogins).toEqual(['streamer'])
    expect(await page.evaluate(() => window.$store.getters.getFollowedRssFeeds[0]))
      .toEqual({ ...RSS_FEED, avatar: TWITCH_AVATAR })

    await titles.first().click()
    await expect.poll(() => page.evaluate(() => {
      const { path, query } = window.$router.currentRoute.value
      return { path, query }
    })).toEqual({ path: '/external-media', query: { url: 'https://www.twitch.tv/videos/3' } })
  })

  test('adds and removes feeds in the settings', async ({ page }) => {
    await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const titles = page.locator('#subscriptionsPanel .ft-list-item .h3Title')
    await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])

    const section = await goToSettingsSection(page, 'subscriptions')
    await expect(section.getByRole('heading', { name: 'Subscription', exact: true })).toBeVisible()
    await expect(section.getByRole('heading', { name: 'RSS Feeds' })).toBeVisible()

    const manager = await openFeedManager(page)
    await expect(manager.getByRole('link', { name: 'RSSHub', exact: true }))
      .toHaveAttribute('href', 'https://github.com/DIYgod/RSSHub')
    const rows = manager.locator('.feedRow')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText(RSS_URL)
    await expect(rows.first().locator('img.feedAvatar')).toHaveAttribute('src', TWITCH_AVATAR)
    await expect(manager.getByRole('link', { name: 'Public RSSHub instances' }))
      .toHaveAttribute('href', 'https://docs.rsshub.app/guide/instances')
    // The tab has already refreshed the feeds in this window
    await expect(manager.locator('.feedRow.hasError')).toContainText('Broken feed')

    const input = manager.getByRole('textbox', { name: 'Add Feed' })
    await input.fill('not a url')
    await input.press('Enter')
    await expect(page.getByText('Enter a web address that starts with http:// or https://.')).toBeVisible()

    await input.fill(RSS_URL)
    await input.press('Enter')
    await expect(page.getByText('You already follow this feed.')).toBeVisible()

    await input.fill(ATOM_URL)
    await input.press('Enter')
    await expect(rows).toHaveCount(3)
    await expect(rows.last()).toContainText('PeerTube channel')
    // Feeds that aren't from RSSHub can supply their own image
    await expect(rows.last().locator('img.feedAvatar')).toHaveAttribute('src', PEERTUBE_AVATAR)
    await expect(input).toHaveValue('')

    await manager.getByRole('button', { name: 'Remove Broken feed' }).click()
    await expect(rows).toHaveCount(2)
    expect(await page.evaluate(() => window.$store.getters.getFollowedRssFeeds)).toEqual([
      { ...RSS_FEED, avatar: TWITCH_AVATAR },
      { url: ATOM_URL, title: 'PeerTube channel', avatar: PEERTUBE_AVATAR }
    ])

    await page.locator('.settingsCloseButton').click()
    await expect(page.locator('.settingsWindow')).toBeHidden()
    await expect(titles).toHaveText(['Newest VOD', 'Atom video', 'Older VOD'])
    await expect(page.getByText('1 feed could not be refreshed.')).toBeHidden()
  })

  test('retries a failed feed from the feed manager', async ({ page }) => {
    const mock = await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    const titles = panel.locator('.ft-list-item .h3Title')
    await expect(panel.getByText('1 feed could not be refreshed.')).toBeVisible()

    // The edit button beside the refresh button opens the feed manager directly
    await page.locator('.subscriptionsHeader').getByRole('button', { name: 'Manage RSS Feeds' }).click()
    const manager = page.locator('.settingsSubpageContent')
    const brokenRow = manager.locator('.feedRow').filter({ hasText: 'Broken feed' })
    const retry = brokenRow.getByRole('button', { name: 'Retry Broken feed' })
    await expect(brokenRow).toHaveClass(/hasError/)
    await expect(manager.locator('.feedRow').first().getByRole('button', { name: /^Retry/ })).toHaveCount(0)

    await retry.click()
    await expect(page.getByText('The feed could not be loaded.', { exact: false })).toBeVisible()
    await expect(brokenRow).toHaveClass(/hasError/)

    mock.brokenFeedWorks = true
    await retry.click()
    await expect(brokenRow).not.toHaveClass(/hasError/)
    await expect(retry).toHaveCount(0)

    await page.locator('.settingsCloseButton').click()
    await expect(titles).toHaveText(['Newest VOD', 'Repaired item', 'Older VOD'])
    await expect(panel.getByText('1 feed could not be refreshed.')).toBeHidden()
  })

  test('keeps a feed added while another refresh is running', async ({ page }) => {
    await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const titles = page.locator('#subscriptionsPanel .ft-list-item .h3Title')
    await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])

    // Hold the next refresh of the existing feed until the new feed is added
    let release
    const held = new Promise(resolve => { release = resolve })
    let delivered = false
    await page.route(RSS_URL, async route => {
      await held
      await route.fulfill({ contentType: 'application/rss+xml', body: rssFeed })
      delivered = true
    })
    const header = page.locator('.subscriptionsHeader')
    await header.getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toBeVisible()

    await header.getByRole('button', { name: 'Manage RSS Feeds' }).click()
    const manager = page.locator('.settingsSubpageContent')
    const input = manager.getByRole('textbox', { name: 'Add Feed' })
    await input.fill(ATOM_URL)
    await input.press('Enter')
    await expect(manager.locator('.feedRow')).toHaveCount(3)
    await page.locator('.settingsCloseButton').click()
    await expect(titles).toHaveText(['Newest VOD', 'Atom video', 'Older VOD'])

    release()
    await expect.poll(() => delivered).toBe(true)
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toHaveCount(0)
    // Let the finished refresh render before checking that it kept the new feed
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await titles.allTextContents()).toEqual(['Newest VOD', 'Atom video', 'Older VOD'])
  })

  test('keeps a feed retried while another refresh is running', async ({ page }) => {
    const mock = await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    const titles = panel.locator('.ft-list-item .h3Title')
    await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])
    await expect(panel.getByText('1 feed could not be refreshed.')).toBeVisible()

    // The broken feed fails again in the held refresh, then a retry repairs it
    let release
    const held = new Promise(resolve => { release = resolve })
    let delivered = false
    await page.route(RSS_URL, async route => {
      await held
      await route.fulfill({ contentType: 'application/rss+xml', body: rssFeed })
      delivered = true
    })
    const header = page.locator('.subscriptionsHeader')
    await header.getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toBeVisible()

    mock.brokenFeedWorks = true
    await header.getByRole('button', { name: 'Manage RSS Feeds' }).click()
    const brokenRow = page.locator('.settingsSubpageContent .feedRow').filter({ hasText: 'Broken feed' })
    await brokenRow.getByRole('button', { name: 'Retry Broken feed' }).click()
    await expect(brokenRow).not.toHaveClass(/hasError/)
    await page.locator('.settingsCloseButton').click()
    await expect(titles).toHaveText(['Newest VOD', 'Repaired item', 'Older VOD'])

    mock.brokenFeedWorks = false
    release()
    await expect.poll(() => delivered).toBe(true)
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toHaveCount(0)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await titles.allTextContents()).toEqual(['Newest VOD', 'Repaired item', 'Older VOD'])
    await expect(panel.getByText('1 feed could not be refreshed.')).toHaveCount(0)
  })

  test('keeps the previous items of a feed that fails to refresh', async ({ page }) => {
    await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    const titles = panel.locator('.ft-list-item .h3Title')
    await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])

    let failed = false
    await page.route(RSS_URL, async route => {
      await route.fulfill({ status: 500, body: 'Server error' })
      failed = true
    })
    await page.locator('.subscriptionsHeader').getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(panel.getByText('2 feeds could not be refreshed.')).toBeVisible()
    expect(failed).toBe(true)
    expect(await titles.allTextContents()).toEqual(['Newest VOD', 'Older VOD'])
  })

  test('keeps the feed manager button on the refresh row at phone widths', { tag: '@scale' }, async ({ app, page }) => {
    await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    await expect(page.locator('#subscriptionsPanel .ft-list-item')).toHaveCount(2)
    await setWindowSize(app, page, { width: 375, height: 800 })

    const header = page.locator('.subscriptionsHeader')
    const manage = header.getByRole('button', { name: 'Manage RSS Feeds' })
    const refresh = header.locator('.headerRefreshWidget')
    await expect(refresh.locator('.lastRefreshTimestamp')).toBeVisible()
    await expect.poll(async () => {
      const [button, widget] = await Promise.all([manage.boundingBox(), refresh.boundingBox()])
      return Math.abs((button.y + button.height / 2) - (widget.y + widget.height / 2)) <= 2 &&
        button.x + button.width <= widget.x + 1
    }).toBe(true)
  })

  test('shows the progress of watched items', async ({ page }) => {
    await mockFeeds(page)
    await page.evaluate(() => {
      localStorage.setItem('externalMediaPosition:https://www.twitch.tv/videos/3',
        JSON.stringify({ seconds: 0, watched: true, updatedAt: Date.now() }))
    })
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const items = page.locator('#subscriptionsPanel .ft-list-item')
    await expect(items).toHaveCount(2)
    await expect(items.first()).toHaveClass(/watched/)
    await expect(items.first().locator('.videoWatched')).toHaveText('Watched')
    await expect(items.first().locator('.watchedProgressBar')).toBeVisible()
    await expect(items.nth(1)).not.toHaveClass(/watched/)
    await expect(items.nth(1).locator('.watchedProgressBar')).toHaveCount(0)

    // Another window saves a position
    await page.evaluate(() => {
      const key = 'externalMediaPosition:https://www.twitch.tv/videos/1'
      localStorage.setItem(key, JSON.stringify({ seconds: 30, duration: 120, updatedAt: Date.now() }))
      window.dispatchEvent(new StorageEvent('storage', { key }))
    })
    await expect(items.nth(1).locator('.watchedProgressBar')).toBeVisible()
    await expect(items.nth(1)).not.toHaveClass(/watched/)
  })
})

test.describe('with many followed feeds', () => {
  const feeds = Array.from({ length: 30 }, (_, index) => ({
    url: `https://rss.example.test/feed-${index}.xml`,
    title: `Feed ${String(index).padStart(2, '0')}`
  }))
  test.use({
    seed: { settings: { fetchSubscriptionsAutomatically: false, enableRssFeeds: true, followedRssFeeds: feeds } }
  })

  test('keeps the feed list at its end after removing feeds', { tag: '@scale' }, async ({ page }) => {
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    const manager = await openFeedManager(page)
    const scroller = manager.locator('.rssFeedsScroller')
    const scrollbar = scroller.locator(':scope > .os-scrollbar-vertical')
    await expect(manager.locator('.feedRow')).toHaveCount(30)
    await expect(scrollbar).not.toHaveClass(/os-scrollbar-unusable/)

    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

    for (const index of [29, 28, 27, 26, 25]) {
      await manager.getByRole('button', { name: `Remove Feed ${index}` }).click()
    }
    await expect(manager.locator('.feedRow')).toHaveCount(25)
    await expectScrollAtRenderedEnd(scroller)

    await page.evaluate(() => window.$store.dispatch('updateFollowedRssFeeds', []))
    await expect(manager.getByText("You don't follow any RSS feeds yet.")).toBeVisible()
    await expectScrollAtRenderedEnd(scroller)
    await expect(scrollbar).toHaveClass(/os-scrollbar-unusable/)
  })
})

test.describe('without followed feeds', () => {
  test.use({ seed: { settings: { fetchSubscriptionsAutomatically: false, enableRssFeeds: true } } })

  test('resolves relative links against the redirected feed address', async ({ page }) => {
    // Playwright doesn't intercept redirected requests, so a local server answers both
    const server = createServer((request, response) => {
      if (request.url === '/short') {
        response.writeHead(302, { location: '/channel/feed.xml' }).end()
      } else {
        response.writeHead(200, { 'content-type': 'application/rss+xml' }).end(`<?xml version="1.0"?>
          <rss version="2.0"><channel><title>Redirected feed</title>
          <item><title>Relative episode</title><link>episode/1</link><pubDate>${new Date(now).toUTCString()}</pubDate></item>
          </channel></rss>`)
      }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    try {
      await page.route(/^https?:\/\//, abortUnmockedRequest)
      await page.route(`${origin}/**`, route => route.continue())
      const manager = await openFeedManager(page)
      const input = manager.getByRole('textbox', { name: 'Add Feed' })
      await input.fill(`${origin}/short`)
      await input.press('Enter')
      await expect(manager.locator('.feedRow')).toContainText('Redirected feed')
      await page.locator('.settingsCloseButton').click()

      await goTo(page, 'subscriptions')
      await page.locator('[data-rss-feeds-tab]').click()
      await page.locator('#subscriptionsPanel .h3Title', { hasText: 'Relative episode' }).click()
      await expect.poll(() => page.evaluate(() => window.$router.currentRoute.value.query.url))
        .toBe(`${origin}/channel/episode/1`)
    } finally {
      server.close()
    }
  })

  test('reports a feed that could not be saved', async ({ page }) => {
    await mockFeeds(page)
    const manager = await openFeedManager(page)
    await page.evaluate(() => {
      const store = window.$store
      const dispatch = store.dispatch
      store.dispatch = (type, payload) => type === 'updateFollowedRssFeeds'
        ? Promise.resolve(false)
        : dispatch.call(store, type, payload)
    })
    const input = manager.getByRole('textbox', { name: 'Add Feed' })
    await input.fill(ATOM_URL)
    await input.press('Enter')
    await expect(page.getByText('The feed could not be loaded.', { exact: false })).toBeVisible()
    await expect(input).toHaveValue(ATOM_URL)
    await expect(manager.locator('.feedRow')).toHaveCount(0)
  })

  test('plays podcast episodes from their audio enclosure', async ({ page }) => {
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    await page.route('https://rss.example.test/podcast.xml', route => route.fulfill({
      contentType: 'application/rss+xml',
      body: `<?xml version="1.0"?><rss version="2.0"><channel><title>Podcast</title>
        <item><title>Episode 1</title><link>https://rss.example.test/episodes/1</link>
          <enclosure url="https://cdn.example.test/episode-1.mp3" type="audio/mpeg" length="1"/>
          <pubDate>${new Date(now).toUTCString()}</pubDate></item>
      </channel></rss>`
    }))
    const manager = await openFeedManager(page)
    const input = manager.getByRole('textbox', { name: 'Add Feed' })
    await input.fill('https://rss.example.test/podcast.xml')
    await input.press('Enter')
    await expect(manager.locator('.feedRow')).toContainText('Podcast')
    await page.locator('.settingsCloseButton').click()

    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    await page.locator('#subscriptionsPanel .h3Title', { hasText: 'Episode 1' }).click()
    await expect.poll(() => page.evaluate(() => window.$router.currentRoute.value.query.url))
      .toBe('https://cdn.example.test/episode-1.mp3')
  })

  test('opens the feed manager from the empty tab', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    await expect(panel.getByText("You don't follow any RSS feeds yet.")).toBeVisible()
    await panel.getByRole('button', { name: 'Manage RSS Feeds' }).click()
    await expect(page.locator('.settingsSubpageContent').getByRole('textbox', { name: 'Add Feed' })).toBeVisible()
  })
})

test.describe('when RSS feeds are disabled', () => {
  test.use({ seed: { settings: { fetchSubscriptionsAutomatically: false, enableRssFeeds: false } } })

  test('hides the tab and the feed management', async ({ page }) => {
    await goTo(page, 'subscriptions')
    await expect(page.locator('[data-subscription-feed-tab="videos"]')).toBeVisible()
    await expect(page.locator('[data-rss-feeds-tab]')).toHaveCount(0)

    const section = await goToSettingsSection(page, 'subscriptions')
    await expect(section.getByRole('button', { name: 'Manage RSS Feeds' })).toHaveCount(0)
    await section.locator('label.switch-label').filter({ hasText: 'Enable RSS Feeds for Other Platforms' }).click()
    await expect(section.getByRole('button', { name: 'Manage RSS Feeds' })).toBeVisible()
    await page.locator('.settingsCloseButton').click()
    await expect(page.locator('[data-rss-feeds-tab]')).toBeVisible()
  })
})
