import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { test, expect, goToSettingsSection, latestSettings } from '../../helpers/app.mjs'
import { decryptSyncDocument, encryptSyncDocument } from '../../../src/renderer/helpers/sync-server-privacy.js'

test('encrypted subscription retries retain concurrent remote edits', async ({ page }) => {
  const key = Buffer.alloc(32, 7).toString('base64')
  const salt = Buffer.alloc(16, 8).toString('base64')
  const channel = id => ({ id, name: id, avatar: 'https://example.test/avatar.png' })
  let remote = [channel('base'), channel('removed-remotely')]
  let revision = 1
  let conflicts = 0
  await page.route('https://sync.example.test/**', async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    let response
    if (pathname === '/v1/encrypted_sync') {
      response = { collections: [{ collection: 'subscriptions' }] }
    } else if (pathname === '/v1/encrypted_sync/subscriptions' && request.method() === 'GET') {
      response = { revision, payload: await encryptSyncDocument(remote, key, salt) }
    } else if (pathname === '/v1/encrypted_sync/subscriptions' && request.method() === 'PUT') {
      const body = request.postDataJSON()
      if (conflicts === 0) {
        remote = [channel('base'), channel('added-remotely')]
        revision++
        conflicts++
        await route.fulfill({ status: 409, json: { error: 'Revision conflict' } })
        return
      }
      expect(body.revision).toBe(revision)
      remote = await decryptSyncDocument(body.payload, key)
      revision++
      response = { revision }
    } else {
      throw new Error(`Unexpected sync request: ${request.method()} ${pathname}`)
    }
    await route.fulfill({ json: response })
  })

  await page.evaluate(async ({ key, salt }) => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    await store.dispatch('updateProfile', {
      _id: 'allChannels',
      name: 'All Channels',
      subscriptions: [
        { id: 'base', name: 'Base' },
        { id: 'removed-remotely', name: 'Removed remotely' },
        { id: 'added-locally', name: 'Added locally' },
      ],
    })
    for (const [setting, value] of Object.entries({
      SyncServerEnabled: true,
      SyncServerAutoSync: false,
      SyncServerUrl: 'https://sync.example.test',
      SyncServerToken: 'fixture-token',
      SyncServerPrivacyMode: 'enhanced',
      SyncServerPrivacyKey: key,
      SyncServerPrivacySalt: salt,
      SyncServerSyncSubscriptions: true,
      SyncServerSyncProfiles: false,
      SyncServerSyncHistory: false,
      SyncServerSyncPlaylists: false,
      SyncServerSyncSessions: false,
      SyncServerSyncSettings: false,
      SyncServerSnapshot: JSON.stringify({ subscriptions: ['base', 'removed-remotely'] }),
    })) store.commit(`set${setting}`, value)
    await store.dispatch('syncWithSyncServer')
    await store.dispatch('syncWithSyncServer')
  }, { key, salt })

  expect(conflicts).toBe(1)
  expect(remote.map(entry => entry.id).sort()).toEqual(['added-locally', 'added-remotely', 'base'])
  expect(await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    return store.state.profiles.profileList.find(profile => profile._id === 'allChannels')
      .subscriptions.map(entry => entry.id).sort()
  })).toEqual(['added-locally', 'added-remotely', 'base'])
})

