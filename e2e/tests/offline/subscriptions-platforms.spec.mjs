import { chmod, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { choosePickerPaths, expect, goTo, sel, test } from '../../helpers/app.mjs'
import { waitForPlayback } from '../../helpers/player.mjs'
import { DEMO_MEDIA_URL, routeDemoMedia } from '../../helpers/media.mjs'
import { SYNC_KEY, SYNC_SALT, mockSyncServer, syncWithSyncServer } from '../../helpers/sync-history.mjs'
import { encryptSyncDocument } from '../../../src/renderer/helpers/sync-server-privacy.js'

const THUMBNAIL_PATH = fileURLToPath(new URL('../../fixtures/images/opentubex-playlist.jpg', import.meta.url))
const AVATAR = 'https://twitch.example.test/avatar.jpg'
const CHANNEL = { id: '1001', login: 'streamer', name: 'Streamer', avatar: AVATAR }
const OTHER_CHANNEL = { id: '1002', login: 'other', name: 'Other', avatar: AVATAR }
/**
 * @param {typeof CHANNEL} channel
 */
const followed = ({ id, login, name }) => ({ platform: 'twitch', id, name, url: `https://www.twitch.tv/${login}`, avatar: AVATAR })
const now = Date.now()

/**
 * @param {typeof CHANNEL} channel
 * @param {{ stream?: object | null }} [options]
 */
function twitchUser({ id, login, name }, { stream = null } = {}) {
  return {
    id,
    login,
    displayName: name,
    profileImageURL: AVATAR,
    stream,
    videos: {
      edges: [
        { node: { id: `${id}2`, title: `${name} newest VOD`, publishedAt: new Date(now - 3600000).toISOString(), lengthSeconds: 3725, viewCount: 12, previewThumbnailURL: 'https://twitch.example.test/vod.jpg' } },
        { node: { id: `${id}1`, title: `${name} older VOD`, publishedAt: new Date(now - 3 * 86400000).toISOString(), lengthSeconds: 60, previewThumbnailURL: 'https://twitch.example.test/vod.jpg' } }
      ]
    },
    clips: {
      edges: [{ node: { slug: `${login}-clip`, title: `${name} clip`, createdAt: new Date(now - 7200000).toISOString(), durationSeconds: 30, thumbnailURL: 'https://twitch.example.test/clip.jpg' } }]
    }
  }
}

/**
 * Answers Twitch's GraphQL API from the given channels, which tests can change.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, object>} users by ID
 */
async function mockTwitch(page, users) {
  const requests = []
  await page.route('https://twitch.example.test/**', route => route.fulfill({ path: THUMBNAIL_PATH }))
  await page.route('https://gql.twitch.tv/gql', route => {
    const { query, variables } = route.request().postDataJSON()
    requests.push(variables)
    if (query.includes('searchFor')) {
      const matches = Object.values(users).filter(user => user.displayName.toLowerCase().includes(variables.query.toLowerCase()))
      return route.fulfill({
        json: {
          data: {
            searchFor: query.includes('index: CHANNEL')
              ? { channels: { cursor: null, items: matches } }
              : { videos: { cursor: null, items: matches.flatMap(user => user.videos.edges.map(edge => ({ ...edge.node, owner: user }))) } }
          }
        }
      })
    }
    if (variables.ids) return route.fulfill({ json: { data: { users: variables.ids.map(id => users[id] ?? null) } } })
    const user = Object.values(users).find(user => user.id === variables.id || user.login === variables.login) ?? null
    return route.fulfill({ json: { data: { user } } })
  })
  return requests
}

/**
 * @param {import('../../helpers/app.mjs').App} app
 * @param {import('@playwright/test').Page} page
 * @param {string} mediaUrl
 */
async function prepareTwitchYtDlp(app, page, mediaUrl) {
  const executable = path.join(app.userDataDir, 'twitch-yt-dlp.sh')
  const response = JSON.stringify({
    title: 'A Twitch broadcast',
    webpage_url: mediaUrl,
    uploader: 'Streamer',
    uploader_id: 'streamer',
    live_status: 'was_live',
    duration: 30,
    formats: [{ format_id: 'webm-360', url: DEMO_MEDIA_URL, protocol: 'https', ext: 'webm', vcodec: 'vp9', acodec: 'opus', width: 640, height: 360, tbr: 200 }]
  })
  await writeFile(executable, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "%s\\n" "2026.09.01"; exit; fi',
    `printf '%s\\n' '${response}'`
  ].join('\n'))
  await chmod(executable, 0o755)
  await routeDemoMedia(page)
  await choosePickerPaths(app, page, { ytDlpPath: executable })
  await page.evaluate(() => window.$store.dispatch('updateYtDlpSource', 'system'))
}

// The main process checks for live streams while notifications are on. Tests turn
// them on once they answer its requests.
const SETTINGS = { fetchSubscriptionsAutomatically: false, hideSideBarOnWatchPages: false, twitchLiveNotifications: false }

