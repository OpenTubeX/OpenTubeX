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

async function downloadHistory(local = [], entry = remote, uploaded = []) {
  const changes = []
  await context.syncHistory({
    getWatchHistory: async () => [entry],
    supportsBulkSync: async () => true,
    putWatchHistoryBulk: async entries => uploaded.push(...structuredClone(entries)),
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


test('equal timestamps refresh duration and stale flags without discarding newer local progress', async () => {
  const local = { ...imported, watchProgress: 200, isWatched: false, isUpcoming: true }
  const entry = { ...remote, video: { ...remote.video, duration: 682 } }
  const uploaded = []
  const changes = await downloadHistory([local], entry, uploaded)
  assert.deepEqual(changes?.updates, [{
    ...local, lengthSeconds: 682, isLive: false, isUpcoming: false,
  }])
  assert.equal(uploaded.length, 1)
  assert.equal(uploaded[0].video.duration, 682)
  assert.deepEqual(uploaded[0].metadata, {
    added_date: local.timeWatched, watched_state: 'watching', position_millis: 200000,
  })
})

test('equal timestamps persist remote metadata even when watch state already matches', async () => {
  const entry = { ...remote, video: { ...remote.video, duration: 682 } }
  const uploaded = []
  const changes = await downloadHistory([imported], entry, uploaded)
  assert.equal(changes?.updates[0].lengthSeconds, 682)
  assert.equal(changes.updates[0].isLive, false)
  assert.equal(changes.updates[0].watchProgress, imported.watchProgress)
  assert.equal(changes.updates[0].isWatched, imported.isWatched)
  assert.equal(uploaded.length, 0)
  assert.equal(await downloadHistory(changes.updates, entry), undefined)
})

for (const duration of [null, 0, '', '0:00', undefined]) {
  test(`newer local history with unknown duration ${JSON.stringify(duration)} preserves the known server duration`, async () => {
    const local = {
      ...imported, lengthSeconds: duration, isLive: false,
      timeWatched: 300, watchProgress: 200, isWatched: false,
    }
    const entry = { ...remote, video: { ...remote.video, duration: 682 } }
    const uploaded = []
    const changes = await downloadHistory([local], entry, uploaded)
    assert.equal(uploaded.length, 1)
    assert.equal(uploaded[0].video.duration, 682)
    assert.deepEqual(uploaded[0].metadata, {
      added_date: 300, watched_state: 'watching', position_millis: 200000,
    })
    assert.deepEqual(changes?.updates, [{
      ...local, lengthSeconds: 682, isLive: false, isUpcoming: false,
    }])
    const received = await downloadHistory([], uploaded[0])
    assert.equal(received.insertions[0].lengthSeconds, 682)
    assert.equal(received.insertions[0].isLive, false)
    assert.equal(await downloadHistory(changes.updates, uploaded[0]), undefined)
  })
}

test('newer local history keeps its own known duration when uploading', async () => {
  const local = { ...imported, lengthSeconds: 700, isLive: false, timeWatched: 300 }
  const uploaded = []
  const changes = await downloadHistory([local], {
    ...remote, video: { ...remote.video, duration: 682 },
  }, uploaded)
  assert.equal(changes, undefined)
  assert.equal(uploaded[0].video.duration, 700)
})
