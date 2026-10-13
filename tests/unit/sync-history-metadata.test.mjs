import { toRaw } from 'vue'
import { historyRepairPatch, needsHistoryRepair, repairHistory } from '../../src/historyRepair.js'
import { DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeIds as mergeSyncIds, videoToRemote as syncVideoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import { executeBackgroundJob as runBackgroundJob } from '../../src/renderer/helpers/background-job-operations.js'
import { EncryptedSyncAdapter } from '../../src/renderer/helpers/sync-server-privacy.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/renderer/helpers/sync-server.js', import.meta.url), 'utf8')
const context = vm.createContext({ DEFAULT_CHANNEL_AVATAR, UNKNOWN_SYNC_UPLOADER_ID, uploaderToLocal, normalizeChannelAvatar, enrichSyncVideo, mergeSyncIds, syncVideoToRemote, runBackgroundJob, toRaw })
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

test('newly synced history retains its video ID as the fallback title until repaired', async () => {
  const entry = structuredClone(remote)
  entry.video.id = 'abcdefghijk'
  entry.video.title = entry.video.id
  entry.video.duration = 120
  const changes = await downloadHistory([], entry)
  const repaired = changes.insertions[0]
  assert.equal(repaired.title, entry.video.id)
  const result = await repairHistory({
    records: [repaired],
    getRecord: () => repaired,
    fetchMetadata: async () => ({ title: 'Recovered title' }),
    saveMetadata: async patches => {
      assert.deepEqual(patches, [{ videoId: entry.video.id, title: 'Recovered title' }])
      Object.assign(repaired, patches[0])
      return { repaired: patches.length, failed: 0 }
    },
    signal: new AbortController().signal,
    onProgress: () => {},
  })
  assert.deepEqual(result, { total: 1, checked: 1, repaired: 1, failed: 0 })
  assert.equal(needsHistoryRepair(repaired), false)
  const uploaded = []
  await downloadHistory([repaired], entry, uploaded)
  assert.equal(uploaded.length, 1)
  assert.equal(uploaded[0].video.title, repaired.title)
  assert.equal(await downloadHistory([repaired], uploaded[0], uploaded), undefined)
  assert.equal(uploaded.length, 1)
})

for (const id of ['', UNKNOWN_SYNC_UPLOADER_ID]) {
  for (const name of [id, remote.video.uploader.id]) {
    test(`uploader enrichment replaces a placeholder name ${JSON.stringify(name)} while repairing ID ${JSON.stringify(id)}`, () => {
      const video = { ...remote.video, uploader: { id, name } }
      const enriched = enrichSyncVideo(video, remote.video)
      assert.equal(enriched.uploader.id, remote.video.uploader.id)
      assert.equal(enriched.uploader.name, remote.video.uploader.name)
      assert.equal(enrichSyncVideo(enriched, remote.video), enriched)
    })
  }
}

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

function historyDevice(record, savedSnapshot = [record.videoId]) {
  const records = [structuredClone(record)]
  let snapshot = structuredClone(savedSnapshot)
  return {
    records,
    get snapshot() { return JSON.parse(JSON.stringify(snapshot)) },
    async sync(server) {
      snapshot = structuredClone(await context.syncHistory({
        getWatchHistory: async () => structuredClone(server.entries),
        supportsBulkSync: async () => true,
        putWatchHistoryBulk: async entries => {
          if (server.failWrites > 0) {
            server.failWrites--
            throw new Error('Upload failed')
          }
          server.writes++
          server.entries = structuredClone(entries)
        },
      }, {
        state: { history: { historyCacheSorted: records } },
        dispatch: async (action, changes) => {
          assert.equal(action, 'applyHistorySyncChanges')
          for (const entry of [...changes.insertions, ...changes.updates]) {
            const index = records.findIndex(record => record.videoId === entry.videoId)
            if (index === -1) records.push(structuredClone(entry))
            else records[index] = structuredClone(entry)
          }
        },
      }, snapshot))
    },
  }
}

