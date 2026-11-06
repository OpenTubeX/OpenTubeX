import { rm } from 'node:fs/promises'
import { createUserDataDir, expect, goTo, launchApp, test } from '../../helpers/app.mjs'
import { createTakeoutSyncServer } from '../../helpers/sync-takeout-playlists.mjs'
import { videoToRemote } from '../../../src/renderer/helpers/sync-history-merge.js'
import { historyRepairPatch } from '../../../src/historyRepair.js'

const original = {
  _id: 'abcdefghijk',
  videoId: 'abcdefghijk',
  title: '',
  author: '',
  authorId: 'UCabcdefghijklmnopqrstuv',
  published: 0,
  lengthSeconds: 0,
  isLive: true,
  liveNow: true,
  isUpcoming: true,
  timeWatched: 1700000000000,
  watchProgress: 42,
  isWatched: true,
  type: 'video',
}
const seed = { history: [original], settings: { syncServerEnabled: false, syncServerAutoSync: false } }
test.use({ seed })

async function configureSync(page, settings, initialSync = true) {
  await page.evaluate(async ({ settings, initialSync }) => {
    const store = window.$store
    for (const [key, value] of Object.entries(settings)) {
      await store.dispatch(`update${key[0].toUpperCase()}${key.slice(1)}`, value)
    }
    await store.dispatch('updateSyncServerEnabled', true)
    if (initialSync) await store.dispatch('syncWithSyncServer')
  }, { settings, initialSync })
}

async function sync(page) {
  await page.evaluate(() => window.$store.dispatch('syncWithSyncServer'))
}

