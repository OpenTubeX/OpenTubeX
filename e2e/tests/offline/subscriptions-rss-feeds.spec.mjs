import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

import {
  test,
  expect,
  goTo,
  goToSettingsSection,
  abortUnmockedRequest,
  expectScrollAtRenderedEnd,
  openNewWindowFromTabBar,
  setWindowSize,
  waitForAppReady
} from '../../helpers/app.mjs'
import { encryptSyncDocument, decryptSyncDocument } from '../../../src/renderer/helpers/sync-server-privacy.js'
import { SYNC_KEY, SYNC_SALT, mockSyncServer, syncWithSyncServer } from '../../helpers/sync-history.mjs'
import { externalHistoryEntry, saveExternalHistoryEntry } from '../../helpers/external-media-history.mjs'

const THUMBNAIL_PATH = fileURLToPath(new URL('../../fixtures/images/opentubex-playlist.jpg', import.meta.url))

const now = Date.now()

/** A history entry another device synced after watching the media to its end */
function watchedRemotely(url, watchedAt) {
  return {
    video: { id: url, title: url, upload_date: 0, uploader: { id: 'opentubex:unknown-uploader', name: '', avatar: null, verified: false }, thumbnail_url: '', duration: 0 },
    metadata: { added_date: watchedAt, watched_state: 'completed', position_millis: 0 },
  }
}
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
    let release
    const held = new Promise(resolve => { release = resolve })
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
        return held.then(() => route.fulfill({ contentType: 'application/rss+xml', body: rssFeed.replace("Streamer's Twitch videos", "Other's Twitch videos") }))
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

    // The dialog closes without waiting for the feed, which loads from the feed URL box
    await expect(dialog).toHaveCount(0)
    const input = manager.getByRole('textbox', { name: 'Add Feed' })
    await expect(input).toHaveValue(otherUrl)
    await expect(input).toBeDisabled()
    await expect(manager.getByRole('progressbar', { name: 'Add Feed' })).toBeVisible()
    await expect(manager.getByRole('button', { name: 'Browse RSSHub' })).toBeDisabled()

    release()
    await expect(manager.locator('.feedRow').last()).toContainText("Other's Twitch videos")
    await expect(input).toHaveValue('')
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

  test('dismisses the refresh error banner until the failed feeds change', async ({ page }) => {
    await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    // The status region stays mounted so that screen readers announce the banner
    const status = panel.getByRole('status').filter({ has: page.locator('.errorBanner') })
    const banner = status.locator('.errorBanner')
    await expect(banner).toHaveText('1 feed could not be refreshed.')

    // A refresh hides the banner, so it takes the focus off its button
    let releaseShortcutRefresh
    const shortcutRefreshHeld = new Promise(resolve => { releaseShortcutRefresh = resolve })
    await page.route(RSS_URL, async route => {
      await shortcutRefreshHeld
      await route.fallback()
    })
    await banner.getByRole('button', { name: 'Close' }).focus()
    await page.keyboard.press('r')
    await expect(banner).toHaveCount(0)
    await expect(panel).toBeFocused()
    releaseShortcutRefresh()
    await expect(banner).toHaveText('1 feed could not be refreshed.')
    await page.unroute(RSS_URL)

    await banner.getByRole('button', { name: 'Close' }).click()
    await expect(banner).toHaveCount(0)
    await expect(panel).toBeFocused()
    await expect(panel.locator('.errorStatus')).toBeEmpty()

    // Leaving the page keeps the banner dismissed
    await goTo(page, 'history')
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    await expect(panel.locator('.ft-list-item .h3Title')).toHaveText(['Newest VOD', 'Older VOD'])
    await expect(banner).toHaveCount(0)

    // The same feed failing again keeps the banner dismissed
    let release
    const held = new Promise(resolve => { release = resolve })
    await page.route(RSS_URL, async route => {
      await held
      await route.fulfill({ contentType: 'application/rss+xml', body: rssFeed })
    })
    const header = page.locator('.subscriptionsHeader')
    const refreshing = page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')
    await header.getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(refreshing).toBeVisible()
    release()
    await expect(refreshing).toHaveCount(0)
    await expect(panel.locator('.ft-list-item .h3Title')).toHaveText(['Newest VOD', 'Older VOD'])
    await expect(banner).toHaveCount(0)

    await page.unroute(RSS_URL)
    await page.route(RSS_URL, route => route.fulfill({ status: 500, body: 'Server error' }))
    await header.getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(banner).toHaveText('2 feeds could not be refreshed.')

    // The earlier dismissal no longer applies once the failures changed
    await page.unroute(RSS_URL)
    await header.getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(banner).toHaveText('1 feed could not be refreshed.')
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

  test('cancels a running refresh and keeps the previous items', async ({ page }) => {
    await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    const titles = panel.locator('.ft-list-item .h3Title')
    await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])
    await expect(panel.getByText('1 feed could not be refreshed.')).toBeVisible()

    // The feed never answers, so only cancelling ends the refresh
    let aborted = 0
    page.on('requestfailed', (request) => {
      if (request.url() === RSS_URL) aborted++
    })
    await page.route(RSS_URL, () => {})
    const header = page.locator('.subscriptionsHeader')
    const loading = page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')
    await header.getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(loading).toBeVisible()
    await header.getByRole('button', { name: 'Cancel Refresh' }).click()
    await expect(loading).toHaveCount(0)
    await expect.poll(() => aborted).toBe(1)
    await expect(header.getByRole('button', { name: /^Refresh RSS/ })).toHaveAttribute('aria-disabled', 'false')
    expect(await titles.allTextContents()).toEqual(['Newest VOD', 'Older VOD'])
    await expect(panel.getByText('1 feed could not be refreshed.')).toBeVisible()

    // The New feed refreshes only the RSS feeds without subscriptions, and cancels them too
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await header.getByRole('button', { name: /^Refresh / }).click()
    await expect(loading).toBeVisible()
    await header.getByRole('button', { name: 'Cancel Refresh' }).click()
    await expect(loading).toHaveCount(0)
    await expect.poll(() => aborted).toBe(2)

    // Holding the New tab on phones cancels it too
    await header.getByRole('button', { name: /^Refresh / }).click()
    await expect(loading).toBeVisible()
    await page.locator('[data-subscription-feed-tab="all"]').evaluate(element => element.dispatchEvent(new PointerEvent('contextmenu', {
      bubbles: true, cancelable: true, pointerType: 'touch'
    })))
    await page.locator('.mobileLinkActions').getByRole('menuitem', { name: 'Cancel Refresh' }).click()
    await expect(loading).toHaveCount(0)
    await expect.poll(() => aborted).toBe(3)

    // The tab renders its items after switching
    await page.locator('[data-rss-feeds-tab]').click()
    await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])
    await expect(panel.getByText('1 feed could not be refreshed.')).toBeVisible()
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

  test('loads only the feeds that never loaded after a restart', async ({ page }) => {
    const state = await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    const titles = panel.locator('.ft-list-item .h3Title')
    await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])
    await expect(panel.getByText('1 feed could not be refreshed.')).toBeVisible()

    let requested = false
    await page.route(RSS_URL, (route) => {
      requested = true
      return route.fulfill({ contentType: 'application/rss+xml', body: rssFeed })
    })
    await page.reload()
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    await expect(panel.getByText('1 feed could not be refreshed.')).toBeVisible()
    await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])
    expect(requested).toBe(false)

    // Once the feed loads, it shows its cached items after a restart too
    state.brokenFeedWorks = true
    await page.reload()
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    await expect(titles).toHaveText(['Newest VOD', 'Repaired item', 'Older VOD'])
    state.brokenFeedWorks = false
    await page.reload()
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    await expect(titles).toHaveText(['Newest VOD', 'Repaired item', 'Older VOD'])
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toHaveCount(0)
    await expect(panel.getByText(/could not be refreshed/)).toHaveCount(0)
    expect(requested).toBe(false)
  })

  test.describe('with fetching on startup enabled', () => {
    test.use({
      seed: {
        settings: {
          fetchSubscriptionsAutomatically: true,
          enableRssFeeds: true,
          followedRssFeeds: [RSS_FEED, BROKEN_FEED]
        }
      }
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
      // The list shows the feed before it is saved, and the input clears once it is
      await expect(input).toHaveValue('')

      await page.route(ATOM_URL, route => route.fulfill({ status: 500, body: 'Server error' }))
      await page.reload()
      await goTo(page, 'subscriptions')
      await page.locator('[data-rss-feeds-tab]').click()
      const panel = page.locator('#subscriptionsPanel')
      await expect(panel.getByText('2 feeds could not be refreshed.')).toBeVisible()
      await expect(panel.locator('.ft-list-item .h3Title', { hasText: 'Atom video' })).toBeVisible()
    })
  })

  test('shows the progress of watched items', async ({ page }) => {
    await mockFeeds(page)
    await saveExternalHistoryEntry(page, 'https://www.twitch.tv/videos/3', { isWatched: true })
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const items = page.locator('#subscriptionsPanel .ft-list-item')
    await expect(items).toHaveCount(2)
    await expect(items.first()).toHaveClass(/watched/)
    await expect(items.first().locator('.videoWatched')).toHaveText('Watched')
    await expect(items.first().locator('.watchedProgressBar')).toBeVisible()
    await expect(items.nth(1)).not.toHaveClass(/watched/)
    await expect(items.nth(1).locator('.watchedProgressBar')).toHaveCount(0)

    // Playback saves a position
    await saveExternalHistoryEntry(page, 'https://www.twitch.tv/videos/1', { watchProgress: 30, lengthSeconds: 120 })
    await expect(items.nth(1).locator('.watchedProgressBar')).toBeVisible()
    await expect(items.nth(1)).not.toHaveClass(/watched/)
  })

  test('marks items as watched, copies their link, and downloads them from the context menu', async ({ app, page }) => {
    const newestUrl = 'https://www.twitch.tv/videos/3'
    const olderUrl = 'https://www.twitch.tv/videos/1'
    await mockFeeds(page)
    await saveExternalHistoryEntry(page, olderUrl, { watchProgress: 30, lengthSeconds: 120 })
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const items = page.locator('#subscriptionsPanel .ft-list-item')
    const [newest, older] = [items.first(), items.nth(1)]
    await expect(items).toHaveCount(2)
    const menu = page.locator('.contextMenu')
    const position = async url => {
      const entry = await externalHistoryEntry(page, url)
      return entry && { watchProgress: entry.watchProgress, lengthSeconds: entry.lengthSeconds, isWatched: entry.isWatched }
    }
    const openMenu = item => item.locator('.title').click({ button: 'right' })

    // Without a saved position, marking it as watched already starts it over next time
    await openMenu(newest)
    await expect(menu.getByRole('menuitem', { name: 'Mark As Fully Watched' })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Mark As Watched' }).click()
    await expect(newest).toHaveClass(/watched/)
    await expect(newest.locator('.videoWatched')).toHaveText('Watched')
    expect(await position(newestUrl)).toEqual({ watchProgress: 0, lengthSeconds: 0, isWatched: true })

    await openMenu(newest)
    await menu.getByRole('menuitem', { name: 'Unmark As Watched' }).click()
    await expect(newest).not.toHaveClass(/watched/)
    expect(await position(newestUrl)).toEqual({ watchProgress: 0, lengthSeconds: 0, isWatched: false })

    // Marking it as watched keeps where it resumes, marking it as fully watched starts it over
    await openMenu(older)
    await menu.getByRole('menuitem', { name: 'Mark As Watched' }).click()
    await expect(older).toHaveClass(/watched/)
    expect(await position(olderUrl)).toEqual({ watchProgress: 30, lengthSeconds: 120, isWatched: true })
    await openMenu(older)
    await menu.getByRole('menuitem', { name: 'Mark As Fully Watched' }).click()
    await expect.poll(() => position(olderUrl)).toEqual({ watchProgress: 120, lengthSeconds: 120, isWatched: true })
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

test.describe('with a followed feed', () => {
  test.use({
    seed: {
      settings: { fetchSubscriptionsAutomatically: false, enableRssFeeds: true, followedRssFeeds: [RSS_FEED] }
    }
  })

  test('shows and cancels a refresh running in another window', async ({ app, page }) => {
    await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    await expect(page.locator('#subscriptionsPanel .ft-list-item .h3Title')).toHaveText(['Newest VOD', 'Older VOD'])

    // The feed never answers, so only cancelling ends the refresh
    let aborted = 0
    page.on('requestfailed', (request) => {
      if (request.url() === RSS_URL) aborted++
    })
    await page.route(RSS_URL, () => {})
    await page.locator('.subscriptionsHeader').getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toBeVisible()

    const other = await openNewWindowFromTabBar(app, page)
    await waitForAppReady(other)
    // The other window shows the cached items and doesn't refresh them itself
    const otherRequests = []
    await mockFeeds(other)
    other.on('request', (request) => {
      if (request.url() === RSS_URL) otherRequests.push(request.url())
    })
    await goTo(other, 'subscriptions')
    await other.locator('[data-rss-feeds-tab]').click()
    await expect(other.locator('#subscriptionsPanel .ft-list-item .h3Title')).toHaveText(['Newest VOD', 'Older VOD'])
    const otherLoading = other.locator('[data-rss-feeds-tab] .tabLoadingIndicator')
    await expect(otherLoading).toBeVisible()

    await other.locator('.subscriptionsHeader').getByRole('button', { name: 'Cancel Refresh' }).click()
    await expect.poll(() => aborted).toBe(1)
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toHaveCount(0)
    await expect(otherLoading).toHaveCount(0)
    await expect(other.locator('.subscriptionsHeader').getByRole('button', { name: /^Refresh RSS/ }))
      .toHaveAttribute('aria-disabled', 'false')

    // The refresh ends for the other window when its window closes
    await page.locator('.subscriptionsHeader').getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(otherLoading).toBeVisible()
    await page.close()
    app.page = other
    await expect(otherLoading).toHaveCount(0)
    expect(otherRequests).toEqual([])
  })
})

test.describe('with new items', () => {
  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        enableRssFeeds: true,
        followedRssFeeds: [RSS_FEED],
        showNewSubscriptionFeedIndicators: true
      }
    }
  })

  // Two items that the first load didn't have
  const updatedRssFeed = rssFeed.replace('<item>', `<item>
      <title>Brand new VOD</title>
      <link>https://www.twitch.tv/videos/4</link>
      <pubDate>${new Date(now - 60000).toUTCString()}</pubDate>
      <guid isPermaLink="false">vod-4</guid>
    </item>
    <item>
      <title>Second new VOD</title>
      <link>https://www.twitch.tv/videos/5</link>
      <pubDate>${new Date(now - 120000).toUTCString()}</pubDate>
      <guid isPermaLink="false">vod-5</guid>
    </item>
    <item>`)

  /**
   * @param {import('@playwright/test').Page} page
   */
  async function loadNewItems(page) {
    await mockFeeds(page)
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    await expect(panel.locator('.ft-list-item .h3Title')).toHaveText(['Newest VOD', 'Older VOD'])
    // The first load of a feed has nothing to compare to
    await expect(panel.locator('.newContentDot')).toHaveCount(0)

    await page.route(RSS_URL, route => route.fulfill({ contentType: 'application/rss+xml', body: updatedRssFeed }))
    await page.locator('.subscriptionsHeader').getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(panel.locator('.ft-list-item .h3Title'))
      .toHaveText(['Brand new VOD', 'Second new VOD', 'Newest VOD', 'Older VOD'])
  }

  test('marks items from later refreshes as new until they are seen', async ({ page }) => {
    await loadNewItems(page)
    const panel = page.locator('#subscriptionsPanel')
    const newItems = panel.locator('.ft-list-item').filter({ has: page.locator('.newContentDot') })
    await expect(newItems.locator('.h3Title')).toHaveText(['Brand new VOD', 'Second new VOD'])

    // The context menu marks a single item as seen
    await newItems.nth(1).locator('.title').click({ button: 'right' })
    await page.locator('.contextMenu').getByRole('menuitem', { name: 'Mark As Seen' }).click()
    await expect(newItems.locator('.h3Title')).toHaveText(['Brand new VOD'])

    // Another refresh keeps both the new and the seen state
    await page.locator('.subscriptionsHeader').getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toHaveCount(0)
    await expect(newItems.locator('.h3Title')).toHaveText(['Brand new VOD'])

    // So does a restart
    await page.reload()
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    await expect(newItems.locator('.h3Title')).toHaveText(['Brand new VOD'])

    await page.getByRole('button', { name: 'Mark all as seen' }).click()
    await expect(newItems).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark all as seen' })).toHaveCount(0)
    await expect(panel.locator('.ft-list-item')).toHaveCount(4)
  })

  test('marks an item as seen when it is opened', async ({ page }) => {
    await loadNewItems(page)
    const panel = page.locator('#subscriptionsPanel')
    await panel.locator('.ft-list-item .h3Title', { hasText: 'Brand new VOD' }).click()
    await expect.poll(() => page.evaluate(() => window.$router.currentRoute.value.path)).toBe('/external-media')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rssFeedItems'))
      .filter(item => item.isNew).map(item => item.title))).toEqual(['Second new VOD'])
  })

  test('marks the first item of a feed that was empty as new', async ({ page }) => {
    await mockFeeds(page)
    // A live stream feed only has an item while the stream is live
    const emptyFeed = rssFeed.replace(/<item>[\s\S]*<\/item>/, '')
    await page.route(RSS_URL, route => route.fulfill({ contentType: 'application/rss+xml', body: emptyFeed }))
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    await expect(panel.getByText('Your feeds currently do not have any items.')).toBeVisible()

    await page.route(RSS_URL, route => route.fulfill({ contentType: 'application/rss+xml', body: rssFeed }))
    await page.locator('.subscriptionsHeader').getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(panel.locator('.ft-list-item .h3Title')).toHaveText(['Newest VOD', 'Older VOD'])
    await expect(panel.locator('.newContentDot')).toHaveCount(2)
  })

  test('lists new items in the New feed', async ({ page }) => {
    await loadNewItems(page)
    const panel = page.locator('#subscriptionsPanel')
    await page.locator('[data-subscription-feed-tab="all"]').click()

    // The combined view has a section for them
    const section = panel.locator('section', { has: page.getByRole('heading', { name: 'RSS' }) })
    await expect(section.locator('.ft-list-item .h3Title')).toHaveText(['Brand new VOD', 'Second new VOD'])
    // Everything in the New feed is new, so the items don't need dots
    await expect(section.locator('.newContentDot')).toHaveCount(0)

    // Its refresh also refreshes the RSS feeds, and waits for them
    let release
    const held = new Promise(resolve => { release = resolve })
    let rssRequests = 0
    await page.route(RSS_URL, async (route) => {
      rssRequests++
      await held
      await route.fulfill({ contentType: 'application/rss+xml', body: updatedRssFeed })
    })
    const header = page.locator('.subscriptionsHeader')
    const refresh = header.getByRole('button', { name: /^Refresh / })
    await refresh.click()
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toBeVisible()
    await expect(header.getByRole('button', { name: 'Cancel Refresh' })).toBeVisible()
    release()
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toHaveCount(0)
    await expect(refresh).toHaveAttribute('aria-disabled', 'false')

    // As does the tabbed view, from any of its tabs
    await header.getByRole('button', { name: 'Show Tabbed View' }).click()
    await page.locator('[data-new-feed-tab="videos"]').click()
    await refresh.click()
    await expect.poll(() => rssRequests).toBe(2)
    await expect(refresh).toHaveAttribute('aria-disabled', 'false')

    // And reloading all feeds from another tab
    await page.locator('[data-subscription-feed-tab="videos"]').click()
    await page.locator('[data-subscription-feed-tab="all"]').click({ button: 'right' })
    await page.getByRole('menu', { name: 'Context menu' }).getByRole('menuitem', { name: 'Reload All Feeds' }).click()
    await expect.poll(() => rssRequests).toBe(3)
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toHaveCount(0)
    await page.locator('[data-subscription-feed-tab="all"]').click()

    const rssTab = page.locator('[data-new-feed-rss-tab]')
    await expect(rssTab.locator('.newFeedTabDot')).toBeVisible()
    await rssTab.click()
    await expect(rssTab).toHaveAttribute('aria-selected', 'true')
    await expect(panel.locator('.ft-list-item .h3Title')).toHaveText(['Brand new VOD', 'Second new VOD'])

    // The sort order applies to them too
    await page.evaluate(() => window.$store.dispatch('updateNewSubscriptionFeedSortBy', 'oldest'))
    await expect(panel.locator('.ft-list-item .h3Title')).toHaveText(['Second new VOD', 'Brand new VOD'])

    await page.getByRole('button', { name: 'Mark all as seen' }).click()
    await expect(panel.getByText('There is no new content.')).toBeVisible()
    await expect(rssTab.locator('.newFeedTabDot')).toHaveCount(0)

    await page.locator('[data-rss-feeds-tab]').click()
    await expect(page.locator('#subscriptionsPanel .ft-list-item')).toHaveCount(4)
    await expect(page.locator('#subscriptionsPanel .newContentDot')).toHaveCount(0)
  })

  test('refreshes the feeds on their auto refresh interval', async ({ page }) => {
    await mockFeeds(page)
    await page.evaluate(() => window.$store.dispatch('updateRssFeedsAutoRefreshInterval', '1800000'))
    await goTo(page, 'subscriptions')
    await page.locator('[data-rss-feeds-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    await expect(panel.locator('.ft-list-item .h3Title')).toHaveText(['Newest VOD', 'Older VOD'])

    const header = page.locator('.subscriptionsHeader')
    const nextRefresh = () => page.evaluate(() => Number(localStorage.getItem('rssFeedsNextAutoRefresh')))
    const scheduled = await nextRefresh()
    expect(scheduled - Date.now()).toBeGreaterThan(29 * 60000)
    await expect(header.locator('.nextAutoRefreshTimestamp')).toBeVisible()
    await expect(header.locator('.nextAutoRefreshCountdown')).toBeVisible()

    // Another window reaches the deadline
    await page.route(RSS_URL, route => route.fulfill({ contentType: 'application/rss+xml', body: updatedRssFeed }))
    await page.evaluate(() => {
      localStorage.setItem('rssFeedsNextAutoRefresh', String(Date.now() - 1000))
      window.dispatchEvent(new StorageEvent('storage', { key: 'rssFeedsNextAutoRefresh' }))
    })
    await expect(panel.locator('.ft-list-item .h3Title'))
      .toHaveText(['Brand new VOD', 'Second new VOD', 'Newest VOD', 'Older VOD'])
    await expect.poll(nextRefresh).toBeGreaterThan(Date.now() + 29 * 60000)

    // Reaching the deadline during a refresh that ends without moving it, such
    // as a cancelled one, still schedules the next refresh
    await page.route(RSS_URL, () => {})
    await header.getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(header.getByRole('button', { name: 'Cancel Refresh' })).toBeVisible()
    await page.evaluate(() => {
      localStorage.setItem('rssFeedsNextAutoRefresh', String(Date.now() - 1000))
      window.dispatchEvent(new StorageEvent('storage', { key: 'rssFeedsNextAutoRefresh' }))
    })
    await expect.poll(nextRefresh).toBeGreaterThan(Date.now() + 29 * 60000)
    await header.getByRole('button', { name: 'Cancel Refresh' }).click()
    await expect(header.getByRole('button', { name: /^Refresh RSS/ })).toBeVisible()
    expect(await nextRefresh()).toBeGreaterThan(Date.now() + 29 * 60000)

    // Turning it off stops the refreshes
    await page.evaluate(() => window.$store.dispatch('updateRssFeedsAutoRefreshInterval', '0'))
    await expect.poll(nextRefresh).toBe(0)
  })

  test('marks items as unseen from the context menu', async ({ page }) => {
    await loadNewItems(page)
    const panel = page.locator('#subscriptionsPanel')
    const newItems = panel.locator('.ft-list-item').filter({ has: page.locator('.newContentDot') })
    const menu = page.locator('.contextMenu')
    const openMenu = title => panel.locator('.ft-list-item', { hasText: title }).locator('.title').click({ button: 'right' })

    // New items can only be marked as seen
    await openMenu('Brand new VOD')
    await expect(menu.getByRole('menuitem', { name: 'Mark As Seen' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Mark As Unseen' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await openMenu('Newest VOD')
    await expect(menu.getByRole('menuitem', { name: 'Mark As Seen' })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Mark As Unseen' }).click()
    await expect(newItems.locator('.h3Title')).toHaveText(['Brand new VOD', 'Second new VOD', 'Newest VOD'])

    // A watched item comes back to the New feed too
    await openMenu('Older VOD')
    await menu.getByRole('menuitem', { name: 'Mark As Watched' }).click()
    await expect(panel.locator('.ft-list-item', { hasText: 'Older VOD' })).toHaveClass(/watched/)
    await openMenu('Older VOD')
    await menu.getByRole('menuitem', { name: 'Mark As Unseen' }).click()
    await expect(panel.locator('.ft-list-item', { hasText: 'Older VOD' })).not.toHaveClass(/watched/)
    await expect(newItems.locator('.h3Title')).toHaveText(['Brand new VOD', 'Second new VOD', 'Newest VOD', 'Older VOD'])

    // The marks outlast refreshes and restarts
    await page.locator('.subscriptionsHeader').getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toHaveCount(0)
    await page.reload()
    await goTo(page, 'subscriptions')
    await page.locator('[data-subscription-feed-tab="all"]').click()
    const section = panel.locator('section', { has: page.getByRole('heading', { name: 'RSS' }) })
    await expect(section.locator('.ft-list-item .h3Title'))
      .toHaveText(['Brand new VOD', 'Second new VOD', 'Newest VOD', 'Older VOD'])
  })

  test('reloads the RSS feeds and marks them as seen from the context menus of their tabs', async ({ page }) => {
    await loadNewItems(page)
    let requests = 0
    page.on('request', (request) => {
      if (request.url() === RSS_URL) requests++
    })
    const rssTab = page.locator('[data-rss-feeds-tab]')
    const loading = rssTab.locator('.tabLoadingIndicator')
    await expect(loading).toHaveCount(0)
    const menu = page.getByRole('menu', { name: 'Context menu' })

    await rssTab.click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Mark All as Seen' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Reload RSS Feeds' }).click()
    await expect.poll(() => requests).toBe(1)
    await expect(loading).toHaveCount(0)

    // The RSS tab of the New feed has the same menu
    await page.locator('[data-subscription-feed-tab="all"]').click()
    await page.locator('.subscriptionsHeader').getByRole('button', { name: 'Show Tabbed View' }).click()
    const newFeedRssTab = page.locator('[data-new-feed-rss-tab]')
    await newFeedRssTab.click()
    const panel = page.locator('#subscriptionsPanel')
    await expect(panel.locator('.ft-list-item .h3Title')).toHaveText(['Brand new VOD', 'Second new VOD'])
    await newFeedRssTab.click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Reload RSS Feeds' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Mark All as Seen' }).click()
    await expect(panel.getByText('There is no new content.')).toBeVisible()
    await expect(newFeedRssTab.locator('.newFeedTabDot')).toHaveCount(0)

    await rssTab.click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Reload RSS Feeds' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Mark All as Seen' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Holding the tab opens the same actions on phones
    await rssTab.evaluate(element => element.dispatchEvent(new PointerEvent('contextmenu', {
      bubbles: true, cancelable: true, pointerType: 'touch'
    })))
    const mobileMenu = page.locator('.mobileLinkActions')
    await expect(mobileMenu.getByRole('menuitem', { name: 'Mark All as Seen' })).toHaveCount(0)
    await mobileMenu.getByRole('menuitem', { name: 'Reload RSS Feeds', exact: true }).click()
    await expect.poll(() => requests).toBe(2)
  })

  test('remembers items marked as seen that leave the feed before the next refresh', async ({ page }) => {
    await loadNewItems(page)
    const panel = page.locator('#subscriptionsPanel')
    const newItems = panel.locator('.ft-list-item').filter({ has: page.locator('.newContentDot') })
    await panel.locator('.ft-list-item').filter({ hasText: 'Second new VOD' }).locator('.title').click({ button: 'right' })
    await page.locator('.contextMenu').getByRole('menuitem', { name: 'Mark As Seen' }).click()
    await expect(newItems.locator('.h3Title')).toHaveText(['Brand new VOD'])

    const withoutItem = updatedRssFeed.replace(/<item>\s*<title>Second new VOD<\/title>[\s\S]*?<\/item>/, '')
    await page.route(RSS_URL, route => route.fulfill({ contentType: 'application/rss+xml', body: withoutItem }))
    const refresh = page.locator('.subscriptionsHeader').getByRole('button', { name: /^Refresh RSS/ })
    await refresh.click()
    await expect(panel.locator('.ft-list-item .h3Title')).toHaveText(['Brand new VOD', 'Newest VOD', 'Older VOD'])

    // Newer marks push old ones out of the bounded marks, the feed's history still knows it
    await page.evaluate(() => window.$store.commit('setRssFeedSeenItems', '[]'))
    await page.route(RSS_URL, route => route.fulfill({ contentType: 'application/rss+xml', body: updatedRssFeed }))
    await refresh.click()
    await expect(panel.locator('.ft-list-item .h3Title'))
      .toHaveText(['Brand new VOD', 'Second new VOD', 'Newest VOD', 'Older VOD'])
    await expect(newItems.locator('.h3Title')).toHaveText(['Brand new VOD'])
  })

  test('keeps the seen state of items that leave the feed and come back', async ({ page }) => {
    await loadNewItems(page)
    const panel = page.locator('#subscriptionsPanel')
    const newItems = panel.locator('.ft-list-item').filter({ has: page.locator('.newContentDot') })
    await expect(newItems.locator('.h3Title')).toHaveText(['Brand new VOD', 'Second new VOD'])

    // The feed drops an item that wasn't new and one that was
    const withoutItems = updatedRssFeed.replace(/<item>\s*<title>(?:Older VOD|Second new VOD)<\/title>[\s\S]*?<\/item>/g, '')
    await page.route(RSS_URL, route => route.fulfill({ contentType: 'application/rss+xml', body: withoutItems }))
    const refresh = page.locator('.subscriptionsHeader').getByRole('button', { name: /^Refresh RSS/ })
    await refresh.click()
    await expect(panel.locator('.ft-list-item .h3Title')).toHaveText(['Brand new VOD', 'Newest VOD'])

    // When they come back, each keeps its state
    await page.route(RSS_URL, route => route.fulfill({ contentType: 'application/rss+xml', body: updatedRssFeed }))
    await refresh.click()
    await expect(panel.locator('.ft-list-item .h3Title'))
      .toHaveText(['Brand new VOD', 'Second new VOD', 'Newest VOD', 'Older VOD'])
    await expect(newItems.locator('.h3Title')).toHaveText(['Brand new VOD', 'Second new VOD'])
  })

  test('brings back unseen items that another device watched earlier', async ({ page }) => {
    await loadNewItems(page)
    const panel = page.locator('#subscriptionsPanel')
    const menu = page.locator('.contextMenu')
    const item = title => panel.locator('.ft-list-item', { hasText: title })

    // Watched here, then marked as unseen on another device
    await item('Newest VOD').locator('.title').click({ button: 'right' })
    await menu.getByRole('menuitem', { name: 'Mark As Watched' }).click()
    await expect(item('Newest VOD')).toHaveClass(/watched/)
    const watchedAt = (await externalHistoryEntry(page, 'https://www.twitch.tv/videos/3')).timeWatched
    // Watched on another device, then marked as unseen here
    await item('Older VOD').locator('.title').click({ button: 'right' })
    await menu.getByRole('menuitem', { name: 'Mark As Unseen' }).click()

    const remote = {
      history: await encryptSyncDocument([watchedRemotely('https://www.twitch.tv/videos/1', now - 60000)], SYNC_KEY, SYNC_SALT),
      seenRssItems: await encryptSyncDocument([{ key: `${RSS_URL}\nvod-3`, unseenAt: watchedAt + 1000 }], SYNC_KEY, SYNC_SALT),
    }
    await mockSyncServer(page, remote)
    expect(await syncWithSyncServer(page)).toEqual(['success', ''])

    // The later unseen marks win over the earlier watches
    await expect(item('Newest VOD')).not.toHaveClass(/watched/)
    await expect(item('Older VOD')).not.toHaveClass(/watched/)
    await page.locator('[data-subscription-feed-tab="all"]').click()
    const section = panel.locator('section', { has: page.getByRole('heading', { name: 'RSS' }) })
    await expect(section.locator('.ft-list-item .h3Title'))
      .toHaveText(['Brand new VOD', 'Second new VOD', 'Newest VOD', 'Older VOD'])
  })

  test('brings back new items that another device watched', async ({ page }) => {
    await loadNewItems(page)
    const panel = page.locator('#subscriptionsPanel')
    const menu = page.locator('.contextMenu')
    const item = panel.locator('.ft-list-item', { hasText: 'Brand new VOD' })

    const remote = {
      history: await encryptSyncDocument([watchedRemotely('https://www.twitch.tv/videos/4', Date.now())], SYNC_KEY, SYNC_SALT),
      seenRssItems: await encryptSyncDocument([], SYNC_KEY, SYNC_SALT),
    }
    await mockSyncServer(page, remote)
    expect(await syncWithSyncServer(page)).toEqual(['success', ''])

    // The New feed leaves it out, so it can't be marked as seen, only brought back
    await expect(item).toHaveClass(/watched/)
    await expect(item.locator('.newContentDot')).toHaveCount(0)
    await item.locator('.title').click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Mark As Seen' })).toHaveCount(0)
    await page.evaluate(() => {
      window.scheduledSyncs = []
      window.$store.subscribeAction(action => {
        if (action.type === 'scheduleSyncServer') window.scheduledSyncs.push(action.payload)
      })
    })
    await menu.getByRole('menuitem', { name: 'Mark As Unseen' }).click()
    await expect(item).not.toHaveClass(/watched/)
    await expect(item.locator('.newContentDot')).toHaveCount(1)
    // Other devices learn that it is no longer watched, and the fresh unseen
    // mark wins over older seen marks they haven't synced yet
    await expect.poll(() => page.evaluate(() => window.scheduledSyncs)).toContain('history')
    expect(await page.evaluate(key => JSON.parse(window.$store.getters.getRssFeedSeenItems)
      .find(entry => entry.key === key), `${RSS_URL}\nvod-4`)).toEqual({ key: `${RSS_URL}\nvod-4`, unseenAt: expect.any(Number) })
  })

  test('opens items in a new tab or window from the context menu and marks them as seen', async ({ app, page }) => {
    await loadNewItems(page)
    const panel = page.locator('#subscriptionsPanel')
    const menu = page.locator('.contextMenu')
    const item = title => panel.locator('.ft-list-item', { hasText: title })
    const tabState = () => page.evaluate(() => window.ftElectron.tabs.getState())
    const newTitles = () => page.evaluate(() => JSON.parse(localStorage.getItem('rssFeedItems'))
      .filter(item => item.isNew).map(item => item.title))
    const { tabs: initialTabs, activeTabId } = await tabState()

    await item('Brand new VOD').locator('.title').click({ button: 'right' })
    await menu.getByRole('menuitem', { name: 'Open in a New Tab', exact: true }).click()
    await expect.poll(async () => (await tabState()).tabs.length).toBe(initialTabs.length + 1)
    await expect(page).toHaveURL(/#\/external-media\?url=https:\/\/www\.twitch\.tv\/videos\/4$/)
    expect(await newTitles()).toEqual(['Second new VOD'])

    await page.evaluate(tabId => window.ftElectron.tabs.activate(tabId), activeTabId)
    await expect(page).toHaveURL(/#\/subscriptions$/)
    await item('Second new VOD').locator('.title').click({ button: 'right' })
    const [newWindow] = await Promise.all([
      app.electronApp.waitForEvent('window'),
      menu.getByRole('menuitem', { name: 'Open in a New Window', exact: true }).click()
    ])
    await waitForAppReady(newWindow)
    await expect(newWindow).toHaveURL(/#\/external-media\?url=https:\/\/www\.twitch\.tv\/videos\/5$/)
    expect(await newTitles()).toEqual([])
  })

  test('brings back unseen items that another device watched earlier while they were out of their feed', async ({ page }) => {
    await loadNewItems(page)
    const panel = page.locator('#subscriptionsPanel')
    const titles = panel.locator('.ft-list-item .h3Title')
    const item = panel.locator('.ft-list-item', { hasText: 'Older VOD' })
    await item.locator('.title').click({ button: 'right' })
    await page.locator('.contextMenu').getByRole('menuitem', { name: 'Mark As Watched' }).click()
    await expect(item).toHaveClass(/watched/)
    const watchedAt = (await externalHistoryEntry(page, 'https://www.twitch.tv/videos/1')).timeWatched

    // The item leaves its feed before a later unseen mark from another device syncs
    const withoutItem = updatedRssFeed.replace(/<item>\s*<title>Older VOD<\/title>[\s\S]*?<\/item>/, '')
    await page.route(RSS_URL, route => route.fulfill({ contentType: 'application/rss+xml', body: withoutItem }))
    const refresh = page.locator('.subscriptionsHeader').getByRole('button', { name: /^Refresh RSS/ })
    await refresh.click()
    await expect(titles).toHaveText(['Brand new VOD', 'Second new VOD', 'Newest VOD'])
    await mockSyncServer(page, {
      history: await encryptSyncDocument([], SYNC_KEY, SYNC_SALT),
      seenRssItems: await encryptSyncDocument([{ key: `${RSS_URL}\nvod-1`, unseenAt: watchedAt + 1000 }], SYNC_KEY, SYNC_SALT)
    })
    expect(await syncWithSyncServer(page)).toEqual(['success', ''])

    // When it comes back, the later unseen mark wins over the earlier watch
    await page.route(RSS_URL, route => route.fulfill({ contentType: 'application/rss+xml', body: updatedRssFeed }))
    await refresh.click()
    await expect(titles).toHaveText(['Brand new VOD', 'Second new VOD', 'Newest VOD', 'Older VOD'])
    await expect(item).not.toHaveClass(/watched/)
    await expect(item.locator('.newContentDot')).toBeVisible()
  })

  test('syncs the seen items with history', async ({ page }) => {
    const remote = {
      history: await encryptSyncDocument([], SYNC_KEY, SYNC_SALT),
      seenRssItems: await encryptSyncDocument([
        { key: `${RSS_URL}\nvod-4`, seenAt: now },
        // Seen on another device before it loads here
        { key: `${RSS_URL}\nvod-6`, seenAt: now }
      ], SYNC_KEY, SYNC_SALT)
    }
    await loadNewItems(page)
    await mockSyncServer(page, remote)

    const panel = page.locator('#subscriptionsPanel')
    const newItems = panel.locator('.ft-list-item').filter({ has: page.locator('.newContentDot') })
    await expect(newItems.locator('.h3Title')).toHaveText(['Brand new VOD', 'Second new VOD'])

    expect(await syncWithSyncServer(page)).toEqual(['success', ''])
    await expect(newItems.locator('.h3Title')).toHaveText(['Second new VOD'])

    // An item that another device saw before it loaded here doesn't become new
    await page.route(RSS_URL, route => route.fulfill({
      contentType: 'application/rss+xml',
      body: updatedRssFeed.replace('<item>', `<item>
      <title>Seen elsewhere VOD</title>
      <link>https://www.twitch.tv/videos/6</link>
      <pubDate>${new Date(now - 30000).toUTCString()}</pubDate>
      <guid isPermaLink="false">vod-6</guid>
    </item>
    <item>`)
    }))
    await page.locator('.subscriptionsHeader').getByRole('button', { name: /^Refresh RSS/ }).click()
    await expect(panel.locator('.ft-list-item .h3Title', { hasText: 'Seen elsewhere VOD' })).toBeVisible()
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toHaveCount(0)
    await expect(newItems.locator('.h3Title')).toHaveText(['Second new VOD'])

    // Items seen here upload with the next sync
    await newItems.locator('.title').click({ button: 'right' })
    await page.locator('.contextMenu').getByRole('menuitem', { name: 'Mark As Seen' }).click()
    await expect(newItems).toHaveCount(0)
    await page.evaluate(() => window.$store.dispatch('syncWithSyncServer'))
    expect((await decryptSyncDocument(remote.seenRssItems, SYNC_KEY)).map(entry => entry.key)).toEqual([
      `${RSS_URL}\nvod-4`,
      `${RSS_URL}\nvod-5`,
      `${RSS_URL}\nvod-6`
    ])
  })
})

for (const fetchOnStartup of [false, true]) {
  test.describe(`after a restart with fetching on startup ${fetchOnStartup ? 'enabled' : 'disabled'}`, () => {
    test.use({
      seed: {
        settings: {
          fetchSubscriptionsAutomatically: fetchOnStartup,
          enableRssFeeds: true,
          followedRssFeeds: [RSS_FEED]
        }
      }
    })

    test(`${fetchOnStartup ? 'refreshes' : 'shows the cached items of'} the feeds`, async ({ page }) => {
      await mockFeeds(page)
      await goTo(page, 'subscriptions')
      await page.locator('[data-rss-feeds-tab]').click()
      const titles = page.locator('#subscriptionsPanel .ft-list-item .h3Title')
      await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])

      // Held, so that a refresh stays visible
      let requested = false
      await page.route(RSS_URL, () => { requested = true })
      await page.reload()
      await goTo(page, 'subscriptions')
      await page.locator('[data-rss-feeds-tab]').click()
      await expect(titles).toHaveText(['Newest VOD', 'Older VOD'])
      const loader = page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')
      if (fetchOnStartup) {
        await expect(loader).toBeVisible()
        await expect.poll(() => requested).toBe(true)
      } else {
        await expect(loader).toHaveCount(0)
        expect(requested).toBe(false)
      }
    })
  })
}

