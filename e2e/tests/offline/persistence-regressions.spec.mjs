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

for (const mode of ['all', 'video', 'post']) {
  test(`marking ${mode} seen does not mutate a newer refresh after a rejected write`, async ({ app, page }) => {
    const result = await page.evaluate(async mode => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const isPost = mode === 'post'
      const key = isPost ? 'posts' : 'videos'
      const idKey = isPost ? 'postId' : 'videoId'
      const action = isPost ? 'updateSubscriptionPostsCacheByChannel' : 'updateSubscriptionVideosCacheByChannel'
      const save = (timestamp, ids) => store.dispatch(action, {
        channelId: 'audit-seen',
        timestamp: new Date(timestamp),
        [key]: ids.map(id => ({ [idKey]: id, isNewInSubscriptionFeed: true })),
      })
      await save(1000, ['existing'])
      const refresh = save(2000, ['existing', 'new'])
      const seen = mode === 'all'
        ? store.dispatch('markSubscriptionEntriesAsSeen', { tab: 'videos', channelIds: ['audit-seen'] })
        : store.dispatch(isPost ? 'markSubscriptionPostAsSeen' : 'markSubscriptionVideoAsSeen', 'existing')
      await Promise.all([refresh, seen])
      return store.state.subscriptionCache[isPost ? 'postsCache' : 'videoCache']['audit-seen'][key]
    }, mode)
    expect(result.map(entry => entry.isNewInSubscriptionFeed)).toEqual([true, true])
    const records = (await readFile(path.join(app.userDataDir, 'subscription-cache.db'), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line))
    const persisted = records.filter(record => record._id === 'audit-seen').at(-1)
    expect(persisted[mode === 'post' ? 'communityPosts' : 'videos']).toEqual(result)
  })
}

test('failed Home re-addition redirects when removal was already persisted', async ({ app, page }) => {
  await page.locator('.sideNav .navOption[title="Home"]').click()
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getActiveTab.route.path)).toBe('/home')
  const appearance = await goToSettingsSection(page, 'appearance')
  await appearance.getByRole('button', { name: 'Customize navigation' }).click()
  await app.electronApp.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('db-settings')
    let writes = 0
    ipcMain.removeHandler('db-settings')
    ipcMain.handle('db-settings', async (event, request) => {
      if (request.action !== 2 || request.data._id !== 'navigationItems') return original(event, request)
      if (++writes === 2) throw new Error('Fixture disk failure')
      const result = await original(event, request)
      await new Promise(resolve => { globalThis.releaseNavigationWrite = resolve })
      return result
    })
  })
  await page.locator('[data-navigation-item-id="home"]').getByRole('button', { name: 'Remove Home' }).click()
  await expect.poll(() => app.electronApp.evaluate(() => typeof globalThis.releaseNavigationWrite)).toBe('function')
  await page.getByRole('button', { name: 'Add item', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Home', exact: true }).click()
  await expect(page.locator('[data-navigation-item-id="home"]')).toHaveCount(1)
  await app.electronApp.evaluate(() => globalThis.releaseNavigationWrite())
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.getNavigationItems.includes('home'))).toBe(false)
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$route.path)).not.toBe('/home')
})

test('queued bulk seen writes and their final mutation retain the original snapshot', async ({ app, page }) => {
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    for (let i = 0; i < 9; i++) {
      await store.dispatch('updateSubscriptionVideosCacheByChannel', {
        channelId: `audit-bulk-${i}`,
        timestamp: new Date(1000),
        videos: [{ videoId: 'old', isNewInSubscriptionFeed: true }],
      })
    }
  })
  await app.electronApp.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('db-subscription-cache')
    let seenRequests = 0
    globalThis.blockedSeenWrites = []
    globalThis.finishedSeenWrites = 0
    ipcMain.removeHandler('db-subscription-cache')
    ipcMain.handle('db-subscription-cache', async (event, request) => {
      const seen = request.data?.channelId?.startsWith('audit-bulk-') && request.data.entries?.every(entry => entry.isNewInSubscriptionFeed === false)
      if (seen && ++seenRequests <= 8) {
        await new Promise(resolve => globalThis.blockedSeenWrites.push(resolve))
      }
      const result = await original(event, request)
      if (seen) globalThis.finishedSeenWrites++
      return result
    })
  })
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    window.bulkSeenWrite = store.dispatch('markSubscriptionEntriesAsSeen', {
      tab: 'videos', channelIds: Array.from({ length: 9 }, (_, i) => `audit-bulk-${i}`),
    })
  })
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.blockedSeenWrites.length)).toBe(8)
  const refresh = id => page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('updateSubscriptionVideosCacheByChannel', {
    channelId: `audit-bulk-${id}`,
    timestamp: new Date(2000),
    videos: [{ videoId: 'new', isNewInSubscriptionFeed: true }],
  }), id)
  // The ninth write has not started; it must not borrow the new timestamp.
  await refresh(8)
  await app.electronApp.evaluate(() => globalThis.blockedSeenWrites.shift()())
  await expect.poll(() => app.electronApp.evaluate(() => globalThis.finishedSeenWrites)).toBeGreaterThan(0)
  // The first write has finished, but the final bulk mutation is still pending.
  await refresh(0)
  await app.electronApp.evaluate(() => globalThis.blockedSeenWrites.splice(0).forEach(resolve => resolve()))
  await page.evaluate(() => window.bulkSeenWrite)
  const records = (await readFile(path.join(app.userDataDir, 'subscription-cache.db'), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line))
  for (const id of [0, 8]) {
    const expected = [{ videoId: 'new', isNewInSubscriptionFeed: true }]
    expect(records.filter(record => record._id === `audit-bulk-${id}`).at(-1).videos).toEqual(expected)
    expect(await page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.subscriptionCache.videoCache[`audit-bulk-${id}`].videos, id)).toEqual(expected)
  }
})