test('history repairs upload without watch-state changes and settle across two devices', async () => {
  const incomplete = { ...imported, title: '', author: '', published: 0 }
  const entry = structuredClone(remote)
  entry.video.title = incomplete.videoId
  entry.video.upload_date = 0
  entry.video.uploader.name = entry.video.uploader.id
  const server = { entries: [entry], writes: 0 }
  const laptop = historyDevice(incomplete)
  const phone = historyDevice(incomplete)
  await laptop.sync(server)
  await phone.sync(server)
  Object.assign(laptop.records[0], historyRepairPatch(laptop.records[0], {
    title: 'Recovered title', author: 'Recovered channel', authorId: incomplete.authorId,
    published: 100, lengthSeconds: 120, isLive: false, isUpcoming: false,
  }))
  await laptop.sync(server)
  assert.equal(server.writes, 1, 'a metadata-only repair must upload')
  assert.equal(server.entries[0].video.duration, 120)
  assert.equal(server.entries[0].video.title, 'Recovered title')
  assert.equal(server.entries[0].video.upload_date, 100)
  assert.deepEqual(server.entries[0].metadata, entry.metadata)
  await phone.sync(server)
  assert.equal(phone.records[0].lengthSeconds, 120)
  assert.equal(phone.records[0].author, 'Recovered channel')
  assert.equal(phone.records[0].title, 'Recovered title')
  assert.equal(phone.records[0].isLive, false)
  for (let turn = 0; turn < 4; turn++) {
    await laptop.sync(server)
    await phone.sync(server)
  }
  assert.equal(server.writes, 1, 'receiving metadata must not upload it back')
})

test('history repairs enrich newer remote watch state without rolling progress back', async () => {
  const laptop = historyDevice({ ...imported, lengthSeconds: 120, published: 300, timeWatched: 100 })
  const server = { entries: [{ ...structuredClone(remote), video: { ...remote.video, upload_date: 0 } }], writes: 0 }
  await laptop.sync(server)
  assert.equal(server.writes, 1)
  assert.equal(server.entries[0].video.duration, 120)
  assert.equal(server.entries[0].video.upload_date, 300)
  assert.deepEqual(server.entries[0].metadata, remote.metadata)
  assert.equal(laptop.records[0].timeWatched, remote.metadata.added_date)
  await laptop.sync(server)
  assert.equal(server.writes, 1)
})

test('conflicting history metadata does not alternate uploads between devices', async () => {
  const laptop = historyDevice({ ...imported, title: 'Laptop title', author: 'Laptop channel', published: 100, lengthSeconds: 120 })
  const phone = historyDevice({ ...imported, title: 'Phone title', author: 'Phone channel', published: 150, lengthSeconds: 125 })
  const server = { entries: [structuredClone(remote)], writes: 0 }
  for (let turn = 0; turn < 4; turn++) {
    await laptop.sync(server)
    await phone.sync(server)
  }
  assert.equal(server.writes, 1, 'only the missing duration needs uploading')
  assert.equal(server.entries[0].video.title, remote.video.title)
  assert.equal(server.entries[0].video.duration, 120)
})

for (const newerProgress of [false, true]) {
  test(`a duration repair before the first upgraded sync is preserved with newer progress ${newerProgress}`, async () => {
    const record = { ...imported, lengthSeconds: 100, isLive: true }
    const server = { entries: [{ ...structuredClone(remote), video: { ...remote.video, duration: 100 } }], writes: 0 }
    if (newerProgress) server.entries[0].metadata.added_date++
    const laptop = historyDevice(record, { [record.videoId]: remote.metadata })
    const phone = historyDevice(record, { [record.videoId]: remote.metadata })
    Object.assign(laptop.records[0], historyRepairPatch(laptop.records[0], {
      lengthSeconds: 120, isLive: false, isUpcoming: false,
    }))
    const watchState = structuredClone(server.entries[0].metadata)
    await laptop.sync(server)
    assert.equal(server.entries[0].video.duration, 120)
    assert.deepEqual(server.entries[0].metadata, watchState)
    for (let turn = 0; turn < 4; turn++) {
      await phone.sync(server)
      await laptop.sync(server)
    }
    assert.equal(phone.records[0].lengthSeconds, 120)
    assert.equal(server.writes, 1)
  })

  test(`a repaired known duration syncs once with newer remote progress ${newerProgress}`, async () => {
    const record = { ...imported, lengthSeconds: 100, isLive: false }
    const entry = { ...structuredClone(remote), video: { ...remote.video, duration: 100 } }
    const server = { entries: [entry], writes: 0 }
    const laptop = historyDevice(record)
    const phone = historyDevice(record)
    await laptop.sync(server)
    await phone.sync(server)
    Object.assign(laptop.records[0], historyRepairPatch(laptop.records[0], {
      lengthSeconds: 120.4, isLive: false, isUpcoming: false,
    }))
    if (newerProgress) {
      phone.records[0].timeWatched++
      phone.records[0].watchProgress = 50
      await phone.sync(server)
    }
    const originalState = structuredClone(server.entries[0].metadata)
    const originalWrites = server.writes
    await laptop.sync(server)
    await phone.sync(server)
    assert.equal(server.entries[0].video.duration, 120)
    assert.equal(phone.records[0].lengthSeconds, 120)
    assert.deepEqual(server.entries[0].metadata, originalState)
    for (let turn = 0; turn < 4; turn++) {
      await phone.sync(server)
      await laptop.sync(server)
    }
    assert.equal(server.writes, originalWrites + 1)
  })
}

