import { createServer } from 'node:http'
import { expect } from '@playwright/test'
import { decryptSyncDocument, encryptSyncDocument } from '../../src/renderer/helpers/sync-server-privacy.js'
import { parseTakeoutPlaylistCsv } from '../../src/renderer/helpers/youtube-takeout-zip.js'

const key = Buffer.alloc(32, 1).toString('base64')
const salt = Buffer.alloc(16, 2).toString('base64')

export async function createTakeoutSyncServer() {
  const collections = new Map()
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
    if (request.method === 'OPTIONS') return response.end()
    const path = new URL(request.url, 'http://localhost').pathname
    let data
    if (path === '/health') data = { capabilities: { encrypted_sync: 1, live_sync: 1 } }
    else if (path === '/v1/encrypted_sync') {
      data = { collections: [...collections].map(([collection, value]) => ({ collection, revision: value.revision })), legacy_data: false }
    } else if (path.startsWith('/v1/encrypted_sync/')) {
      const collection = path.split('/').at(-1)
      if (request.method === 'PUT') {
        let body = ''
        for await (const chunk of request) body += chunk
        const { revision, payload } = JSON.parse(body)
        if (revision !== (collections.get(collection)?.revision ?? 0)) {
          response.writeHead(409)
          return response.end()
        }
        collections.set(collection, { revision: revision + 1, payload })
      }
      data = collections.get(collection) ?? { revision: 0, payload: null }
    } else data = { sessions: [] }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(data))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async playlists() {
      return decryptSyncDocument(collections.get('playlists').payload, key)
    },
    async history() {
      return decryptSyncDocument(collections.get('history').payload, key)
    },
    async setHistory(entries) {
      collections.set('history', {
        revision: (collections.get('history')?.revision ?? 0) + 1,
        payload: await encryptSyncDocument(entries, key, salt),
      })
    },
    async close() {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

export async function verifyTakeoutPlaylistSync(page, server, onDownloaded = async () => {}) {
  const playlist = {
    _id: 'takeout-sync-regression',
    ...parseTakeoutPlaylistCsv(
      'Video ID,Playlist Video Creation Timestamp\nabcdefghijk,2025-01-01T00:00:00Z\n-abcdefghij,2025-01-02T00:00:00Z\nabcdefghijk,2025-01-03T00:00:00Z',
      'Imported-videos.csv'
    )
  }
  const settings = {
    syncServerAutoSync: false,
    syncServerEnabled: false,
    syncServerUrl: server.url,
    syncServerToken: 'test-token',
    syncServerPrivacyMode: 'enhanced',
    syncServerPrivacyKey: key,
    syncServerPrivacySalt: salt,
    syncServerSnapshot: '{}',
    syncServerSyncPlaylists: true,
    syncServerSyncSubscriptions: false,
    syncServerSyncProfiles: false,
    syncServerSyncHistory: false,
    syncServerSyncWatchStats: false,
    syncServerSyncLiveReminders: false,
    syncServerSyncSessions: false,
    syncServerSyncSettings: false,
  }
  const historyId = playlist.videos[0].videoId
  const originalHistory = await page.evaluate(async id => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    if (store.state.playlists.libraryPaged) await store.dispatch('hydrateVideoState', [id])
    const record = store.getters.getHistoryCacheById[id]
    return record ? JSON.parse(JSON.stringify(record)) : null
  }, historyId)
  const original = await page.evaluate(async settings => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
    const original = Object.fromEntries(Object.keys(settings).map(key => [key, store.state.settings[key]]))
    await store.dispatch('updateSyncServerAutoSync', false)
    await store.dispatch('updateSyncServerEnabled', false)
    for (const [key, value] of Object.entries(settings)) {
      await store.dispatch(`update${key[0].toUpperCase()}${key.slice(1)}`, value)
    }
    return original
  }, settings)
  try {
    const originalVideos = await page.evaluate(async playlist => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('importPlaylist', playlist)
      const saved = store.state.playlists.libraryPaged
        ? await window.ftElectron.libraryQuery('playlistSnapshot', { id: playlist._id })
        : store.getters.getPlaylist(playlist._id)
      const videos = JSON.parse(JSON.stringify(saved.videos))
      await store.dispatch('updateSyncServerEnabled', true)
      await store.dispatch('syncWithSyncServer')
      return videos
    }, playlist)
    expect(await page.evaluate(async id => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const saved = store.state.playlists.libraryPaged
        ? await window.ftElectron.libraryQuery('playlistSnapshot', { id })
        : store.getters.getPlaylist(id)
      return saved.videos
    }, playlist._id)).toStrictEqual(originalVideos)
    const expected = [...new Set(playlist.videos.map(video => video.videoId))]
    expect((await server.playlists()).find(entry => entry.playlist.id === playlist._id).videos.map(video => video.id)).toEqual(expected)
    // Reset this installation's playlist and baseline to emulate a fresh receiver.
    await page.evaluate(async id => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('removePlaylist', id)
      await store.dispatch('updateSyncServerSnapshot', '{}')
      await store.dispatch('syncWithSyncServer')
    }, playlist._id)
    await expect.poll(() => page.evaluate(async id => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const saved = store.state.playlists.libraryPaged
        ? await window.ftElectron.libraryQuery('playlistSnapshot', { id })
        : store.getters.getPlaylist(id)
      return saved?.videos.map(video => video.videoId)
    }, playlist._id)).toStrictEqual(expected)
    expect(await page.evaluate(async id => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const saved = store.state.playlists.libraryPaged
        ? await window.ftElectron.libraryQuery('playlistSnapshot', { id })
        : store.getters.getPlaylist(id)
      return saved.videos.every(video => video.author == null && video.authorId == null)
    }, playlist._id)).toBe(true)
    await onDownloaded()
    await page.evaluate(async ({ id, historyId }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      const saved = store.state.playlists.libraryPaged
        ? await window.ftElectron.libraryQuery('playlistSnapshot', { id })
        : store.getters.getPlaylist(id)
      const video = saved.videos.find(video => video.videoId === historyId)
      await store.dispatch('removeFromHistory', historyId)
      await store.dispatch('updateHistory', { ...video, timeWatched: 100, isWatched: true })
      await store.dispatch('updateSyncServerSyncHistory', true)
      await store.dispatch('syncWithSyncServer')
      await store.dispatch('syncWithSyncServer')
    }, { id: playlist._id, historyId })
    expect((await server.history()).find(entry => entry.video.id === historyId)?.metadata.watched_state).toBe('completed')
    const history = await server.history()
    const entry = history.find(entry => entry.video.id === historyId)
    const knownVideo = {
      ...entry.video,
      title: 'Actual title',
      upload_date: 123,
      duration: 500,
      thumbnail_url: 'https://example.com/video.jpg',
      uploader: { ...entry.video.uploader, id: 'known-channel', name: 'Known channel', avatar: 'https://example.com/channel.jpg' },
    }
    const syncHistory = async () => page.evaluate(() => {
      return document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('syncWithSyncServer')
    })
    await server.setHistory(history.map(item => item === entry
      ? { ...entry, video: knownVideo, metadata: { ...entry.metadata, added_date: 50 } }
      : item))
    await syncHistory()
    expect((await server.history()).find(entry => entry.video.id === historyId).video).toEqual(knownVideo)
    // A newer watch-state edit from an imported copy must also retain local details.
    await server.setHistory(history.map(item => item === entry
      ? { ...entry, metadata: { added_date: 200, watched_state: 'watching', position_millis: 42_000 } }
      : item))
    await syncHistory()
    expect(await page.evaluate(async id => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      if (store.state.playlists.libraryPaged) await store.dispatch('hydrateVideoState', [id])
      const record = store.getters.getHistoryCacheById[id]
      return { title: record.title, authorId: record.authorId, watchProgress: record.watchProgress, timeWatched: record.timeWatched }
    }, historyId)).toEqual({ title: knownVideo.title, authorId: knownVideo.uploader.id, watchProgress: 42, timeWatched: 200 })
    await page.evaluate(async id => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateHistory', { ...store.getters.getHistoryCacheById[id], timeWatched: 300, isWatched: true })
    }, historyId)
    await syncHistory()
    expect((await server.history()).find(entry => entry.video.id === historyId).video).toEqual(knownVideo)
    expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.syncServer.syncServerStatus)).toBe('success')
  } finally {
    await page.evaluate(async ({ original, id, historyId, originalHistory }) => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store
      await store.dispatch('updateSyncServerEnabled', false)
      await store.dispatch('removePlaylist', id)
      await store.dispatch('removeFromHistory', historyId)
      if (originalHistory) await store.dispatch('updateHistory', originalHistory)
      for (const [key, value] of Object.entries(original)) {
        if (key === 'syncServerEnabled' || key === 'syncServerAutoSync') continue
        await store.dispatch(`update${key[0].toUpperCase()}${key.slice(1)}`, value)
      }
      await store.dispatch('updateSyncServerEnabled', original.syncServerEnabled)
      await store.dispatch('updateSyncServerAutoSync', original.syncServerAutoSync)
    }, { original, id: playlist._id, historyId, originalHistory })
  }
}