for (const [setting, launcher, attribute] of [
  ['quickSettings', 'Customize quick settings', 'data-setting-id'],
  ['navigationItems', 'Customize navigation', 'data-navigation-item-id'],
]) {
  test(`${setting} retains consecutive removals before persistence finishes`, async ({ app, page }) => {
    const appearance = await goToSettingsSection(page, 'appearance')
    await appearance.getByRole('button', { name: launcher }).click()
    const rows = page.locator(`[${attribute}]`)
    const initial = await rows.evaluateAll((elements, attribute) => elements.map(element => element.getAttribute(attribute)), attribute)
    expect(initial.length).toBeGreaterThan(2)
    // One renderer task guarantees that both real click handlers run before
    // either asynchronous datastore write can update the store.
    await rows.evaluateAll(elements => {
      elements[0].querySelector('button[aria-label^="Remove "]').click()
      elements[1].querySelector('button[aria-label^="Remove "]').click()
    })
    await expect.poll(async () => latestSettings(await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8'))[setting]).toEqual(initial.slice(2))
    await expect(rows).toHaveCount(initial.length - 2)
    await app.relaunch()
    expect(latestSettings(await readFile(path.join(app.userDataDir, 'settings.db'), 'utf8'))[setting]).toEqual(initial.slice(2))
  })
}

for (const [feed, action, cache, entriesKey, storedKey, idKey] of [
  ['videos', 'updateSubscriptionVideosCacheByChannel', 'videoCache', 'videos', 'videos', 'videoId'],
  ['shorts', 'updateSubscriptionShortsCacheByChannel', 'shortsCache', 'videos', 'shorts', 'videoId'],
  ['live', 'updateSubscriptionLiveCacheByChannel', 'liveCache', 'videos', 'liveStreams', 'videoId'],
  ['posts', 'updateSubscriptionPostsCacheByChannel', 'postsCache', 'posts', 'communityPosts', 'postId'],
]) {
  test(`${feed} cache rejects stale results including overlapping writes`, async ({ app, page }) => {
    const result = await page.evaluate(async ({ action, cache, entriesKey, idKey }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const save = (time, ids) => store.dispatch(action, {
        channelId: 'audit-channel',
        timestamp: new Date(time),
        [entriesKey]: ids.map(id => ({ [idKey]: id })),
      })
      await save(2000, ['old', 'new'])
      await save(1000, ['old'])
      const afterStale = store.state.subscriptionCache[cache]['audit-channel'][entriesKey].map(entry => entry[idKey])
      await Promise.all([save(4000, ['newest']), save(3000, ['older-overlap'])])
      return { afterStale, final: store.state.subscriptionCache[cache]['audit-channel'] }
    }, { action, cache, entriesKey, idKey })
    expect(result.afterStale).toEqual(['old', 'new'])
    expect(result.final[entriesKey].map(entry => entry[idKey])).toEqual(['newest'])
    const records = (await readFile(path.join(app.userDataDir, 'subscription-cache.db'), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line))
    const persisted = records.filter(record => record._id === 'audit-channel').at(-1)
    expect(persisted[storedKey].map(entry => entry[idKey])).toEqual(['newest'])
    expect(new Date(persisted[`${storedKey}Timestamp`]).getTime()).toBe(4000)
  })
}

test('Shorts metadata enrichment cannot replace a concurrent feed refresh', async ({ app, page }) => {
  const result = await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const save = (timestamp, videos) => store.dispatch('updateSubscriptionShortsCacheByChannel', {
      channelId: 'audit-channel', timestamp: new Date(timestamp), videos,
    })
    await save(1000, [{ videoId: 'old', title: 'Old title' }])
    await Promise.all([
      save(2000, [{ videoId: 'new', title: 'New title' }]),
      store.dispatch('updateSubscriptionShortsCacheWithChannelPageShorts', {
        channelId: 'audit-channel', videos: [{ videoId: 'old', title: 'Updated title' }],
      }),
    ])
    return store.state.subscriptionCache.shortsCache['audit-channel'].videos
  })
  expect(result.map(video => video.videoId)).toEqual(['new'])
  const records = (await readFile(path.join(app.userDataDir, 'subscription-cache.db'), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line))
  const persisted = records.filter(record => record._id === 'audit-channel').at(-1)
  expect(persisted.shorts.map(video => video.videoId)).toEqual(['new'])
  expect(new Date(persisted.shortsTimestamp).getTime()).toBe(2000)
})

test('persistent playback cache preserves thumbnails and duration after restart', async ({ app, page }) => {
  const source = {
    manifestMimeType: 'application/dash+xml',
    manifestSrc: 'data:application/dash+xml;charset=UTF-8,fixture',
    legacyFormats: [],
    title: 'Fixture',
    isLive: false,
    captions: [],
    captionTranslations: [],
    subtitlesIncluded: true,
    duration: 123,
    storyboardSrc: 'data:text/vtt;charset=utf-8,WEBVTT',
  }
  expect(await page.evaluate(source => window.ftElectron.ytDlpPlaybackCacheSet(
    'abcdefghijk', 'fixture-cache-key', Date.now() + 3600000, source
  ), source)).toBe(true)
  const { page: reopened } = await app.relaunch()
  const result = await reopened.evaluate(() => window.ftElectron.ytDlpPlaybackCacheGet('abcdefghijk', 'fixture-cache-key'))
  expect(result.source.storyboardSrc).toBe(source.storyboardSrc)
  expect(result.source.duration).toBe(source.duration)
})

test('stale refresh completion cannot rewind feed refresh timing', async ({ page }) => {
  const result = await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const latest = Math.max(Date.now(), store.getters.getSubscriptionFeedLastRefreshTimestamp) + 1000
    for (const timestamp of [latest, latest - 1000]) {
      window.dispatchEvent(new CustomEvent('opentubex-subscription-refresh-completed', {
        detail: { tab: 'videos', profileId: store.getters.getActiveProfile._id, timestamp },
      }))
    }
    return { actual: store.getters.getSubscriptionFeedLastRefreshTimestamp, expected: latest }
  })
  expect(result.actual).toBe(result.expected)
})
