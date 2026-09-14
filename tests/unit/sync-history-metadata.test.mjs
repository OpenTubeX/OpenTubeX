import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const context = vm.createContext({})
vm.runInContext(source
  .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
  .replace(/^export \{[\s\S]*?\}\n/gm, '')
  .replace(/^export (?=(async )?(function|class|const))/gm, ''), context)

const remote = {
  video: {
    id: 'video-id', title: 'Bricks', duration: 0, upload_date: 100,
    uploader: { id: 'channel-id', name: 'Test channel' },
  },
  metadata: { added_date: 200, watched_state: 'completed', position_millis: 1000 },
}

async function downloadHistory(local = [], entry = remote) {
  const changes = []
  await context.syncHistory({
    getWatchHistory: async () => [entry],
    supportsBulkSync: async () => true,
  }, {
    state: { history: { historyCacheSorted: local } },
    dispatch: async (action, payload) => {
      assert.equal(action, 'applyHistorySyncChanges')
      changes.push(structuredClone(payload))
    },
  })
  return changes[0]
}

test('synced history with unknown duration does not label ordinary videos as live', async () => {
  const changes = await downloadHistory()
  assert.equal(changes.insertions[0].isLive, false)
  assert.equal(changes.insertions[0].isWatched, true)
})

const imported = {
  videoId: remote.video.id, title: remote.video.title,
  author: remote.video.uploader.name, authorId: remote.video.uploader.id,
  published: 200, timeWatched: 200, description: '',
  lengthSeconds: 0, isLive: true, isWatched: true, watchProgress: 1, type: 'video',
}

test('sync preserves imported live status when optional metadata is absent', async () => {
  assert.equal(await downloadHistory([imported]), undefined)
})

test('newer sync progress preserves a known video duration', async () => {
  const local = { ...imported, timeWatched: 100, lengthSeconds: 682, isLive: false }
  const changes = await downloadHistory([local])
  assert.equal(changes.updates[0].lengthSeconds, 682)
  assert.equal(changes.updates[0].timeWatched, 200)
  assert.equal(changes.updates[0].watchProgress, 1)
  assert.equal(changes.updates[0].isLive, false)
})

test('sync leaves an existing real livestream with its own publication date alone', async () => {
  const changes = await downloadHistory([{ ...imported, published: 50, isUpcoming: false, viewCount: 123 }])
  assert.equal(changes, undefined)
})

test('newer synced progress preserves imported live status without optional metadata', async () => {
  const local = { ...imported, timeWatched: 100 }
  const changes = await downloadHistory([local])
  assert.equal(changes.updates[0].isLive, true)
  assert.equal(changes.updates[0].timeWatched, 200)
})

test('newer synced progress preserves live status recorded by playback', async () => {
  const local = {
    ...imported,
    timeWatched: 100,
    isUpcoming: false,
    viewCount: 123,
    description: 'Streaming now',
  }
  const changes = await downloadHistory([local])
  assert.equal(changes.updates[0].isLive, true)
  assert.equal(changes.updates[0].timeWatched, 200)
  assert.equal(await downloadHistory(changes.updates), undefined)
})

test('a synced duration clears stale live and upcoming flags', async () => {
  const local = { ...imported, timeWatched: 100, isUpcoming: true, viewCount: 123 }
  const changes = await downloadHistory([local], {
    ...remote,
    video: { ...remote.video, duration: 682 },
  })
  assert.equal(changes.updates[0].isLive, false)
  assert.equal(changes.updates[0].isUpcoming, false)
  assert.equal(changes.updates[0].lengthSeconds, 682)
})