test.describe('Channels on other platforms', () => {
  test.use({ seed: { settings: SETTINGS } })

  test('follows a Twitch channel from its media page and lists its streams, videos and clips', async ({ app, page }) => {
    test.skip(process.platform === 'win32', 'The fake yt-dlp executable uses a POSIX shell')
    const liveStream = { id: 'stream-1', title: 'Live right now', createdAt: new Date(now - 600000).toISOString(), viewersCount: 42, previewImageURL: 'https://twitch.example.test/live.jpg', archiveVideo: { id: '10013' } }
    const user = twitchUser(CHANNEL, { stream: liveStream })
    // The video recording the running stream, which is left out while it runs
    user.videos.edges.unshift({ node: { id: '10013', title: 'Recording of the live stream', publishedAt: new Date(now - 600000).toISOString(), lengthSeconds: 600, previewThumbnailURL: 'https://twitch.example.test/vod.jpg' } })
    const requests = await mockTwitch(page, { [CHANNEL.id]: user })
    const mediaUrl = 'https://www.twitch.tv/videos/123456789'
    await prepareTwitchYtDlp(app, page, mediaUrl)
    // Without followed channels, there is no Platforms tab
    await goTo(page, 'subscriptions')
    await expect(page.locator('[data-subscription-feed-tab="videos"]')).toBeVisible()
    await expect(page.locator('[data-platforms-tab]')).toHaveCount(0)

    await page.locator(sel.searchInput).fill(mediaUrl)
    await page.locator(sel.searchInput).press('Enter')
    await waitForPlayback(page)
    const follow = page.locator('.externalMediaCreator').getByRole('button', { name: 'Follow', exact: true })
    await follow.click()
    await expect(page.locator('.externalMediaCreator').getByRole('button', { name: 'Following' })).toBeVisible()
    expect(await page.evaluate(() => window.$store.getters.getFollowedChannels)).toEqual([followed(CHANNEL)])

    // The creator opens the channel page in the app, not the website
    await page.locator('.externalMediaCreatorProfile').click()
    await expect.poll(() => page.evaluate(() => {
      const { path, query } = window.$router.currentRoute.value
      return { path, query }
    })).toEqual({ path: '/external-channel', query: { platform: 'twitch', id: 'streamer' } })
    await expect(page.locator('.channelHeader .channelName')).toHaveText('Streamer')
    await expect(page.locator('.channelActions').getByRole('button', { name: 'Following' })).toBeVisible()
    // The live stream comes first, without the video recording it
    await expect(page.locator('.ft-list-item .h3Title')).toHaveText(['Live right now', 'Streamer newest VOD', 'Streamer older VOD'])
    const requestCount = requests.length
    await page.locator('[data-channel-tab="clips"]').click()
    await expect(page.locator('.ft-list-item .h3Title')).toHaveText(['Streamer clip'])
    // Switching tabs loads only the new tab, not the channel again, and keeps the loaded one
    await page.locator('[data-channel-tab="videos"]').click()
    await expect(page.locator('.ft-list-item .h3Title')).toHaveText(['Live right now', 'Streamer newest VOD', 'Streamer older VOD'])
    expect(requests.slice(requestCount)).toEqual([{ id: CHANNEL.id }])

    await goTo(page, 'subscriptions')
    await page.locator('[data-platforms-tab]').click()
    const panel = page.locator('#subscriptionsPanel')
    // Following loaded the channel, so the tab needs no refresh
    await expect(panel.locator('[data-platform-section]')).toHaveCount(3)
    const live = panel.locator('[data-platform-section="live"]')
    await expect(live.locator(':scope > h3')).toHaveText('Live')
    await expect(live.locator('.h3Title')).toHaveText('Live right now')
    await expect(live.locator('.videoDuration')).toHaveText('Live')
    await expect(live.locator('.viewCount')).toHaveText('42 watching')
    await expect(live.locator('.channelName img')).toHaveAttribute('src', AVATAR)
    // The archive of the running stream is left out
    const videos = panel.locator('[data-platform-section="videos"]')
    await expect(videos.locator('.h3Title')).toHaveText(['Streamer newest VOD', 'Streamer older VOD'])
    await expect(videos.locator('.videoDuration').first()).toHaveText('1:02:05')
    await expect(panel.locator('[data-platform-section="clips"] .h3Title')).toHaveText('Streamer clip')

    // Videos can come back to the New feed, but clips aren't new content
    await videos.locator('.ft-list-item').first().click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Mark As Watched' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Mark As Unseen' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await panel.locator('[data-platform-section="clips"] .ft-list-item').click({ button: 'right' })
    await expect(menu.getByRole('menuitem', { name: 'Mark As Watched' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Mark As Unseen' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // The channel of an item opens its page
    await videos.locator('.channelName').first().click()
    await expect.poll(() => page.evaluate(() => window.$router.currentRoute.value.fullPath))
      .toBe('/external-channel?platform=twitch&id=1001')
    await expect(page.locator('.channelHeader .channelName')).toHaveText('Streamer')
    await page.locator(sel.backButton).click()

    await panel.locator('[data-platform-section="videos"] .h3Title').first().click()
    await expect.poll(() => page.evaluate(() => {
      const { path, query } = window.$router.currentRoute.value
      return { path, query }
    })).toEqual({ path: '/external-media', query: { url: 'https://www.twitch.tv/videos/10012' } })

    // Unfollowing the last channel removes the tab
    await page.locator('.externalMediaCreator').getByRole('button', { name: 'Following' }).click()
    await expect(page.locator('.externalMediaCreator').getByRole('button', { name: 'Follow', exact: true })).toBeVisible()
    await goTo(page, 'subscriptions')
    await expect(page.locator('[data-subscription-feed-tab="videos"]')).toBeVisible()
    await expect(page.locator('[data-platforms-tab]')).toHaveCount(0)
  })

  test.describe('with a followed channel', () => {
    test.use({ seed: { settings: { ...SETTINGS, followedChannels: [followed(CHANNEL)] } } })

    test('adds and removes channels in the settings and refreshes the tab', async ({ page }) => {
      const users = { [CHANNEL.id]: twitchUser(CHANNEL), [OTHER_CHANNEL.id]: twitchUser(OTHER_CHANNEL) }
      const requests = await mockTwitch(page, users)
      await goTo(page, 'subscriptions')
      await page.locator('[data-platforms-tab]').click()
      const titles = page.locator('#subscriptionsPanel [data-platform-section="videos"] .h3Title')
      // Nothing is cached yet, so the tab loads the channel
      await expect(titles).toHaveText(['Streamer newest VOD', 'Streamer older VOD'])
      await expect(page.locator('[data-platform-section="live"]')).toHaveCount(0)

      await page.getByRole('button', { name: 'Manage Followed Channels' }).click()
      const manager = page.locator('.settingsSubpageContent')
      const rows = manager.locator('.channelRow')
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toContainText('Streamer')

      const input = manager.getByRole('textbox', { name: 'Add Channel' })
      // Videos aren't channels, and names alone don't say which platform they are on
      const invalid = page.getByText('Enter the address of a channel page on Twitch, SoundCloud, PeerTube, Rumble or Odysee.')
      for (const [index, text] of ['https://www.twitch.tv/videos/123', 'Other'].entries()) {
        await input.fill(text)
        await input.press('Enter')
        // Each attempt shows its own message
        await expect(invalid).toHaveCount(index + 1)
      }
      await expect(rows).toHaveCount(1)

      await input.fill('https://www.twitch.tv/Streamer')
      await input.press('Enter')
      await expect(page.getByText('You already follow this channel.')).toBeVisible()

      await input.fill('https://www.twitch.tv/unknown')
      await input.press('Enter')
      await expect(page.getByText('There is no channel at this address.')).toBeVisible()

      await input.fill('https://m.twitch.tv/Other/videos')
      await input.press('Enter')
      await expect(rows).toHaveCount(2)
      await expect(rows.last()).toContainText('Other')
      await expect(input).toHaveValue('')

      await manager.getByRole('button', { name: 'Unfollow Streamer' }).click()
      await expect(rows).toHaveCount(1)
      expect(await page.evaluate(() => window.$store.getters.getFollowedChannels)).toEqual([followed(OTHER_CHANNEL)])
      // Its items and history are forgotten as soon as the setting changes, as for
      // channels unfollowed through sync, so following it again starts over
      await expect.poll(() => page.evaluate((key) => {
        const feed = JSON.parse(localStorage.getItem('platformFeed'))
        const items = [...feed.live, ...feed.videos, ...feed.clips].filter(item => `${item.platform}:${item.channelId}` === key)
        return { items: items.length, cached: feed.channelKeys.includes(key), history: key in JSON.parse(localStorage.getItem('platformFeedHistory') ?? '{}') }
      }, `twitch:${CHANNEL.id}`)).toEqual({ items: 0, cached: false, history: false })

      await page.locator('.settingsCloseButton').click()
      await expect(titles).toHaveText(['Other newest VOD', 'Other older VOD'])

      // Twitch renamed the channel, and a refresh picks that up
      users[OTHER_CHANNEL.id] = { ...twitchUser(OTHER_CHANNEL), login: 'renamed', displayName: 'Renamed' }
      const requestCount = requests.length
      await page.getByRole('button', { name: /Refresh Platforms/ }).click()
      await expect(page.locator('#subscriptionsPanel .channelNameText').first()).toHaveText('Renamed')
      expect(requests.slice(requestCount)).toEqual([{ ids: [OTHER_CHANNEL.id] }])
      await expect.poll(() => page.evaluate(() => window.$store.getters.getFollowedChannels))
        .toEqual([followed({ ...OTHER_CHANNEL, login: 'renamed', name: 'Renamed' })])

      // The manager opens the page of a channel in place of the settings
      await page.getByRole('button', { name: 'Manage Followed Channels' }).click()
      await manager.getByRole('button', { name: 'Go to Renamed' }).click()
      await expect(page.locator('.settingsWindow')).toBeHidden()
      await expect.poll(() => page.evaluate(() => {
        const { path, query } = window.$router.currentRoute.value
        return { path, query }
      })).toEqual({ path: '/external-channel', query: { platform: 'twitch', id: OTHER_CHANNEL.id } })
      await expect(page.locator('.channelHeader .channelName')).toHaveText('Renamed')
    })

    test('lists new videos and live streams in the New feed until they are seen', async ({ page }) => {
      const user = twitchUser(CHANNEL)
      const requests = await mockTwitch(page, { [CHANNEL.id]: user })
      await goTo(page, 'subscriptions')
      await page.locator('[data-platforms-tab]').click()
      const videos = page.locator('#subscriptionsPanel [data-platform-section="videos"] .h3Title')
      // The first load of a channel has nothing new
      await expect(videos).toHaveText(['Streamer newest VOD', 'Streamer older VOD'])

      user.videos.edges.unshift({ node: { id: '10013', title: 'Streamer brand new VOD', publishedAt: new Date(now - 60000).toISOString(), lengthSeconds: 90, previewThumbnailURL: 'https://twitch.example.test/vod.jpg' } })
      user.stream = { id: 'stream-2', title: 'Back live', createdAt: new Date(now).toISOString(), viewersCount: 5, previewImageURL: 'https://twitch.example.test/live.jpg', archiveVideo: { id: '10014' } }
      await page.getByRole('button', { name: /Refresh Platforms/ }).click()
      await expect(videos).toHaveText(['Streamer brand new VOD', 'Streamer newest VOD', 'Streamer older VOD'])

      await page.locator('[data-subscription-feed-tab="all"]').click()
      const section = page.locator('#subscriptionsPanel [data-new-feed-section="platforms"]')
      await expect(section.locator('.h3Title')).toHaveText(['Back live', 'Streamer brand new VOD'])
      // Clips come from viewers, so they aren't new content
      await expect(section.getByText('Streamer clip')).toHaveCount(0)

      await page.getByRole('button', { name: 'Mark All as Seen' }).click()
      await expect(section).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => JSON.parse(window.$store.getters.getRssFeedSeenItems).map(entry => entry.key).sort()))
        .toEqual([`twitch:${CHANNEL.id}\n10013`, `twitch:${CHANNEL.id}\nstream-2`])

      // The video of the stream isn't new again once the stream ends
      user.stream = null
      user.videos.edges.unshift({ node: { id: '10014', title: 'Recording of Back live', publishedAt: new Date(now).toISOString(), lengthSeconds: 90, previewThumbnailURL: 'https://twitch.example.test/vod.jpg' } })
      await page.locator('[data-platforms-tab]').click()
      await page.getByRole('button', { name: /Refresh Platforms/ }).click()
      await expect(videos.first()).toHaveText('Recording of Back live')
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('platformFeed')).videos.filter(item => item.isNew).length)).toBe(0)

      // Refreshing all feeds covers other platforms too, from any tab of the tabbed New feed
      await page.evaluate(() => window.$store.dispatch('updateNewSubscriptionFeedView', 'tabbed'))
      const newTab = page.locator('[data-subscription-feed-tab="all"]')
      await newTab.click()
      await page.locator('[data-new-feed-tab="videos"]').click()
      let requestCount = requests.length
      await page.getByRole('button', { name: /Refresh New content/ }).click()
      await expect.poll(() => requests.length).toBeGreaterThan(requestCount)
      await expect(page.getByRole('button', { name: /Refresh New content/ })).toHaveAttribute('aria-disabled', 'false')
      requestCount = requests.length
      await newTab.click({ button: 'right' })
      await page.getByRole('menu', { name: 'Context menu' }).getByRole('menuitem', { name: 'Reload All Feeds' }).click()
      await expect.poll(() => requests.length).toBeGreaterThan(requestCount)
    })

    test('brings back uploads that another device marked as unseen after they were watched here', async ({ page }) => {
      await mockTwitch(page, { [CHANNEL.id]: twitchUser(CHANNEL) })
      await goTo(page, 'subscriptions')
      await page.locator('[data-platforms-tab]').click()
      const panel = page.locator('#subscriptionsPanel')
      const item = panel.locator('[data-platform-section="videos"] .ft-list-item', { hasText: 'Streamer newest VOD' })
      await item.locator('.title').click({ button: 'right' })
      await page.locator('.contextMenu').getByRole('menuitem', { name: 'Mark As Watched' }).click()
      await expect(item).toHaveClass(/watched/)
      const watchedAt = await page.evaluate(() => (
        JSON.parse(localStorage.getItem('externalMediaPosition:https://www.twitch.tv/videos/10012')).updatedAt
      ))

      await mockSyncServer(page, {
        history: await encryptSyncDocument([], SYNC_KEY, SYNC_SALT),
        seenRssItems: await encryptSyncDocument([{ key: `twitch:${CHANNEL.id}\n10012`, unseenAt: watchedAt + 1000 }], SYNC_KEY, SYNC_SALT)
      })
      expect(await syncWithSyncServer(page)).toEqual(['success', ''])

      // The later unseen mark wins over the earlier watch
      await expect(item).not.toHaveClass(/watched/)
      await page.locator('[data-subscription-feed-tab="all"]').click()
      await expect(panel.locator('[data-new-feed-section="platforms"] .h3Title')).toHaveText(['Streamer newest VOD'])
    })

    test('reloads the feed and marks it as seen from the context menus of its tabs', async ({ page }) => {
      const user = twitchUser(CHANNEL)
      const requests = await mockTwitch(page, { [CHANNEL.id]: user })
      await goTo(page, 'subscriptions')
      const platformsTab = page.locator('[data-platforms-tab]')
      await platformsTab.click()
      const videos = page.locator('#subscriptionsPanel [data-platform-section="videos"] .h3Title')
      await expect(videos).toHaveText(['Streamer newest VOD', 'Streamer older VOD'])
      user.videos.edges.unshift({ node: { id: '10013', title: 'Streamer brand new VOD', publishedAt: new Date(now - 60000).toISOString(), lengthSeconds: 90, previewThumbnailURL: 'https://twitch.example.test/vod.jpg' } })

      const menu = page.getByRole('menu', { name: 'Context menu' })
      let requestCount = requests.length
      await platformsTab.click({ button: 'right' })
      await expect(menu.getByRole('menuitem', { name: 'Mark All as Seen' })).toHaveCount(0)
      await menu.getByRole('menuitem', { name: 'Reload Platforms' }).click()
      await expect.poll(() => requests.length).toBeGreaterThan(requestCount)
      await expect(videos).toHaveText(['Streamer brand new VOD', 'Streamer newest VOD', 'Streamer older VOD'])

      // The Platforms tab of the New feed has the same menu
      await page.locator('[data-subscription-feed-tab="all"]').click()
      await page.locator('.subscriptionsHeader').getByRole('button', { name: 'Show tabbed view' }).click()
      const newFeedPlatformsTab = page.locator('[data-new-feed-platforms-tab]')
      await newFeedPlatformsTab.click()
      const panel = page.locator('#subscriptionsPanel')
      await expect(panel.locator('.ft-list-item .h3Title')).toHaveText(['Streamer brand new VOD'])
      await newFeedPlatformsTab.click({ button: 'right' })
      await expect(menu.getByRole('menuitem', { name: 'Reload Platforms' })).toBeVisible()
      await menu.getByRole('menuitem', { name: 'Mark All as Seen' }).click()
      await expect(panel.getByText('There is no new content.')).toBeVisible()

      await platformsTab.click({ button: 'right' })
      await expect(menu.getByRole('menuitem', { name: 'Reload Platforms' })).toBeVisible()
      await expect(menu.getByRole('menuitem', { name: 'Mark All as Seen' })).toHaveCount(0)
      await page.keyboard.press('Escape')

      // Holding the tab opens the same actions on phones
      await platformsTab.evaluate(element => element.dispatchEvent(new PointerEvent('contextmenu', {
        bubbles: true, cancelable: true, pointerType: 'touch'
      })))
      requestCount = requests.length
      await page.locator('.mobileLinkActions').getByRole('menuitem', { name: 'Reload Platforms', exact: true }).click()
      await expect.poll(() => requests.length).toBeGreaterThan(requestCount)
    })

    test('announces each broadcast of a followed channel once from the main process', async ({ app, page }) => {
      const users = { [CHANNEL.id]: twitchUser(CHANNEL, { stream: { id: 'stream-1', title: 'Going live', previewImageURL: 'https://twitch.example.test/live.jpg' } }) }
      await mockTwitch(page, users)
      // The main process checks, so it answers its own requests
      const setMainUsers = value => app.electronApp.evaluate((_, value) => { globalThis.twitchUsers = value }, value)
      await setMainUsers(users)
      await app.electronApp.evaluate(({ Notification, BrowserWindow, net }) => {
        globalThis.shownNotifications = []
        globalThis.twitchRequests = 0
        const fetch = net.fetch
        net.fetch = async (url, options) => {
          if (String(url) === 'https://gql.twitch.tv/gql') {
            globalThis.twitchRequests++
            const ids = JSON.parse(options.body).variables.ids
            return Response.json({ data: { users: ids.map(id => globalThis.twitchUsers[id] ?? null) } })
          }
          // Thumbnails fail right away instead of delaying system notifications
          if (String(url).includes('twitch.example.test')) throw new Error('Offline')
          return fetch(url, options)
        }
        Notification.isSupported = () => true
        Notification.prototype.show = function () {
          globalThis.shownNotifications.push({ title: this.title, body: this.body })
        }
        // The test window's focus depends on the display
        BrowserWindow.getFocusedWindow = () => null
      })
      const liveEntries = () => page.evaluate(async () => (await window.ftElectron.notificationHistory.list())
        .filter(entry => entry.kind === 'live')
        .map(({ title, body, path, query }) => ({ title, body, path, query })))
      const cachedLiveStreams = () => page.evaluate(() => JSON.parse(localStorage.getItem('platformFeed') ?? 'null')?.live.map(item => item.id) ?? [])
      const shown = () => app.electronApp.evaluate(() => globalThis.shownNotifications)

      await page.evaluate(() => window.$store.dispatch('updateTwitchLiveNotifications', true))
      // Live at the first check, so not news, but the Twitch tab shows it
      await expect.poll(cachedLiveStreams).toEqual(['stream-1'])
      expect(await liveEntries()).toEqual([])

      // Following another channel checks again, and the channel went live with another broadcast
      await setMainUsers({
        [CHANNEL.id]: twitchUser(CHANNEL, { stream: { id: 'stream-2', title: 'Live again', previewImageURL: 'https://twitch.example.test/live.jpg' } }),
        [OTHER_CHANNEL.id]: twitchUser(OTHER_CHANNEL, { stream: { id: 'other-1', title: 'Already live' } })
      })
      await page.evaluate(channel => window.$store.dispatch('updateFollowedChannels', [...window.$store.getters.getFollowedChannels, channel]), followed(OTHER_CHANNEL))
      await expect.poll(liveEntries).toEqual([{
        title: 'Streamer is live',
        body: 'Live again',
        path: '/external-media',
        query: { url: 'https://www.twitch.tv/streamer', stream: 'stream-2' }
      }])
      await expect.poll(shown).toEqual([{ title: 'Streamer is live', body: 'Live again' }])
      await expect.poll(cachedLiveStreams).toEqual(expect.arrayContaining(['stream-2', 'other-1']))

      // The same broadcast isn't announced again by the next check
      const requests = await app.electronApp.evaluate(() => globalThis.twitchRequests)
      await page.evaluate(channel => window.$store.dispatch('updateFollowedChannels', [channel]), followed(CHANNEL))
      await expect.poll(() => app.electronApp.evaluate(() => globalThis.twitchRequests)).toBeGreaterThan(requests)
      await expect.poll(cachedLiveStreams).toEqual(['stream-2'])
      expect(await shown()).toHaveLength(1)
    })
  })

  test('searches Twitch for channels and videos, and follows a channel from the results', async ({ page }) => {
    await mockTwitch(page, { [CHANNEL.id]: twitchUser(CHANNEL), [OTHER_CHANNEL.id]: twitchUser(OTHER_CHANNEL) })
    await page.locator(sel.searchInput).fill('stream')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/search\/stream/)
    await page.getByRole('combobox', { name: 'Platform' }).click()
    await page.getByRole('option', { name: 'Twitch' }).click()
    // Videos come first
    await expect(page.locator('.platformSearch .ft-list-item .h3Title')).toHaveText(['Streamer newest VOD', 'Streamer older VOD'])
    await page.getByRole('combobox', { name: 'Type' }).click()
    await page.getByRole('option', { name: 'Channels' }).click()
    const result = page.locator('.platformSearch .ft-list-channel')
    await expect(result).toHaveCount(1)
    await expect(result.locator('.h3Title')).toHaveText('Streamer')
    await result.getByRole('button', { name: 'Follow', exact: true }).click()
    await expect(result.getByRole('button', { name: 'Following' })).toBeVisible()
    expect(await page.evaluate(() => window.$store.getters.getFollowedChannels)).toEqual([followed(CHANNEL)])

    // The platform and type stay selected for the next search
    await page.locator(sel.searchInput).fill('other')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.getByRole('combobox', { name: 'Platform' })).toContainText('Twitch')
    await expect(page.getByRole('combobox', { name: 'Type' })).toContainText('Channels')
    await expect(result.locator('.h3Title')).toHaveText('Other')

    // YouTube's search links search YouTube, and the next search Twitch again
    await page.locator(sel.searchInput).fill('https://www.youtube.com/results?search_query=example')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page).toHaveURL(/#\/search\/example/)
    await expect(page.getByRole('combobox', { name: 'Platform' })).toContainText('YouTube')
    await page.locator(sel.searchInput).fill('other')
    await page.locator(sel.searchInput).press('Enter')
    await expect(page.getByRole('combobox', { name: 'Platform' })).toContainText('Twitch')
  })

  test.describe('with a followed channel and every YouTube feed hidden', () => {
    test.use({
      seed: {
        settings: {
          ...SETTINGS,
          followedChannels: [followed(CHANNEL)],
          enableRssFeeds: true,
          hideSubscriptionsVideos: true,
          hideSubscriptionsShorts: true,
          hideSubscriptionsLive: true,
          hideSubscriptionsCommunity: true
        }
      }
    })

    test('refreshes the followed channels from the combined New feed without followed RSS feeds', async ({ page }) => {
      const requests = await mockTwitch(page, { [CHANNEL.id]: twitchUser(CHANNEL) })
      await goTo(page, 'subscriptions')
      await page.locator('[data-subscription-feed-tab="all"]').click()
      const header = page.locator('.subscriptionsHeader')
      // The tab opens on startup, before the Twitch API is mocked, so only later requests count
      const refresh = header.getByRole('button', { name: /^Refresh / })
      await expect(refresh).toBeEnabled()
      const requestCount = requests.length
      await refresh.click()
      await expect.poll(() => requests.slice(requestCount)).toEqual([{ ids: [CHANNEL.id] }])
    })
  })

  test.describe('with a followed PeerTube channel', () => {
    test.use({ seed: { settings: { ...SETTINGS, followedChannels: [{ platform: 'peertube', id: 'makers@peertube.example.test', name: 'Makers', url: 'https://peertube.example.test/video-channels/makers' }] } } })

    test('keeps loading channel pages while the end of the list stays in view', async ({ page }) => {
      await page.route('https://peertube.example.test/**', (route) => {
        const url = new URL(route.request().url())
        if (url.pathname.startsWith('/lazy-static/')) return route.fulfill({ path: THUMBNAIL_PATH })
        if (url.pathname === '/api/v1/video-channels/makers') {
          return route.fulfill({ json: { name: 'makers', host: 'peertube.example.test', displayName: 'Makers', url: 'https://peertube.example.test/video-channels/makers' } })
        }
        if (url.pathname === '/api/v1/video-channels/makers/videos') {
          // Three pages of one video each, too short to move the end of the list out of view
          const count = Number(url.searchParams.get('count'))
          const index = Number(url.searchParams.get('start')) / count
          const uuid = `00000000-0000-4000-8000-00000000000${index}`
          return route.fulfill({
            json: {
              total: 3 * count,
              data: [{
                uuid,
                name: `Makers video ${index + 1}`,
                url: `https://peertube.example.test/w/${uuid}`,
                publishedAt: new Date(now - (index + 1) * 3600000).toISOString(),
                duration: 125,
                thumbnailPath: '/lazy-static/thumbnails/video.jpg',
                channel: { name: 'makers', host: 'peertube.example.test', displayName: 'Makers' }
              }]
            }
          })
        }
        return route.fulfill({ status: 404, json: {} })
      })
      await goTo(page, 'subscriptions')
      await page.locator('[data-platforms-tab]').click()
      await page.locator('#subscriptionsPanel .channelName').first().click()
      await expect(page.locator('.channelHeader .channelName')).toHaveText('Makers')
      await expect(page.locator('.ft-list-item .h3Title')).toHaveText(['Makers video 1', 'Makers video 2', 'Makers video 3'])
      await expect(page.locator('.ft-auto-load-next-page-wrapper')).toHaveCount(0)
    })
  })

  test.describe('with a followed Twitch channel and a PeerTube instance', () => {
    test.use({ seed: { settings: { ...SETTINGS, followedChannels: [followed(CHANNEL)] } } })

    test('follows a PeerTube channel by its address and filters the feed by platform', async ({ page }) => {
      const video = (uuid, name, hoursAgo) => ({
        uuid,
        name,
        url: `https://peertube.example.test/w/${uuid}`,
        publishedAt: new Date(now - hoursAgo * 3600000).toISOString(),
        duration: 125,
        views: 7,
        thumbnailPath: '/lazy-static/thumbnails/video.jpg',
        channel: { name: 'makers', host: 'peertube.example.test', displayName: 'Makers' }
      })
      const peerTubeRequests = []
      let failingVideoRequests = 0
      await mockTwitch(page, { [CHANNEL.id]: twitchUser(CHANNEL) })
      await page.route('https://peertube.example.test/**', (route) => {
        const url = new URL(route.request().url())
        peerTubeRequests.push(url.pathname)
        if (url.pathname === '/api/v1/video-channels/makers/videos' && failingVideoRequests > 0) {
          failingVideoRequests--
          return route.fulfill({ status: 500, json: {} })
        }
        if (url.pathname.startsWith('/lazy-static/')) return route.fulfill({ path: THUMBNAIL_PATH })
        if (url.pathname === '/api/v1/video-channels/makers') {
          return route.fulfill({ json: { name: 'makers', host: 'peertube.example.test', displayName: 'Makers', url: 'https://peertube.example.test/video-channels/makers', followersCount: 950, avatars: [{ path: '/lazy-static/avatars/makers.jpg', width: 120 }] } })
        }
        if (url.pathname === '/api/v1/video-channels/makers/videos') {
          return route.fulfill({ json: { total: 2, data: [video('9c9de5e8-0a1e-484a-b099-e80766180a6d', 'Makers newest video', 2), video('1d0c6b9e-5d4f-4b5e-8b0e-1c2d3e4f5a6b', 'Makers older video', 50)] } })
        }
        return route.fulfill({ status: 404, json: {} })
      })
      await goTo(page, 'subscriptions')
      await page.locator('[data-platforms-tab]').click()
      const titles = page.locator('#subscriptionsPanel [data-platform-section="videos"] .h3Title')
      await expect(titles).toHaveText(['Streamer newest VOD', 'Streamer older VOD'])

      await page.getByRole('button', { name: 'Manage Followed Channels' }).click()
      const manager = page.locator('.settingsSubpageContent')
      const input = manager.getByRole('textbox', { name: 'Add Channel' })
      await input.fill('https://peertube.example.test/c/makers/videos')
      await input.press('Enter')
      await expect(manager.locator('.channelRow')).toHaveCount(2)
      await expect(manager.locator('.channelRow').last()).toContainText('Makers')
      await expect(manager.locator('.channelRow').last()).toContainText('PeerTube')
      await page.locator('.settingsCloseButton').click()

      // Both platforms in one feed, newest first
      await expect(titles).toHaveText(['Streamer newest VOD', 'Makers newest video', 'Makers older video', 'Streamer older VOD'])
      await page.getByRole('combobox', { name: 'Platform' }).click()
      await page.getByRole('option', { name: 'PeerTube' }).click()
      await expect(titles).toHaveText(['Makers newest video', 'Makers older video'])

      // A refresh loads each platform the way it can
      const requestCount = peerTubeRequests.length
      await page.getByRole('button', { name: /Refresh Platforms/ }).click()
      await expect.poll(() => peerTubeRequests.slice(requestCount)).toContain('/api/v1/video-channels/makers/videos')

      // The channel's first page fails once, and loads when tried again
      failingVideoRequests = 1
      await page.locator('#subscriptionsPanel .channelName').first().click()
      await expect.poll(() => page.evaluate(() => {
        const { path, query } = window.$router.currentRoute.value
        return { path, query }
      })).toEqual({ path: '/external-channel', query: { platform: 'peertube', id: 'makers@peertube.example.test' } })
      await expect(page.locator('.channelHeader .channelName')).toHaveText('Makers')
      await expect(page.locator('.channelMeta')).toContainText('950 followers')
      await expect(page.getByText('This page could not be loaded from PeerTube.')).toBeVisible()
      await page.getByRole('button', { name: 'Retry' }).click()
      await expect(page.locator('.ft-list-item .h3Title')).toHaveText(['Makers newest video', 'Makers older video'])

      // The tabbed view has a tab for each kind of item the shown platforms have
      await page.locator(sel.backButton).click()
      const header = page.locator('.subscriptionsHeader')
      await header.getByRole('button', { name: 'Show tabbed view' }).click()
      const tabs = page.getByRole('tablist', { name: 'Platform content tabs' }).getByRole('tab')
      await expect(tabs).toHaveText(['Videos', 'Live'])
      const shown = page.locator('#subscriptionsPanel .ft-list-item .h3Title')
      await expect(shown).toHaveText(['Makers newest video', 'Makers older video'])
      await page.getByRole('combobox', { name: 'Platform' }).click()
      await page.getByRole('option', { name: 'All platforms' }).click()
      await expect(tabs).toHaveText(['Videos', 'Live', 'Clips'])
      await tabs.filter({ hasText: 'Clips' }).click()
      await expect(shown).toHaveText(['Streamer clip'])
      await expect(page.locator('#subscriptionsPanel [data-platform-section] > h3')).toHaveCount(0)
      await header.getByRole('button', { name: 'Show combined view' }).click()
      await expect(page.locator('#subscriptionsPanel [data-platform-section] > h3')).toHaveText(['Videos', 'Clips'])
    })
  })

  test.describe('with a followed channel and an auto refresh interval', () => {
    test.use({ seed: { settings: { ...SETTINGS, followedChannels: [followed(CHANNEL)], platformFeedAutoRefreshInterval: '1800000' } } })

    test('refreshes the feed on its auto refresh interval', async ({ page }) => {
      const users = { [CHANNEL.id]: twitchUser(CHANNEL) }
      await mockTwitch(page, users)
      await goTo(page, 'subscriptions')
      await page.locator('[data-platforms-tab]').click()
      const titles = page.locator('#subscriptionsPanel [data-platform-section="videos"] .h3Title')
      await expect(titles).toHaveText(['Streamer newest VOD', 'Streamer older VOD'])

      const header = page.locator('.subscriptionsHeader')
      const nextRefresh = () => page.evaluate(() => Number(localStorage.getItem('platformFeedNextAutoRefresh')))
      await expect.poll(nextRefresh).toBeGreaterThan(Date.now() + 29 * 60000)
      await expect(header.locator('.nextAutoRefreshTimestamp')).toBeVisible()

      // The deadline passes, here through another window
      users[CHANNEL.id].videos.edges.unshift({ node: { id: '10019', title: 'Streamer brand new VOD', publishedAt: new Date().toISOString(), lengthSeconds: 90, previewThumbnailURL: 'https://twitch.example.test/vod.jpg' } })
      await page.evaluate(() => {
        localStorage.setItem('platformFeedNextAutoRefresh', String(Date.now() - 1000))
        window.dispatchEvent(new StorageEvent('storage', { key: 'platformFeedNextAutoRefresh' }))
      })
      await expect(titles).toHaveText(['Streamer brand new VOD', 'Streamer newest VOD', 'Streamer older VOD'])
      await expect.poll(nextRefresh).toBeGreaterThan(Date.now() + 29 * 60000)

      // Turning it off stops the refreshes
      await page.evaluate(() => window.$store.dispatch('updatePlatformFeedAutoRefreshInterval', '0'))
      await expect.poll(nextRefresh).toBe(0)
    })
  })
})