for (const newerProgress of [false, true]) {
  test(`concurrent duration repairs settle after each explicit correction uploads once with newer progress ${newerProgress}`, async () => {
    const record = { ...imported, lengthSeconds: 100, isLive: false }
    const server = { entries: [{ ...structuredClone(remote), video: { ...remote.video, duration: 100 } }], writes: 0 }
    const laptop = historyDevice(record)
    const phone = historyDevice(record)
    await laptop.sync(server)
    await phone.sync(server)
    Object.assign(laptop.records[0], historyRepairPatch(laptop.records[0], { lengthSeconds: 120, isLive: false, isUpcoming: false }))
    Object.assign(phone.records[0], historyRepairPatch(phone.records[0], { lengthSeconds: 125, isLive: false, isUpcoming: false }))
    if (newerProgress) phone.records[0].timeWatched++
    for (let turn = 0; turn < 4; turn++) {
      await laptop.sync(server)
      await phone.sync(server)
    }
    assert.equal(laptop.records[0].lengthSeconds, 125)
    assert.equal(phone.records[0].lengthSeconds, 125)
    assert.equal(server.writes, 2)
  })
}

test('history sync replaces blank metadata and does not upload placeholder channel names', async () => {
  const entry = structuredClone(remote)
  entry.video.title = '   '
  entry.video.uploader.name = ''
  const blank = { ...imported, title: '   ', author: '' }
  const uploaded = []
  await downloadHistory([blank], entry, uploaded)
  assert.equal(uploaded.length, 0)
  const repaired = { ...blank, title: 'Recovered title', author: 'Recovered channel' }
  await downloadHistory([repaired], entry, uploaded)
  assert.equal(uploaded.length, 1)
  assert.equal(uploaded[0].video.title, repaired.title)
  assert.equal(uploaded[0].video.uploader.name, repaired.author)
  const received = await downloadHistory([blank], uploaded[0])
  assert.equal(received.updates[0].title, repaired.title)
  assert.equal(received.updates[0].author, repaired.author)
})

for (const failWrites of [0, 1]) {
  test(`successive unsynced duration repairs retain the latest correction with ${failWrites} failed uploads`, async () => {
    const record = { ...imported, lengthSeconds: 100, isLive: true, published: 0 }
    const server = { entries: [{ ...structuredClone(remote), video: { ...remote.video, duration: 100, upload_date: 0 } }], writes: 0, failWrites }
    const laptop = historyDevice(record, { [record.videoId]: remote.metadata })
    for (const lengthSeconds of [120, 130]) {
      Object.assign(laptop.records[0], historyRepairPatch(laptop.records[0], { lengthSeconds, isLive: false, isUpcoming: false }))
    }
    assert.equal(laptop.records[0].pendingDurationRepair, true)
    if (failWrites) {
      await assert.rejects(laptop.sync(server), /Upload failed/)
      assert.equal(laptop.records[0].pendingDurationRepair, true)
      assert.equal(laptop.records[0].lengthSeconds, 130)
    }
    await laptop.sync(server)
    assert.equal(server.entries[0].video.duration, 130)
    assert.equal(laptop.records[0].pendingDurationRepair, undefined)
    await laptop.sync(server)
    assert.equal(server.writes, 1)
  })
}

test('consumed repair markers cannot resurrect a superseded duration when a later repair returns to it', async () => {
  const record = { ...imported, lengthSeconds: 100, isLive: true, published: 0 }
  const server = { entries: [{ ...structuredClone(remote), video: { ...remote.video, duration: 100, upload_date: 0 } }], writes: 0 }
  const laptop = historyDevice(record)
  const phone = historyDevice(record)
  Object.assign(laptop.records[0], historyRepairPatch(laptop.records[0], { lengthSeconds: 120, isLive: false, isUpcoming: false }))
  Object.assign(phone.records[0], historyRepairPatch(phone.records[0], { lengthSeconds: 125, isLive: false, isUpcoming: false }))
  await laptop.sync(server)
  await phone.sync(server)
  assert.equal(laptop.records[0].pendingDurationRepair, undefined)
  assert.equal(phone.records[0].pendingDurationRepair, undefined)
  Object.assign(laptop.records[0], historyRepairPatch(laptop.records[0], { lengthSeconds: 100, isLive: false, isUpcoming: false }))
  for (let turn = 0; turn < 4; turn++) {
    await laptop.sync(server)
    await phone.sync(server)
  }
  assert.equal(laptop.records[0].lengthSeconds, 100)
  assert.equal(phone.records[0].lengthSeconds, 100)
  assert.equal(server.writes, 3)
})

