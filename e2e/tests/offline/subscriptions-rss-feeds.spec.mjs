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

const RSSHUB_NAMESPACES = {
  twitch: {
    name: 'Twitch',
    url: 'www.twitch.tv',
    routes: {
      '/live/:login': {
        path: '/live/:login',
        name: 'Live',
        example: '/twitch/live/riotgames',
        parameters: { login: 'Twitch username' }
      },
      '/video/:login/:filter?': {
        path: '/video/:login/:filter?',
        name: 'Channel Video',
        example: '/twitch/video/riotgames/highlights',
        parameters: {
          login: 'Twitch username',
          filter: {
            description: 'Video type, Default to all',
            options: [{ value: 'archive', label: 'Archive' }, { value: 'all', label: 'All' }],
            default: 'all'
          }
        }
      }
    }
  },
  art: {
    name: 'Art',
    url: 'art.com.tw',
    routes: { '/new': { path: '/new', name: 'New works' } }
  },
  // Another service for the same site
  twitchmirror: {
    name: 'Twitch',
    url: 'www.twitch.tv',
    routes: { '/clips/:login': { path: '/clips/:login', name: 'Clips', parameters: { login: 'Twitch username' } } }
  },
  peertube: {
    name: 'PeerTube',
    routes: { '/channel/:id': { path: '/channel/:id', name: 'Channel', parameters: { id: 'Channel ID' } } }
  }
}

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
    await expect(manager.getByRole('button', { name: 'Browse RSSHub' })).toBeVisible()
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

  test('adds a feed by picking an RSSHub instance, service and creator', async ({ page }) => {
    await mockFeeds(page)
    const otherUrl = 'https://rss.example.test/twitch/video/Other'
    const requests = []
    await page.route('https://raw.githubusercontent.com/RSSNext/rsshub-docs/**', route => route.fulfill({
      body: `const instances = [
  { url: 'https://down.example.test', location: '🇩🇪', maintainer: 'Down' },
  { url: 'https://rss.example.test/', location: '🇺🇸' },
];`
    }))
    await page.route('https://down.example.test/**', route => route.fulfill({ status: 502, body: 'Bad gateway' }))
    await page.route(/^https:\/\/rss\.example\.test\/(api\/namespace|twitch\/video\/Other)/, route => {
      const url = route.request().url()
      requests.push(url)
      if (url === otherUrl) {
        return route.fulfill({ contentType: 'application/rss+xml', body: rssFeed.replace("Streamer's Twitch videos", "Other's Twitch videos") })
      }
      return route.fulfill({ json: RSSHUB_NAMESPACES })
    })

    const manager = await openFeedManager(page)
    await manager.getByRole('button', { name: 'Browse RSSHub' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add a feed from RSSHub' })
    const service = dialog.getByRole('textbox', { name: 'Service' })
    await expect(service).toBeDisabled()

    const instance = dialog.getByRole('textbox', { name: 'RSSHub instance' })
    await instance.click()
    const instanceOptions = dialog.locator('.instanceInput .list li')
    await expect(instanceOptions).toHaveText(['down.example.test 🇩🇪', 'rss.example.test 🇺🇸'])
    await instanceOptions.first().click()
    await expect(dialog.getByRole('alert')).toContainText('This instance did not return its services.')
    await expect(service).toBeDisabled()

    // A custom host works without a scheme
    await instance.fill('rss.example.test')
    await instance.press('Enter')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(service).toBeEnabled()
    await expect.poll(() => page.evaluate(() => window.$store.getters.getRssHubInstance)).toBe('https://rss.example.test')

    await service.fill('tw')
    // Name matches come before matches in the address
    const serviceOptions = dialog.locator('.serviceInput .list li')
    await expect(serviceOptions).toHaveText(['Twitch (www.twitch.tv) · twitch', 'Twitch (www.twitch.tv) · twitchmirror', 'Art (art.com.tw)'])
    // Services with the same name stay apart
    await serviceOptions.nth(1).click()
    await expect(dialog.getByRole('combobox', { name: 'Feed type' })).toContainText('Clips')
    await service.fill('tw')
    await serviceOptions.first().click()
    await expect(service).toHaveValue('Twitch (www.twitch.tv) · twitch')

    const feedType = dialog.getByRole('combobox', { name: 'Feed type' })
    await expect(feedType).toContainText('Live')
    await feedType.click()
    await page.getByRole('option', { name: 'Channel Video' }).click()
    await expect(dialog.getByRole('combobox', { name: 'filter (optional)' })).toContainText('All')

    const add = dialog.getByRole('button', { name: 'Add Feed' })
    await expect(add).toBeDisabled()
    const login = dialog.getByRole('textbox', { name: 'login' })
    await expect(login).toHaveAttribute('placeholder', 'e.g. riotgames')
    await login.fill('Other')
    // The default filter is left out of the address
    await expect(dialog.locator('.feedUrlPreview')).toHaveText(otherUrl)
    await add.click()

    await expect(dialog).toHaveCount(0)
    await expect(manager.locator('.feedRow').last()).toContainText("Other's Twitch videos")
    expect(await page.evaluate(() => window.$store.getters.getFollowedRssFeeds.at(-1).url)).toBe(otherUrl)
    expect(requests).toEqual(['https://rss.example.test/api/namespace', otherUrl])

    // The instance is remembered
    await manager.getByRole('button', { name: 'Browse RSSHub' }).click()
    await expect(dialog.getByRole('textbox', { name: 'RSSHub instance' })).toHaveValue('https://rss.example.test')
    await expect(dialog.getByRole('textbox', { name: 'Service' })).toBeEnabled()
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

  test('opens the feed manager from the RSS tab after settings were opened before', async ({ page }) => {
    await mockFeeds(page)
    const section = await goToSettingsSection(page, 'subscriptions')
    const manager = page.locator('.settingsSubpageContent')
    await page.locator('.settingsCloseButton').click()
    await expect(page.locator('.settingsWindow')).toBeHidden()

    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const header = page.locator('.subscriptionsHeader')
    for (let attempt = 0; attempt < 2; attempt++) {
      await header.getByRole('button', { name: 'Manage RSS Feeds' }).click()
      await expect(manager.getByRole('textbox', { name: 'Add Feed' })).toBeVisible()
      // Focus stays in the window, so Escape closes it
      await page.keyboard.press('Escape')
      await expect(page.locator('.settingsWindow')).toBeHidden()
    }

    // The settings button still opens the manager afterwards
    await goTo(page, 'settings')
    await page.locator('.settingsWindow').getByRole('banner').getByRole('button', { name: 'Subscriptions' }).click()
    await expect(manager).toHaveCount(0)
    await section.getByRole('button', { name: 'Manage RSS Feeds' }).click()
    await expect(manager.getByRole('textbox', { name: 'Add Feed' })).toBeVisible()
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

  test('keeps the items of a feed that fails to refresh after a restart', async ({ page }) => {
    await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    const titles = panel.locator('.ft-list-item .h3Title')
    await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])

    await page.route(RSS_URL, route => route.fulfill({ status: 500, body: 'Server error' }))
    await page.reload()
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    await expect(panel.getByText('2 feeds could not be refreshed.')).toBeVisible()
    await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])
  })

  test('keeps the items of a feed added before the RSS tab was opened after a restart', async ({ page }) => {
    await mockFeeds(page)
    const manager = await openFeedManager(page)
    const input = manager.getByRole('textbox', { name: 'Add Feed' })
    await input.fill(ATOM_URL)
    await input.press('Enter')
    await expect(manager.locator('.feedRow')).toHaveCount(3)

    await page.route(ATOM_URL, route => route.fulfill({ status: 500, body: 'Server error' }))
    await page.reload()
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    await expect(panel.getByText('2 feeds could not be refreshed.')).toBeVisible()
    await expect(panel.locator('.ft-list-item .h3Title', { hasText: 'Atom video' })).toBeVisible()
  })

  test('shows progress while a feed is added', { tag: '@scale' }, async ({ page }) => {
    await mockFeeds(page)
    let release
    const held = new Promise(resolve => { release = resolve })
    await page.route(ATOM_URL, async route => {
      await held
      await route.fulfill({ contentType: 'application/atom+xml', body: atomFeed })
    })
    const manager = await openFeedManager(page)
    const input = manager.getByRole('textbox', { name: 'Add Feed' })
    const progress = manager.getByRole('progressbar', { name: 'Add Feed' })
    await expect(progress).toHaveCount(0)
    await input.fill(ATOM_URL)
    await input.press('Enter')
    await expect(progress).toBeVisible()
    await expect(input).toBeDisabled()
    // Without animations, the bar fills the track instead of stopping partway
    await page.evaluate(() => { document.documentElement.dataset.reducedMotion = 'reduce' })
    await expect.poll(() => progress.evaluate(bar => getComputedStyle(bar, '::before').width === getComputedStyle(bar).width))
      .toBe(true)

    release()
    await expect(manager.locator('.feedRow')).toHaveCount(3)
    await expect(progress).toHaveCount(0)
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

  test('marks items as watched, copies their link, and downloads them from the context menu', async ({ app, page }) => {
    const newestUrl = 'https://www.twitch.tv/videos/3'
    const olderUrl = 'https://www.twitch.tv/videos/1'
    await mockFeeds(page)
    await page.evaluate((url) => {
      localStorage.setItem(`externalMediaPosition:${url}`, JSON.stringify({ seconds: 30, duration: 120, updatedAt: Date.now() }))
    }, olderUrl)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const items = page.locator('#subscriptionsPanel .ft-list-item')
    const [newest, older] = [items.first(), items.nth(1)]
    await expect(items).toHaveCount(2)
    const menu = page.locator('.contextMenu')
    const position = url => page.evaluate(url => JSON.parse(localStorage.getItem(`externalMediaPosition:${url}`)), url)
    const openMenu = item => item.locator('.title').click({ button: 'right' })

    // Without a saved position, marking it as watched already starts it over next time
    await openMenu(newest)
    await expect(menu.getByRole('menuitem', { name: 'Mark As Fully Watched' })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Mark As Watched' }).click()
    await expect(newest).toHaveClass(/watched/)
    await expect(newest.locator('.videoWatched')).toHaveText('Watched')
    expect(await position(newestUrl)).toEqual({ seconds: 0, watched: true, updatedAt: expect.any(Number) })

    await openMenu(newest)
    await menu.getByRole('menuitem', { name: 'Unmark As Watched' }).click()
    await expect(newest).not.toHaveClass(/watched/)
    expect(await position(newestUrl)).toBeNull()

    // Marking it as watched keeps where it resumes, marking it as fully watched starts it over
    await openMenu(older)
    await menu.getByRole('menuitem', { name: 'Mark As Watched' }).click()
    await expect(older).toHaveClass(/watched/)
    expect(await position(olderUrl)).toEqual({ seconds: 30, duration: 120, watched: true, updatedAt: expect.any(Number) })
    await openMenu(older)
    await menu.getByRole('menuitem', { name: 'Mark As Fully Watched' }).click()
    await expect.poll(() => position(olderUrl)).toEqual({ seconds: 0, watched: true, updatedAt: expect.any(Number) })
    await expect(older).toHaveClass(/watched/)

    await openMenu(older)
    await menu.getByRole('menuitem', { name: 'Copy Link' }).click()
    await expect.poll(() => app.electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(olderUrl)

    // The options button opens the same menu
    await page.evaluate(() => window.$store.dispatch('updateShowVideoMenuButton', true))
    await older.hover()
    await older.getByRole('button', { name: 'More Options' }).click()
    await menu.getByRole('menuitem', { name: 'Download Video' }).click()
    await expect(page.getByRole('dialog', { name: 'Older VOD' })).toBeVisible()
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

  test('keeps the newer RSSHub instance when a closed dialog finishes loading', async ({ page }) => {
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    await page.route('https://raw.githubusercontent.com/RSSNext/rsshub-docs/**', route => route.fulfill({ body: '' }))
    let release
    const held = new Promise(resolve => { release = resolve })
    let slowDelivered = false
    await page.route('https://slow.example.test/api/namespace', async route => {
      await held
      await route.fulfill({ json: RSSHUB_NAMESPACES })
      slowDelivered = true
    })
    await page.route('https://rss.example.test/api/namespace', route => route.fulfill({ json: RSSHUB_NAMESPACES }))
    const savedInstance = () => page.evaluate(() => window.$store.getters.getRssHubInstance)

    const manager = await openFeedManager(page)
    const browse = manager.getByRole('button', { name: 'Browse RSSHub' })
    const dialog = page.getByRole('dialog', { name: 'Add a feed from RSSHub' })
    const instance = dialog.getByRole('textbox', { name: 'RSSHub instance' })
    await browse.click()
    await instance.fill('slow.example.test')
    await instance.press('Enter')
    const service = dialog.getByRole('textbox', { name: 'Service' })
    await expect(service).toHaveAttribute('placeholder', 'Loading services…')
    // Clearing the instance stops waiting for its services
    await instance.fill('')
    await instance.press('Enter')
    await expect(service).toHaveAttribute('placeholder', 'Search services')
    await instance.fill('slow.example.test')
    await instance.press('Enter')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toHaveCount(0)

    await browse.click()
    await instance.fill('rss.example.test')
    await instance.press('Enter')
    await expect(service).toBeEnabled()
    await expect.poll(savedInstance).toBe('https://rss.example.test')

    release()
    await expect.poll(() => slowDelivered).toBe(true)
    // Give the late response time to be read and parsed before checking that it changed nothing
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
    expect(await savedInstance()).toBe('https://rss.example.test')
  })

  test('keeps the RSSHub dialog scrolled within its content when it shrinks', { tag: '@scale' }, async ({ app, page }) => {
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    await page.route('https://raw.githubusercontent.com/RSSNext/rsshub-docs/**', route => route.fulfill({ body: '' }))
    const parameters = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map(name => [name, `Parameter ${name}`]))
    const namespaces = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`service${index}`, {
      name: `Service ${String(index).padStart(2, '0')}`,
      routes: { '/many/:a/:b?/:c?/:d?/:e?/:f?': { name: 'Many fields', parameters } }
    }]))
    await page.route('https://rss.example.test/api/namespace', route => route.fulfill({ json: namespaces }))
    await setWindowSize(app, page, { width: 900, height: 560 })

    const manager = await openFeedManager(page)
    await manager.getByRole('button', { name: 'Browse RSSHub' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add a feed from RSSHub' })
    const instance = dialog.getByRole('textbox', { name: 'RSSHub instance' })
    await instance.fill('rss.example.test')
    await instance.press('Enter')
    const service = dialog.getByRole('textbox', { name: 'Service' })
    await expect(service).toBeEnabled()

    // Filtering the scrolled suggestions
    await service.click()
    const list = dialog.locator('.serviceInput .list')
    const listScrollbar = list.locator(':scope > .os-scrollbar-vertical')
    await expect(list.locator('li')).toHaveCount(30)
    await expect(listScrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    await list.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await service.fill('Service 29')
    await expect(list.locator('li')).toHaveCount(1)
    await expectScrollAtRenderedEnd(list)
    await expect(listScrollbar).toHaveClass(/os-scrollbar-unusable/)

    // Removing the route fields of the scrolled dialog
    await list.locator('li').click()
    const content = page.locator('.promptContentScroller')
    const contentScrollbar = content.locator(':scope > .os-scrollbar-vertical')
    await expect(dialog.getByRole('textbox', { name: 'f (optional)' })).toHaveCount(1)
    await expect(contentScrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    await content.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    // Editing the service name without scrolling to the field starts a new search
    await service.evaluate(element => element.focus({ preventScroll: true }))
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('none')
    await expect(dialog.getByRole('textbox', { name: 'f (optional)' })).toHaveCount(0)
    await expectScrollAtRenderedEnd(content)
    await expect(contentScrollbar).toHaveClass(/os-scrollbar-unusable/)

    // Enlarging the window
    await service.fill('Service 29')
    await list.locator('li').click()
    await expect(contentScrollbar).not.toHaveClass(/os-scrollbar-unusable/)
    await content.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect.poll(() => content.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    const before = await content.evaluate(element => element.scrollTop)
    await setWindowSize(app, page, { width: 1000, height: 1100 })
    await expectScrollAtRenderedEnd(content)
    expect(await content.evaluate(element => element.scrollTop)).toBeLessThan(before)
    // Larger UI scales can still overflow, so the scrollbar follows the new range
    await expect.poll(() => content.evaluate(element => (element.scrollHeight - element.clientHeight < 1) ===
      element.querySelector(':scope > .os-scrollbar-vertical').classList.contains('os-scrollbar-unusable'))).toBe(true)
  })

  test('explains that a site asks for a browser check', async ({ page }) => {
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    // Cloudflare answers clients it wants to verify with a challenge page
    await page.route('https://protected.example.test/feed.xml', route => route.fulfill({
      status: 403,
      headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html; charset=UTF-8' },
      body: '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt = {}</script></body></html>'
    }))
    const manager = await openFeedManager(page)
    const input = manager.getByRole('textbox', { name: 'Add Feed' })
    await input.fill('https://protected.example.test/feed.xml')
    await input.press('Enter')
    await expect(page.getByText('This site requires a browser check', { exact: false })).toBeVisible()
    await expect(page.getByText('The feed could not be loaded.', { exact: false })).toHaveCount(0)
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

test.describe('with subscription groups', () => {
  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        enableRssFeeds: true,
        followedRssFeeds: [RSS_FEED],
        subscriptionGroups: [{ id: 'music', name: 'Music', channelIds: [] }]
      }
    }
  })

  test('hides the groups, which only filter channels, on the RSS tab', async ({ page }) => {
    await mockFeeds(page)
    await goTo(page, 'subscriptions')
    const groups = page.getByRole('tablist', { name: 'Groups' })
    await expect(groups).toBeVisible()
    await page.locator('[data-rss-feeds-tab]').click()
    await expect(page.locator('#subscriptionsPanel .ft-list-item')).toHaveCount(2)
    await expect(groups).toHaveCount(0)
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