for (const { encrypted, beforeFirstSync, failure, placeholderTitle } of [
  { encrypted: false, beforeFirstSync: false },
  { encrypted: true, beforeFirstSync: false },
  { encrypted: false, beforeFirstSync: true },
  { encrypted: true, beforeFirstSync: true },
  { encrypted: true, beforeFirstSync: true, failure: 'upload' },
  { encrypted: true, beforeFirstSync: true, failure: 'conflict' },
  { encrypted: true, beforeFirstSync: true, failure: 'newer repair' },
  { encrypted: true, beforeFirstSync: true, failure: 'later collection' },
  { encrypted: false, beforeFirstSync: true, placeholderTitle: true },
  { encrypted: true, beforeFirstSync: true, placeholderTitle: true },
]) {
  test(`history repairs sync without repeated uploads, encrypted ${encrypted}, before first sync ${beforeFirstSync}, failure ${failure ?? 'none'}, title placeholder ${placeholderTitle === true}`, async ({ page }, testInfo) => {
    const record = { ...original, lengthSeconds: beforeFirstSync ? 100 : 0 }
    if (placeholderTitle) {
      Object.assign(record, {
        title: record.videoId,
        author: 'Recovered channel',
        published: Date.parse('2025-01-01'),
        lengthSeconds: 120,
        isLive: false,
        liveNow: false,
        isUpcoming: false,
      })
    }
    const metadata = { added_date: record.timeWatched, watched_state: 'completed', position_millis: record.watchProgress * 1000 }
    const server = encrypted ? await createTakeoutSyncServer() : null
    const receiverData = await createUserDataDir({ ...seed, history: [record] })
    let receiver
    let entries = beforeFirstSync ? [{ video: videoToRemote(record), metadata }] : []
    let writes = 0
    const url = server?.url ?? 'http://history-sync.test'
    const getHistory = async () => encrypted ? server.history() : entries
    const getRepairedEntry = async () => (await getHistory()).find(entry => entry.video.id === record.videoId)
    const settings = {
      syncServerUrl: url,
      syncServerToken: 'test-token',
      syncServerPrivacyMode: encrypted ? 'enhanced' : 'legacy',
      syncServerPrivacyKey: encrypted ? Buffer.alloc(32, 1).toString('base64') : '',
      syncServerPrivacySalt: encrypted ? Buffer.alloc(16, 2).toString('base64') : '',
      syncServerSyncHistory: true,
      syncServerSyncPlaylists: false,
      syncServerSyncSubscriptions: false,
      syncServerSyncProfiles: false,
      syncServerSyncWatchStats: false,
      syncServerSyncLiveReminders: false,
      syncServerSyncSessions: false,
      syncServerSyncSettings: false,
      syncServerSnapshot: beforeFirstSync ? JSON.stringify({ history: { [record.videoId]: metadata } }) : '{}',
    }
    const installServer = async page => {
      if (encrypted) {
        page.on('request', request => {
          if (request.method() === 'PUT' && new URL(request.url()).pathname === '/v1/encrypted_sync/history') writes++
        })
      } else {
        await page.route(`${url}/**`, async route => {
          const request = route.request()
          const pathname = new URL(request.url()).pathname
          let json = []
          if (pathname === '/health') json = { capabilities: { encrypted_sync: 0, bulk_sync: 1 } }
          else if (pathname.startsWith('/v1/watch_history/')) {
            if (request.method() === 'PUT') {
              writes++
              const payload = request.postDataJSON()
              entries = Array.isArray(payload) ? payload : [payload]
            }
            json = entries
          }
          await route.fulfill({ json })
        })
      }
    }
    try {
      if (beforeFirstSync) {
        if (encrypted) await server.setHistory(entries)
        await page.evaluate(record => window.$store.dispatch('updateSubscriptionHistory', { records: [record] }), record)
      }
      receiver = await launchApp(receiverData)
      await installServer(page)
      await installServer(receiver.page)
      await configureSync(page, settings, !beforeFirstSync)
      await configureSync(receiver.page, settings)
      expect(writes).toBe(beforeFirstSync ? 0 : 1)
      const originalWrites = writes
      const originalState = structuredClone((await getRepairedEntry()).metadata)
      if (failure) {
        if (failure === 'later collection') {
          await page.evaluate(async () => {
            const store = window.$store
            await store.dispatch('updateSyncServerSyncProfiles', true)
            await store.dispatch('createProfile', { name: 'Pending profile', subscriptions: [] })
          })
          let failed = false
          await page.route(`${url}/v1/encrypted_sync/profiles`, route => {
            if (route.request().method() !== 'PUT' || failed) return route.continue()
            failed = true
            return route.fulfill({ status: 503, json: { message: 'Injected later-collection failure' } })
          })
        }
        let injected = false
        await page.route(`${url}/v1/encrypted_sync/history`, async route => {
          if (route.request().method() !== 'PUT' || injected) return route.continue()
          injected = true
          if (failure === 'upload') {
            return route.fulfill({ status: 503, json: { message: 'Injected upload failure' } })
          }
          if (failure === 'newer repair' || failure === 'later collection') {
            const current = await page.evaluate(id => window.$store.getters.getHistoryCacheById[id], record.videoId)
            const patch = historyRepairPatch(current, { lengthSeconds: 130, isLive: false, isUpcoming: false })
            await page.evaluate(patch => window.$store.dispatch('updateSubscriptionHistory', { metadata: [patch] }), patch)
            return route.continue()
          }
          const other = { ...record, videoId: 'bcdefghijkl', title: 'Another device added this video', lengthSeconds: 60 }
          await server.setHistory([...(await server.history()), { video: videoToRemote(other), metadata }])
          await route.continue()
        })
      }

      await page.route('**/youtubei/v1/player*', route => route.fulfill({
        json: {
          videoDetails: {
            videoId: original.videoId,
            title: 'Recovered title',
            author: 'Recovered channel',
            channelId: original.authorId,
            lengthSeconds: '120',
          },
          microformat: { playerMicroformatRenderer: { publishDate: '2025-01-01' } },
        },
      }))
      await goTo(page, 'history')
      await page.clock.install()
      await page.evaluate(() => window.$store.dispatch('setSyncServerAutoSync', true))
      await page.getByRole('button', { name: 'Repair History', exact: true }).click()
      await page.getByRole('dialog', { name: 'Repair History' }).getByRole('button', { name: 'Start repair', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('Checked 1/1 · Repaired 1 · Failed 0')
      await page.clock.fastForward(30000)
      if (failure === 'upload') {
        await expect.poll(() => page.evaluate(() => window.$store.state.syncServer.syncServerStatus)).toBe('error')
        expect((await getRepairedEntry()).video.duration).toBe(100)
        const pending = await page.evaluate(id => window.$store.getters.getHistoryCacheById[id], record.videoId)
        expect(pending).toMatchObject({ lengthSeconds: 120, pendingDurationRepair: true })
        await sync(page)
      }
      await expect.poll(async () => (await getRepairedEntry()).video.duration).toBe(120)
      await expect.poll(async () => (await getRepairedEntry()).video.title).toBe('Recovered title')
      const hasNewerRepair = failure === 'newer repair' || failure === 'later collection'
      const finalDuration = hasNewerRepair ? 130 : 120
      if (hasNewerRepair) {
        await expect.poll(() => page.evaluate(() => window.$store.state.syncServer.syncServerStatus)).toBe(failure === 'later collection' ? 'error' : 'success')
        const pending = await page.evaluate(id => window.$store.getters.getHistoryCacheById[id], record.videoId)
        expect(pending).toMatchObject({ lengthSeconds: 130, pendingDurationRepair: true })
        await sync(page)
        await expect.poll(async () => (await getRepairedEntry()).video.duration).toBe(finalDuration)
      }
      await expect.poll(() => page.evaluate(id => window.$store.getters.getHistoryCacheById[id].pendingDurationRepair, record.videoId)).toBeUndefined()
      await page.evaluate(() => window.$store.dispatch('setSyncServerAutoSync', false))
      expect((await getRepairedEntry()).metadata).toEqual(originalState)
      expect((await getRepairedEntry()).video).toMatchObject({
        title: 'Recovered title',
        uploader: { id: original.authorId, name: 'Recovered channel' },
        duration: finalDuration,
        upload_date: Date.parse('2025-01-01'),
      })
      await sync(receiver.page)
      const received = await receiver.page.evaluate(id => window.$store.getters.getHistoryCacheById[id], original.videoId)
      expect(received).toMatchObject({
        title: 'Recovered title',
        author: 'Recovered channel',
        lengthSeconds: finalDuration,
        published: Date.parse('2025-01-01'),
        isLive: false,
        liveNow: false,
        isUpcoming: false,
        watchProgress: original.watchProgress,
        isWatched: original.isWatched,
        timeWatched: original.timeWatched,
      })
      for (let turn = 0; turn < 3; turn++) {
        await sync(page)
        await sync(receiver.page)
      }
      expect(writes).toBe(originalWrites + (failure ? 2 : 1))
      await goTo(receiver.page, 'history')
      await expect(receiver.page.getByText('Recovered title', { exact: true })).toBeVisible()
      await receiver.page.screenshot({ path: testInfo.outputPath('synced-history-repair.png') })
    } finally {
      await receiver?.electronApp.close()
      await rm(receiverData, { recursive: true, force: true })
      await server?.close()
    }
  })
}