test.describe('when RSS feeds are the only enabled feeds', () => {
  test.use({
    seed: {
      settings: {
        fetchSubscriptionsAutomatically: false,
        enableRssFeeds: true,
        followedRssFeeds: [RSS_FEED],
        hideSubscriptionsVideos: true,
        hideSubscriptionsShorts: true,
        hideSubscriptionsLive: true,
        hideSubscriptionsCommunity: true
      }
    }
  })

  test('lists the new RSS items in the New feed', async ({ page }) => {
    await mockFeeds(page)
    let requests = 0
    page.on('request', (request) => {
      if (request.url() === RSS_URL) requests++
    })
    await goTo(page, 'subscriptions')
    const tabs = page.locator('[data-subscription-feed-tab]')
    await expect(tabs).toHaveCount(1)
    await expect(tabs).toHaveAttribute('data-subscription-feed-tab', 'all')
    await expect(page.locator('[data-rss-feeds-tab]')).toBeVisible()

    await tabs.click()
    const panel = page.locator('#subscriptionsPanel')
    await expect(panel.getByText('There is no new content.')).toBeVisible()
    await expect(panel.getByText(/Your Subscription list is currently empty/)).toHaveCount(0)
    const header = page.locator('.subscriptionsHeader')
    await expect(header.getByRole('button', { name: 'Manage RSS Feeds' })).toBeVisible()
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toHaveCount(0)
    expect(requests).toBe(1)

    // Its refresh and the refresh shortcut refresh the RSS feeds
    await page.route(RSS_URL, route => route.fulfill({
      contentType: 'application/rss+xml',
      body: rssFeed.replace('<item>', `<item>
      <title>Brand new VOD</title>
      <link>https://www.twitch.tv/videos/4</link>
      <pubDate>${new Date(now - 60000).toUTCString()}</pubDate>
      <guid isPermaLink="false">vod-4</guid>
    </item>
    <item>`)
    }))
    await header.getByRole('button', { name: /^Refresh / }).click()
    await expect(panel.locator('.ft-list-item .h3Title')).toHaveText(['Brand new VOD'])
    await expect(page.locator('[data-rss-feeds-tab] .tabLoadingIndicator')).toHaveCount(0)
    expect(requests).toBe(2)
    await page.keyboard.press('r')
    await expect.poll(() => requests).toBe(3)

    await page.getByRole('button', { name: 'Mark all as seen' }).click()
    await expect(panel.getByText('There is no new content.')).toBeVisible()
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

  test('keeps an RSSHub feed that could not be loaded in the focused feed URL box', async ({ page }) => {
    const feedUrl = 'https://rss.example.test/peertube/channel/missing'
    await page.route(/^https?:\/\//, abortUnmockedRequest)
    await page.route('https://raw.githubusercontent.com/RSSNext/rsshub-docs/**', route => route.fulfill({ body: '' }))
    await page.route('https://rss.example.test/**', route => route.request().url() === feedUrl
      ? route.fulfill({ status: 500, body: 'Server error' })
      : route.fulfill({ json: RSSHUB_NAMESPACES }))

    const manager = await openFeedManager(page)
    await manager.getByRole('button', { name: 'Browse RSSHub' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add a feed from RSSHub' })
    const instance = dialog.getByRole('textbox', { name: 'RSSHub instance' })
    await instance.fill('rss.example.test')
    await instance.press('Enter')
    await dialog.getByRole('textbox', { name: 'Service' }).fill('PeerTube')
    await dialog.locator('.serviceInput .list li').first().click()
    await dialog.getByRole('textbox', { name: 'id' }).fill('missing')
    await dialog.getByRole('button', { name: 'Add Feed' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('The feed could not be loaded.', { exact: false })).toBeVisible()
    const input = manager.getByRole('textbox', { name: 'Add Feed' })
    await expect(input).toHaveValue(feedUrl)
    // Focus can't return to the Browse button, which was disabled when the dialog closed
    await expect(input).toBeFocused()
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