test('a newer repair during an upload survives the stale-history retry', async () => {
  const record = { ...imported, lengthSeconds: 100, isLive: true, published: 0 }
  Object.assign(record, historyRepairPatch(record, { lengthSeconds: 120, isLive: false, isUpcoming: false }))
  const history = { historyCacheSorted: [record], historyRevision: 0 }
  let entry = { ...structuredClone(remote), video: { ...remote.video, duration: 100, upload_date: 0 } }
  let writes = 0
  await context.syncHistory({
    getWatchHistory: async () => [structuredClone(entry)],
    supportsBulkSync: async () => true,
    putWatchHistoryBulk: async entries => {
      entry = structuredClone(entries[0])
      if (++writes === 1) {
        Object.assign(record, historyRepairPatch(record, { lengthSeconds: 130, isLive: false, isUpcoming: false }))
        history.historyRevision++
      }
    },
  }, {
    state: { history },
    dispatch: async (action, changes) => {
      assert.equal(action, 'applyHistorySyncChanges')
      history.historyCacheSorted = structuredClone(changes.updates)
      history.historyRevision++
    },
  }, { [record.videoId]: remote.metadata })
  assert.equal(entry.video.duration, 130)
  assert.equal(history.historyCacheSorted[0].lengthSeconds, 130)
  assert.equal(history.historyCacheSorted[0].pendingDurationRepair, undefined)
  assert.equal(writes, 2)
})

for (const failure of ['upload failure', 'revision conflict']) {
  test(`encrypted staging preserves pending repairs through ${failure}`, async () => {
    const record = { ...imported, lengthSeconds: 100, isLive: true, published: 0 }
    Object.assign(record, historyRepairPatch(record, { lengthSeconds: 120, isLive: false, isUpcoming: false }))
    const records = [record]
    let serverHistory = [{ ...structuredClone(remote), video: { ...remote.video, duration: 100, upload_date: 0 } }]
    const store = {
      state: { history: { historyCacheSorted: records } },
      dispatch: async (action, changes) => {
        assert.equal(action, 'applyHistorySyncChanges')
        for (const entry of [...changes.insertions, ...changes.updates]) {
          const index = records.findIndex(record => record.videoId === entry.videoId)
          if (index === -1) records.push(structuredClone(entry))
          else records[index] = structuredClone(entry)
        }
      },
    }
    const stage = async () => {
      const adapter = new EncryptedSyncAdapter({ history: structuredClone(serverHistory) })
      await context.syncHistory(adapter, store, { [record.videoId]: remote.metadata })
      return adapter.document.history
    }
    const first = await stage()
    assert.equal(first[0].video.duration, 120)
    assert.equal(records[0].pendingDurationRepair, true, 'staging is not an accepted upload')
    assert.equal(serverHistory[0].video.duration, 100)
    if (failure === 'revision conflict') {
      serverHistory.push({ ...structuredClone(remote), video: { ...remote.video, id: 'other-video' } })
    }
    const retry = await stage()
    assert.equal(retry.find(entry => entry.video.id === record.videoId).video.duration, 120)
    assert.equal(records.find(entry => entry.videoId === record.videoId).lengthSeconds, 120)
    assert.equal(records.find(entry => entry.videoId === record.videoId).pendingDurationRepair, true)
    serverHistory = structuredClone(retry)
    const repeated = await stage()
    assert.deepEqual(repeated, serverHistory)
  })
}

test('two devices with equal watch timestamps and conflicting progress converge', async () => {
  const laptop = historyDevice({ ...imported, isWatched: false, watchProgress: 0 })
  const phone = historyDevice({ ...imported, isWatched: false, watchProgress: 169.743 })
  const server = { entries: [{ ...remote, metadata: { added_date: 200, watched_state: 'watching', position_millis: 169743 } }], writes: 0 }
  for (let turn = 0; turn < 4; turn++) {
    await laptop.sync(server)
    await phone.sync(server)
  }
  assert.equal(laptop.records[0].watchProgress, phone.records[0].watchProgress)
  const settledWrites = server.writes
  await laptop.sync(server)
  await phone.sync(server)
  assert.equal(server.writes, settledWrites)

  // Seeking backwards is a real edit even though timeWatched stays unchanged.
  const restarted = historyDevice(laptop.records[0], laptop.snapshot)
  restarted.records[0].watchProgress = 12
  await restarted.sync(server)
  await phone.sync(server)
  assert.equal(phone.records[0].watchProgress, 12)
  assert.equal(server.writes, settledWrites + 1)

  phone.records[0].isWatched = true
  await phone.sync(server)
  await restarted.sync(server)
  assert.equal(restarted.records[0].isWatched, true)
  phone.records[0].isWatched = false
  await phone.sync(server)
  await restarted.sync(server)
  assert.equal(restarted.records[0].isWatched, false)
  const finalWrites = server.writes
  await phone.sync(server)
  await restarted.sync(server)
  assert.equal(server.writes, finalWrites)
})
