import { test, expect } from '../../helpers/app.mjs'
import { encryptSyncDocument, decryptSyncDocument } from '../../../src/renderer/helpers/sync-server-privacy.js'

const key = Buffer.alloc(32, 1).toString('base64')
const salt = Buffer.alloc(16, 2).toString('base64')
const positions = [
  { url: 'https://videos.example.test/first', seconds: 12, duration: 60, updatedAt: 1000 },
  { url: 'https://videos.example.test/second', seconds: 0, watched: true, updatedAt: 2000 },
]

test.use({
  seed: {
    settings: {
      syncServerEnabled: false,
      syncServerAutoSync: false,
      syncServerUrl: 'https://sync-positions.example',
      syncServerToken: 'test-token',
      syncServerPrivacyMode: 'enhanced',
      syncServerPrivacyKey: key,
      syncServerPrivacySalt: salt,
      syncServerSyncHistory: true,
      syncServerSyncSubscriptions: false,
      syncServerSyncPlaylists: false,
      syncServerSyncProfiles: false,
      syncServerSyncSettings: false,
      syncServerSyncSessions: false,
      syncServerSyncWatchStats: false,
      syncServerSyncLiveReminders: false,
      syncServerSyncNotifications: false,
      historyRetentionDays: 0,
    },
  },
})

test('external positions settle across different storage orders and still sync edits', async ({ page }) => {
  const localOrder = await page.evaluate(positions => {
    for (const { url, ...position } of positions) localStorage.setItem(`externalMediaPosition:${url}`, JSON.stringify(position))
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter(key => key.startsWith('externalMediaPosition:'))
      .map(key => key.slice('externalMediaPosition:'.length))
  }, positions)
  // Another device enumerates these records in the opposite order.
  const remote = new Map([['externalMediaPositions', {
    revision: 1,
    payload: await encryptSyncDocument(localOrder.toReversed().map(url => positions.find(position => position.url === url)), key, salt),
  }]])
  let uploads = 0
  await page.route('https://sync-positions.example/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let json
    if (path === '/health') json = { capabilities: { encrypted_sync: 1, live_sync: 1, external_media_positions: 1 } }
    else if (path === '/v1/account/sessions') json = { sessions: [] }
    else if (path === '/v1/encrypted_sync/events') json = []
    else if (path === '/v1/encrypted_sync') {
      json = { collections: [...remote].map(([collection, { revision }]) => ({ collection, revision })), legacy_data: false }
    } else {
      const collection = path.split('/').at(-1)
      if (request.method() === 'PUT') {
        const { revision, payload } = request.postDataJSON()
        expect(revision).toBe(remote.get(collection)?.revision ?? 0)
        remote.set(collection, { revision: revision + 1, payload })
        if (collection === 'externalMediaPositions') uploads++
      }
      json = remote.get(collection) ?? { revision: 0, payload: null }
    }
    await route.fulfill({ json })
  })
  const sync = () => page.evaluate(async () => {
    await window.$store.dispatch('syncWithSyncServer')
    return window.$store.state.syncServer.syncServerStatus
  })
  await page.evaluate(() => window.$store.dispatch('updateSyncServerEnabled', true))
  for (let repeat = 0; repeat < 3; repeat++) expect(await sync()).toBe('success')
  expect(uploads).toBe(0)

  const changed = { ...positions[0], seconds: 25, updatedAt: 3000 }
  await page.evaluate(({ url, ...position }) => localStorage.setItem(`externalMediaPosition:${url}`, JSON.stringify(position)), changed)
  expect(await sync()).toBe('success')
  expect(uploads).toBe(1)
  const saved = remote.get('externalMediaPositions')
  const entries = await decryptSyncDocument(saved.payload, key)
  expect(entries.find(position => position.url === changed.url)).toEqual(changed)

  // An older peer can reorder its upload and make a real edit at the same time.
  const peerEdit = { url: positions[1].url, seconds: 30, duration: 60, watched: true, updatedAt: 4000 }
  remote.set('externalMediaPositions', {
    revision: saved.revision + 1,
    payload: await encryptSyncDocument(entries.toReversed().map(entry => entry.url === peerEdit.url ? peerEdit : entry), key, salt),
  })
  for (let repeat = 0; repeat < 3; repeat++) expect(await sync()).toBe('success')
  expect(uploads).toBe(1)
  const { url, ...expectedPosition } = peerEdit
  expect(await page.evaluate(url => JSON.parse(localStorage.getItem(`externalMediaPosition:${url}`)), url)).toEqual(expectedPosition)
})
