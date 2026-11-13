import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import {
  readLegacyExternalMediaPositions,
  removeLegacyExternalMediaPositions,
} from '../../src/renderer/helpers/externalMediaHistory.js'
import { mergeHistory } from '../../src/renderer/helpers/sync-history-merge.js'

let storage
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
beforeEach(() => {
  storage = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return storage.size },
      key: index => [...storage.keys()][index] ?? null,
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    }
  })
})
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else delete globalThis.localStorage
})

const position = (url, value) => storage.set(`externalMediaPosition:${url}`, typeof value === 'string' ? value : JSON.stringify(value))

test('saved external positions become history records and are then removed', () => {
  position('https://videos.example.test/partly', { seconds: 12, duration: 60, updatedAt: 3000 })
  position('https://videos.example.test/finished', { seconds: 0, watched: true, updatedAt: 2000 })
  position('https://videos.example.test/played-since', { seconds: 30, updatedAt: 2000 })
  position('https://videos.example.test/expired', { seconds: 5, updatedAt: 500 })
  position('https://videos.example.test/damaged', '{')
  position('ftp://videos.example.test/unsupported', { seconds: 5, updatedAt: 2000 })
  storage.set('unrelated', 'kept')

  const played = { videoId: 'https://videos.example.test/played-since', watchProgress: 45 }
  const { records, keys } = readLegacyExternalMediaPositions({ [played.videoId]: played }, 1000)

  assert.deepEqual(records.map(({ videoId, watchProgress, lengthSeconds, isWatched, timeWatched }) =>
    ({ videoId, watchProgress, lengthSeconds, isWatched, timeWatched })), [
    { videoId: 'https://videos.example.test/partly', watchProgress: 12, lengthSeconds: 60, isWatched: false, timeWatched: 3000 },
    { videoId: 'https://videos.example.test/finished', watchProgress: 0, lengthSeconds: 0, isWatched: true, timeWatched: 2000 },
  ])
  removeLegacyExternalMediaPositions(keys)
  assert.deepEqual([...storage.keys()], ['unrelated'])
})

test('only encrypted sync uploads media from other sites', () => {
  const record = {
    videoId: 'https://videos.example.test/episode',
    title: 'Episode',
    author: '',
    authorId: '',
    lengthSeconds: 60,
    watchProgress: 12,
    isWatched: false,
    timeWatched: 3000,
  }
  for (const encrypted of [false, true]) {
    const { historyToUpload } = mergeHistory({
      localHistory: [record],
      remoteHistory: [],
      options: { allowMissingUploader: encrypted, allowExternalMedia: encrypted },
    })
    assert.deepEqual(historyToUpload.map(entry => entry.video.id), encrypted ? [record.videoId] : [])
  }
})
