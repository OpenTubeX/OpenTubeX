import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { EventEmitter } from 'node:events'
import { setImmediate } from 'node:timers/promises'
import { LibraryEngine } from '../../src/datastores/sqlite/engine.js'
import { LibrarySync } from '../../src/datastores/sqlite/sync.js'
import { SCHEMA_SQL } from '../../src/datastores/sqlite/schema.js'
import { LibraryJobs } from '../../src/main/libraryJobs.js'
import { videoToRemote } from '../../src/renderer/helpers/sync-history-merge.js'
import { syncSnapshotSection } from '../../src/datastores/sqlite/operations.js'

function fixture(t) {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON;' + SCHEMA_SQL)
  t.after(() => database.close())
  const engine = new LibraryEngine(database)
  return { engine, sync: new LibrarySync(engine) }
}
const video = i => ({ videoId: String(i).padStart(11, '0'), authorId: 'channel', author: 'Author', title: `Video ${i}`, lengthSeconds: 100, timeWatched: i + 1, watchProgress: 5, isWatched: false })

for (const preference of [undefined, true, false, null]) {
  test(`watch-stat snapshot respects the default and stored preference: ${preference}`, async t => {
    const { engine } = fixture(t)
    const snapshot = { history: { retained: { progress: 42 } } }
    const settings = { syncServerEnabled: true, syncServerUrl: 'server', syncServerToken: 'token', syncServerSnapshot: JSON.stringify(snapshot) }
    if (preference !== undefined) settings.syncServerSyncWatchStats = preference
    await engine.collections.settings.insertAsync(Object.entries(settings).map(([_id, value]) => ({ _id, value })))
    const watchStats = [{ deviceId: 'device', days: { '2026-10-13': 60 } }]
    const result = await syncSnapshotSection(engine, { account: ['server', 'token', 'legacy', '', ''], collection: 'watchStats', value: watchStats })
    const enabled = preference === undefined || preference === true
    assert.equal(result.updated, enabled)
    assert.deepEqual(JSON.parse((await engine.collections.settings.findOneAsync({ _id: 'syncServerSnapshot' })).value), enabled ? { ...snapshot, watchStats } : snapshot)
  })
}

for (const enabled of [false, true]) {
  for (const changedAccount of [false, true]) {
    test(`playlist acknowledgements retain unrelated snapshots when enabled=${enabled} accountChanged=${changedAccount}`, async t => {
      const { engine } = fixture(t)
      const snapshot = { history: { kept: { progress: 42 } }, profiles: ['kept'], playlists: { p: { remoteId: 'remote', metadata: { title: 'Before' }, videos: ['kept', 'removed'], unknown: { keep: true } }, other: { videos: ['other'] } } }
      const settings = { syncServerEnabled: enabled, syncServerUrl: 'server', syncServerToken: changedAccount ? 'different' : 'token', syncServerPrivacyMode: 'legacy', syncServerPrivacyKey: '', syncServerPrivacySalt: '', syncServerSnapshot: JSON.stringify(snapshot) }
      await engine.collections.settings.insertAsync(Object.entries(settings).map(([_id, value]) => ({ _id, value })))
      const result = await syncSnapshotSection(engine, { account: ['server', 'token', 'legacy', '', ''], collection: 'playlists', value: { id: 'p', remoteId: 'remote', metadata: { title: 'Written remotely' }, acknowledged: { upserts: ['added'], deletions: ['removed'] } } })
      assert.equal(result.updated, !changedAccount)
      assert.deepEqual(JSON.parse((await engine.collections.settings.findOneAsync({ _id: 'syncServerSnapshot' })).value), changedAccount ? snapshot : { ...snapshot, playlists: { ...snapshot.playlists, p: { ...snapshot.playlists.p, videos: ['kept', 'added'] } } })
    })
  }
}

for (const value of [undefined, null, false, 42, 'retained', { unknown: new Date(1) }, new Date(2)]) {
  test(`playlist sync skips unsupported memberships without losing data or blocking later playlists: ${String(value)}`, async t => {
    const { engine, sync } = fixture(t)
    const original = { _id: 'p', playlistName: 'Retained', description: '', lastUpdatedAt: 1, unknown: new Date(3), ...(value === undefined ? {} : { videos: value }) }
    await engine.collections.playlists.insertAsync(original)
    await engine.collections.playlists.insertAsync({ _id: 'later', playlistName: 'Later', videos: [video(1)] })
    for (const playlistId of ['p', 'later']) {
      const job = await sync.start({ kind: 'playlist', playlistId, metadata: { title: 'Remote changed title', description: 'Remote changed description' } })
      await sync.chunk({ ...job, section: 'remote', records: [videoToRemote(video(2))] })
      const plan = await sync.plan(job)
      if (playlistId === 'p') {
        assert.equal(plan.skipped, true)
        assert.deepEqual(plan.counts, { playlistUploads: 0, playlistRemovals: 0, playlistIds: 0, playlistMembers: 0 })
        for (const section of ['playlistUploads', 'playlistRemovals', 'playlistIds']) assert.deepEqual((await sync.page({ ...job, section })).records, [])
        assert.equal(await sync.apply(job, {}), true)
        assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), original)
      } else {
        assert.equal(plan.counts.playlistMembers, 2)
        assert.equal(await sync.apply(job, {}), true)
        assert.deepEqual((await engine.playlistSnapshot({ id: 'later' })).videos.map(video => video.videoId), [video(1).videoId, video(2).videoId])
      }
      await sync.cancel(job)
    }
    assert.equal(engine.prepare('SELECT count(*) AS count FROM sync_jobs').get().count, 0)
    assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), original)
  })
}

for (const removed of [false, true]) {
  test(`playlist sync retains opaque members while syncing valid uploads and remote additions: deletion ${removed}`, async t => {
    const { engine, sync } = fixture(t)
    const opaque = [null, false, 42, 'retained', { unknown: new Date(1) }]
    const videos = [...opaque, { ...video(1), playlistItemId: 'first', unknown: new Date(2) }, { ...video(1), playlistItemId: 'second' }]
    const original = { _id: 'p', playlistName: 'Retained', description: 'Description', protected: true, lastUpdatedAt: 1, unknown: new Date(3), videos }
    await engine.collections.playlists.insertAsync(original)
    const identities = engine.prepare("SELECT membership_id FROM members WHERE collection = 'playlists' AND record_id = 'p' ORDER BY position").all().map(row => row.membership_id)
    const job = await sync.start({ kind: 'playlist', playlistId: 'p', metadata: { title: original.playlistName, description: original.description } })
    await sync.chunk({ ...job, section: 'remote', records: [videoToRemote(video(2))] })
    if (removed) await sync.chunk({ ...job, section: 'previous', records: [video(1).videoId] })
    const plan = await sync.plan(job)
    const retained = removed ? opaque : videos
    assert.equal(plan.counts.playlistMembers, retained.length + 1)
    assert.deepEqual((await sync.page({ ...job, section: 'playlistUploads' })).records, removed ? [] : [videoToRemote(video(1))])
    assert.deepEqual((await sync.page({ ...job, section: 'playlistIds' })).records, removed ? [video(2).videoId] : [video(1).videoId, video(2).videoId])
    assert.equal(await sync.apply(job, {}), true)
    const saved = await engine.playlistSnapshot({ id: 'p' }), added = saved.videos.at(-1)
    assert.deepEqual(added, { videoId: video(2).videoId, title: video(2).title, author: 'Author', authorId: 'channel', lengthSeconds: 100, published: 0, timeAdded: added.timeAdded, playlistItemId: added.playlistItemId, type: 'video' })
    assert.ok(Number.isSafeInteger(added.timeAdded))
    assert.match(added.playlistItemId, /^[\da-f-]{36}$/)
    assert.deepEqual(saved, { ...original, lastUpdatedAt: saved.lastUpdatedAt, videos: [...retained, added] })
    assert.deepEqual(engine.prepare("SELECT membership_id FROM members WHERE collection = 'playlists' AND record_id = 'p' ORDER BY position LIMIT ?").all(retained.length).map(row => row.membership_id), identities.slice(0, retained.length))
    await sync.cancel(job)
  })
}

for (const field of ['playlistName', 'description']) {
  for (const beforeStart of [false, true]) {
    test(`playlist sync rejects a newer ${field} edit ${beforeStart ? 'before startup' : 'before planning'}`, async t => {
      const { engine, sync } = fixture(t)
      const original = { _id: 'p', playlistName: 'Before', description: 'Original description', protected: true, videos: [video(1)], unknown: new Date(1) }
      await engine.collections.playlists.insertAsync(original)
      const expectedMetadata = { playlistName: original.playlistName, description: original.description }
      const edit = () => engine.collections.playlists.updateAsync({ _id: 'p' }, { $set: { [field]: 'Saved in another window' } })
      if (beforeStart) await edit()
      const job = await sync.start({ kind: 'playlist', playlistId: 'p', metadata: { title: original.playlistName, description: original.description }, expectedMetadata })
      if (!beforeStart) await edit()
      await assert.rejects(sync.plan(job), /playlist changed during sync/i)
      assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), { ...original, [field]: 'Saved in another window' })
      assert.equal(sync.job(job.id).ready, false)
      await sync.cancel(job)
    })
  }
}

test('playlist sync cannot replace a playlist created after the original absent snapshot', async t => {
  const { engine, sync } = fixture(t)
  const created = { _id: 'p', playlistName: 'Created locally', description: '', videos: [video(1)], unknown: true }
  await engine.collections.playlists.insertAsync(created)
  const job = await sync.start({ kind: 'playlist', playlistId: 'p', metadata: { title: 'Remote', description: 'Remote' }, expectedMetadata: null })
  await assert.rejects(sync.plan(job), /playlist changed during sync/i)
  assert.deepEqual(await engine.playlistSnapshot({ id: 'p' }), created)
  await sync.cancel(job)
})

for (const commit of [false, true]) {
  test(`sync startup waits for an unrelated transaction to ${commit ? 'commit' : 'roll back'}`, async t => {
    const { engine, sync } = fixture(t)
    const entered = Promise.withResolvers()
    const resume = Promise.withResolvers()
    const owner = engine.transaction(async () => {
      await engine.collections.history.insertAsync({ ...video(1), _id: 'transient' })
      entered.resolve()
      await resume.promise
      if (!commit) throw new Error('abort owner')
    }).then(() => true, error => { assert.match(error.message, /abort owner/); return false })
    await entered.promise
    let completed = false
    const starting = Promise.resolve(sync.start({})).then(job => { completed = true; return job })
    await setImmediate()
    const early = completed
    resume.resolve()
    assert.equal(await owner, commit)
    const job = await starting
    await sync.chunk({ ...job, section: 'remote', records: [] })
    assert.equal((await sync.plan(job)).counts.historyToUpload, commit ? 1 : 0)
    assert.equal(early, false, 'startup must not report success inside another request\'s transaction')
    await sync.cancel(job)
  })
}

for (const kind of ['history', 'playlist']) {
  for (const commit of [false, true]) {
    test(`${kind} sync planning waits for another transaction to ${commit ? 'commit' : 'roll back'}`, async t => {
      const { engine, sync } = fixture(t)
      const collection = engine.collections[kind === 'history' ? 'history' : 'playlists']
      const original = kind === 'history'
        ? { ...video(1), _id: 'kept', unknown: new Date(123) }
        : { _id: 'p', playlistName: 'Protected', protected: true, videos: [video(1)], unknown: new Date(123) }
      const incoming = { ...video(2), _id: 'incoming', unknown: { keep: true } }
      await collection.insertAsync(original)
      const job = await sync.start({ kind, playlistId: 'p', metadata: { title: 'Protected' } })
      const entered = Promise.withResolvers()
      const resume = Promise.withResolvers()
      const owner = engine.transaction(async () => {
        if (kind === 'history') {
          await collection.updateAsync({ _id: 'kept' }, { $set: { title: 'Transient title' } })
          await collection.insertAsync(incoming)
        } else await collection.updateAsync({ _id: 'p' }, { $push: { videos: incoming } })
        entered.resolve()
        await resume.promise
        if (!commit) throw new Error('abort import')
      }).then(() => true, error => { assert.match(error.message, /abort import/); return false })
      await entered.promise
      let completed = false
      const planning = sync.plan(job).then(result => { completed = true; return result })
      await setImmediate()
      const completedBeforeOwner = completed
      const section = kind === 'history' ? 'historyToUpload' : 'playlistUploads'
      const earlyPage = completed ? await sync.page({ ...job, section }) : null
      resume.resolve()
      assert.equal(await owner, commit)
      const plan = await planning
      assert.equal(completedBeforeOwner, false, `planning exposed an uncommitted upload page: ${JSON.stringify(earlyPage)}`)
      const expected = commit
        ? kind === 'history' ? { ...original, title: 'Transient title' } : { ...original, videos: [...original.videos, incoming] }
        : original
      assert.deepEqual(await collection.findOneAsync({ _id: original._id }), expected)
      const records = kind === 'history' ? [expected, ...(commit ? [incoming] : [])] : expected.videos
      const uploads = records.map(record => kind === 'history'
        ? { video: videoToRemote(record), metadata: { added_date: record.timeWatched, watched_state: 'watching', position_millis: 5000 } }
        : videoToRemote(record))
      assert.equal(plan.revision, engine.revision(kind === 'history' ? 'history' : 'playlists'))
      assert.deepEqual(await sync.page({ ...job, section }), { records: uploads, current: true })
      await sync.cancel(job)
    })
  }
}

for (const kind of ['history', 'playlist']) {
  for (const commit of [false, true]) {
    test(`${kind} sync output pages wait for another transaction to ${commit ? 'commit' : 'roll back'}`, async t => {
      const { engine, sync } = fixture(t)
      const collection = engine.collections[kind === 'history' ? 'history' : 'playlists']
      const original = kind === 'history'
        ? { ...video(1), _id: 'kept', unknown: new Date(123) }
        : { _id: 'p', playlistName: 'Protected', protected: true, videos: [video(1)], unknown: new Date(123) }
      await collection.insertAsync(original)
      const job = await sync.start({ kind, playlistId: 'p', metadata: { title: 'Protected' } })
      await sync.plan(job)
      const options = { ...job, section: kind === 'history' ? 'historyToUpload' : 'playlistUploads' }
      const planned = await sync.page(options)
      const entered = Promise.withResolvers()
      const resume = Promise.withResolvers()
      const owner = engine.transaction(async () => {
        await collection.updateAsync({ _id: original._id }, { $set: { title: 'Transient title' } })
        assert.deepEqual(await sync.page(options), { ...planned, current: false })
        entered.resolve()
        await resume.promise
        if (!commit) throw new Error('abort owner')
      }).then(() => true, error => { assert.match(error.message, /abort owner/); return false })
      await entered.promise
      let completed = false
      const reading = Promise.resolve(sync.page(options)).then(page => { completed = true; return page })
      await setImmediate()
      const early = completed
      resume.resolve()
      assert.equal(await owner, commit)
      assert.deepEqual(await reading, { ...planned, current: !commit })
      assert.equal(early, false, 'sync output must not expose an unrelated transaction revision')
      assert.deepEqual(await collection.findOneAsync({ _id: original._id }), commit ? { ...original, title: 'Transient title' } : original)
      await sync.cancel(job)
    })
  }
}

test('playlist sync preserves every duplicate, stable identity, order, unknown data and protected state', async t => {
  const { engine, sync } = fixture(t)
  const videos = [{ ...video(1), playlistItemId: 'same', future: { keep: true } }, { ...video(1), playlistItemId: 'same', title: 'Second copy' }, { videoId: 'incomplete', unknown: true }]
  await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Protected', protected: true, createdAt: 0, videos })
  const before = engine.playlistPage({ id: 'p' }).records.map(record => record._libraryMemberId)
  const job = await sync.start({ kind: 'playlist', playlistId: 'p', metadata: { title: 'Renamed', description: '' } })
  await sync.chunk({ ...job, section: 'remote', records: [videoToRemote(video(1)), videoToRemote(video(2))] })
  const plan = await sync.plan(job)
  assert.equal(plan.counts.playlistMembers, 4)
  assert.equal(await sync.apply(job, {}), true)
  const stored = await engine.playlistSnapshot({ id: 'p' })
  assert.deepEqual(stored.videos.slice(0, 3), videos)
  assert.equal(stored.videos[3].videoId, video(2).videoId)
  assert.equal(stored.protected, true)
  assert.equal(stored.createdAt, 0)
  assert.deepEqual(engine.playlistPage({ id: 'p' }).records.slice(0, 3).map(record => record._libraryMemberId), before)
  await sync.cancel(job)
})

test('sync rejects a stale plan after a second window changes the durable playlist', async t => {
  const { engine, sync } = fixture(t)
  await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Before', videos: [video(1)] })
  const job = await sync.start({ kind: 'playlist', playlistId: 'p', metadata: { title: 'Remote', description: '' } })
  await sync.chunk({ ...job, section: 'remote', records: [videoToRemote(video(1))] })
  await sync.plan(job)
  await engine.collections.playlists.updateAsync({ _id: 'p' }, { $push: { videos: video(2) } })
  assert.equal((await sync.page({ ...job, section: 'playlistIds' })).current, false)
  assert.equal(await sync.apply(job, {}), false)
  assert.deepEqual((await engine.playlistSnapshot({ id: 'p' })).videos.map(record => record.videoId), [video(1).videoId, video(2).videoId])
  await sync.cancel(job)
})

test('history sync pages stay bounded and applying a failed batch rolls back all earlier batches', async t => {
  const { engine, sync } = fixture(t)
  await engine.collections.history.insertAsync(Array.from({ length: 350 }, (_, i) => ({ ...video(i), _id: `h${i}` })))
  const job = await sync.start({ options: {} })
  const plan = await sync.plan(job)
  assert.equal(plan.counts.historyToUpload, 350)
  assert.equal((await sync.page({ ...job, section: 'historyToUpload' })).records.length, 100)
  assert.equal((await sync.page({ ...job, section: 'historyToUpload', offset: 300 })).records.length, 50)
  await engine.collections.history.updateAsync({ videoId: video(0).videoId }, { $set: { title: 'Concurrent' } })
  assert.equal(await sync.apply(job, { history: {} }), false)
  await sync.cancel(job)

  // Remote-only entries force two insertion batches. A failure in the second
  // must also roll back the successfully processed first batch.
  const incoming = await sync.start({ options: {} })
  for (let offset = 0; offset < 300; offset += 250) await sync.chunk({ ...incoming, section: 'remote', records: Array.from({ length: Math.min(250, 300 - offset) }, (_, i) => ({ video: videoToRemote(video(1000 + offset + i)), metadata: { added_date: 1, watched_state: 'completed', position_millis: 90_000 } })) })
  await sync.plan(incoming)
  let calls = 0
  await assert.rejects(sync.apply(incoming, { history: { applySyncChanges: async ({ insertions }) => {
    if (!insertions.length) return
    if (++calls === 2) throw new Error('disk full')
    await engine.collections.history.insertAsync(insertions)
  } } }), /disk full/)
  assert.equal(await engine.collections.history.countAsync({}), 350)
  assert.equal((await engine.collections.history.findOneAsync({ videoId: video(0).videoId })).title, 'Concurrent')
  await sync.cancel(incoming)
})

test('sync retains the existing mass-deletion guard and leaves the local data unchanged', async t => {
  const { engine, sync } = fixture(t)
  await engine.collections.playlists.insertAsync({ _id: 'p', videos: [video(1)] })
  const job = await sync.start({ kind: 'playlist', playlistId: 'p', metadata: { title: 'Playlist' } })
  await sync.chunk({ ...job, section: 'previous', records: [video(1).videoId] })
  await assert.rejects(sync.plan(job), error => error.name === 'SyncServerDataLossError')
  assert.equal(engine.playlistStatistics({ id: 'p' }).total, 1)
  await sync.cancel(job)
})

test('library job leases enforce window ownership and release snapshots on crashes, close and expiry', async () => {
  const canceled = []
  const jobs = new LibraryJobs(async (method, data) => { canceled.push([method, data.id]) }, 20)
  const first = new EventEmitter()
  const other = new EventEmitter()
  jobs.track(first, 'exportStart', 'a')
  assert.throws(() => jobs.access(other, 'exportNext', 'a'), /does not belong/)
  assert.throws(() => jobs.access(other, 'exportCancel', 'a'), /does not belong/)
  assert.throws(() => jobs.access(first, 'importChunk', 'a'), /does not belong/)
  assert.throws(() => jobs.access(first, 'exportNext', 'missing'), /does not belong/)
  assert.throws(() => jobs.access(first, 'importApply', 'missing'), /does not belong/)
  first.emit('render-process-gone')
  assert.deepEqual(canceled, [['exportCancel', 'a']])
  jobs.track(first, 'importStart', 'b')
  first.emit('destroyed')
  assert.deepEqual(canceled.at(-1), ['importCancel', 'b'])
  jobs.track(other, 'syncHistoryStart', 'c')
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.deepEqual(canceled.at(-1), ['syncHistoryCancel', 'c'])
  assert.equal(jobs.jobs.size, 0)
  assert.equal(jobs.access(first, 'exportCancel', 'a'), false)
})

for (const commit of [false, true]) {
  test(`sync chunks wait for unrelated transactions to ${commit ? 'commit' : 'roll back'}`, async t => {
    const { engine, sync } = fixture(t)
    const job = await sync.start({ kind: 'playlist', playlistId: 'p', metadata: { title: 'Remote' } })
    const entered = Promise.withResolvers()
    const resume = Promise.withResolvers()
    const owner = engine.transaction(async () => {
      await engine.collections.history.insertAsync({ ...video(0), _id: 'transient' })
      entered.resolve()
      await resume.promise
      if (!commit) throw new Error('abort owner')
    }).then(() => true, error => { assert.match(error.message, /abort owner/); return false })
    await entered.promise
    let completed = false
    const remote = [videoToRemote(video(1)), videoToRemote(video(2))]
    const chunk = Promise.resolve(sync.chunk({ ...job, section: 'remote', records: remote })).then(result => { completed = true; return result })
    await setImmediate()
    const early = completed
    resume.resolve()
    assert.equal(await owner, commit)
    assert.equal(await chunk, true)
    assert.equal(early, false)
    assert.deepEqual(sync.read(job.id, 'remote'), remote)
    assert.deepEqual(engine.prepare('SELECT ordinal FROM sync_values WHERE job_id = ? ORDER BY ordinal').all(job.id).map(row => row.ordinal), [0, 1])
    await sync.plan(job)
    assert.deepEqual((await sync.page({ ...job, section: 'playlistIds' })).records, remote.map(record => record.id))
  })
}

test('a failed sync chunk rolls back every row and can be retried without advancing its ordinal', async t => {
  const { engine, sync } = fixture(t)
  const job = await sync.start({})
  const records = [video(1), video(2)]
  engine.database.exec("CREATE TEMP TRIGGER fail_chunk BEFORE INSERT ON sync_values WHEN NEW.ordinal = 1 BEGIN SELECT RAISE(ABORT, 'disk full'); END")
  await assert.rejects(Promise.resolve().then(() => sync.chunk({ ...job, section: 'remote', records })), /disk full/)
  assert.deepEqual(sync.read(job.id, 'remote'), [])
  engine.database.exec('DROP TRIGGER fail_chunk')
  await sync.chunk({ ...job, section: 'remote', records })
  assert.deepEqual(sync.read(job.id, 'remote'), records)
  assert.deepEqual(engine.prepare('SELECT ordinal FROM sync_values WHERE job_id = ? ORDER BY ordinal').all(job.id).map(row => row.ordinal), [0, 1])
})

test('sync chunks can be retried after their owning transaction rolls back', async t => {
  const { engine, sync } = fixture(t)
  const job = await sync.start({})
  await assert.rejects(engine.transaction(async () => {
    await sync.chunk({ ...job, section: 'remote', records: [video(1)] })
    throw new Error('abort owner')
  }), /abort owner/)
  assert.deepEqual(sync.read(job.id, 'remote'), [])
  await Promise.all([1, 2].map(i => sync.chunk({ ...job, section: 'remote', records: [video(i)] })))
  assert.deepEqual(sync.read(job.id, 'remote'), [video(1), video(2)])
  assert.deepEqual(engine.prepare('SELECT ordinal FROM sync_values WHERE job_id = ? ORDER BY ordinal').all(job.id).map(row => row.ordinal), [0, 1])
})

for (const kind of ['history', 'playlist']) {
  for (const commitFailure of [false, true]) {
    test(`${kind} sync planning is retryable after ${commitFailure ? 'COMMIT failure' : 'its owning transaction rolls back'}`, async t => {
      const { engine, sync } = fixture(t)
      if (kind === 'playlist') await engine.collections.playlists.insertAsync({ _id: 'p', playlistName: 'Playlist', videos: [video(1)] })
      else await engine.collections.history.insertAsync({ ...video(1), _id: 'kept' })
      const job = await sync.start({ kind, playlistId: 'p', metadata: { title: 'Playlist', description: '' } })
      const records = kind === 'playlist' ? [videoToRemote(video(2))] : [{ video: videoToRemote(video(2)), metadata: { added_date: 3, watched_state: 'watching', position_millis: 5000 } }]
      await sync.chunk({ ...job, section: 'remote', records })
      const before = sync.job(job.id)
      const originalExec = engine.database.exec.bind(engine.database)
      const exec = t.mock.method(engine.database, 'exec', sql => {
        if (commitFailure && sql === 'COMMIT') throw new Error('commit failed')
        return originalExec(sql)
      })
      await assert.rejects(engine.transaction(async () => {
        await sync.plan(job)
        if (!commitFailure) throw new Error('abort owner')
      }), commitFailure ? /commit failed/ : /abort owner/)
      exec.mock.restore()
      assert.deepEqual(sync.job(job.id), before)
      assert.deepEqual(sync.read(job.id, 'remote'), records)
      const section = kind === 'playlist' ? 'playlistIds' : 'next'
      await assert.rejects(sync.page({ ...job, section }), /Invalid sync output page/)
      const plan = await sync.plan(job)
      assert.equal(plan.counts[section], 2)
      assert.equal((await sync.page({ ...job, section })).records.length, 2)
      await sync.cancel(job)
    })
  }
}

for (const commit of [false, true]) {
  test(`sync cancellation waits for an unrelated transaction to ${commit ? 'commit' : 'roll back'}`, async t => {
    const { engine, sync } = fixture(t)
    const job = await sync.start({})
    await sync.chunk({ ...job, section: 'remote', records: [video(1)] })
    const entered = Promise.withResolvers()
    const resume = Promise.withResolvers()
    const owner = engine.transaction(async () => {
      await engine.collections.history.insertAsync({ ...video(0), _id: 'transient' })
      entered.resolve()
      await resume.promise
      if (!commit) throw new Error('abort owner')
    }).then(() => true, error => { assert.match(error.message, /abort owner/); return false })
    await entered.promise
    let completed = false
    const cancellation = Promise.resolve(sync.cancel(job)).then(result => { completed = true; return result })
    await setImmediate()
    const early = completed
    resume.resolve()
    assert.equal(await owner, commit)
    assert.equal(await cancellation, true)
    assert.equal(early, false)
    assert.throws(() => sync.job(job.id), /Unknown library sync/)
    assert.deepEqual(sync.read(job.id, 'remote'), [])
  })
}

test('a rolled-back sync cancellation retains its job and all staged rows for retry', async t => {
  const { engine, sync } = fixture(t)
  const job = await sync.start({})
  const records = [video(1), video(2)]
  await sync.chunk({ ...job, section: 'remote', records })
  const before = sync.job(job.id)
  await assert.rejects(engine.transaction(async () => {
    await sync.cancel(job)
    throw new Error('abort owner')
  }), /abort owner/)
  assert.deepEqual(sync.job(job.id), before)
  assert.deepEqual(sync.read(job.id, 'remote'), records)
  await sync.cancel(job)
  assert.throws(() => sync.job(job.id), /Unknown library sync/)
  assert.deepEqual(sync.read(job.id, 'remote'), [])
})


for (const allowMissingUploader of [false, true]) {
  test(`SQLite playlist sync preserves the current missing-uploader option: ${allowMissingUploader}`, async t => {
    const { engine, sync } = fixture(t)
    const imported = { videoId: 'missing-channel', title: 'Imported', lengthSeconds: 30, playlistItemId: 'first', unknown: new Date(1) }
    const original = { _id: 'imported', playlistName: 'Imported', description: '', videos: [imported, { ...imported, playlistItemId: 'second' }, { ...video(1), playlistItemId: 'known' }], unknown: new Date(2) }
    await engine.collections.playlists.insertAsync(original)
    const job = await sync.start({ kind: 'playlist', playlistId: original._id, metadata: { title: original.playlistName, description: '' }, options: { allowMissingUploader } })
    await sync.chunk({ ...job, section: 'remote', records: [] })
    await sync.plan(job)
    const uploads = (await sync.page({ ...job, section: 'playlistUploads' })).records
    assert.deepEqual(uploads.map(entry => entry.id).sort(), [video(1).videoId, ...(allowMissingUploader ? [imported.videoId] : [])].sort())
    if (allowMissingUploader) assert.equal(uploads.find(entry => entry.id === imported.videoId).uploader.id, 'opentubex:unknown-uploader')
    assert.equal(await sync.apply(job, {}), true)
    assert.deepEqual(await engine.playlistSnapshot({ id: original._id }), original)
    await sync.cancel(job)
  })
}

test('SQLite playlist downloads restore unknown uploader markers as missing local metadata', async t => {
  const { engine, sync } = fixture(t)
  await engine.collections.playlists.insertAsync({ _id: 'download', playlistName: 'Downloaded', description: '', videos: [] })
  const remote = videoToRemote({ videoId: 'remote', title: 'Remote', lengthSeconds: 30 }, { allowMissingUploader: true })
  const job = await sync.start({ kind: 'playlist', playlistId: 'download', metadata: { title: 'Downloaded', description: '' }, options: { allowMissingUploader: true } })
  await sync.chunk({ ...job, section: 'remote', records: [remote] })
  await sync.plan(job)
  await sync.apply(job, {})
  const member = (await engine.playlistSnapshot({ id: 'download' })).videos[0]
  assert.equal(Object.hasOwn(member, 'authorId'), false)
  assert.equal(Object.hasOwn(member, 'author'), false)
  const { playlistItemId, timeAdded, ...metadata } = member
  assert.equal(typeof playlistItemId, 'string')
  assert.equal(typeof timeAdded, 'number')
  assert.deepEqual(metadata, { videoId: 'remote', title: 'Remote', lengthSeconds: 30, published: 0, type: 'video' })
  await sync.cancel(job)
})


test('playlist metadata baseline changes only after the local apply succeeds', async t => {
  const { engine } = fixture(t)
  const account = ['server', 'token', 'legacy', '', '']
  const snapshot = { history: ['keep'], playlists: { p: { remoteId: 'remote', metadata: { title: 'Shared' }, videos: ['old'] } } }
  await engine.collections.settings.insertAsync(Object.entries({ syncServerEnabled: true, syncServerUrl: 'server', syncServerToken: 'token', syncServerSnapshot: JSON.stringify(snapshot) }).map(([_id, value]) => ({ _id, value })))
  const value = { id: 'p', remoteId: 'remote', metadata: { title: 'Pending local save' }, acknowledged: { upserts: ['new'], deletions: [] } }
  await syncSnapshotSection(engine, { account, collection: 'playlists', value })
  assert.deepEqual(JSON.parse((await engine.collections.settings.findOneAsync({ _id: 'syncServerSnapshot' })).value), { ...snapshot, playlists: { p: { ...snapshot.playlists.p, videos: ['old', 'new'] } } })
  await syncSnapshotSection(engine, { account, collection: 'playlists', value: { ...value, next: { videos: ['new'] } } })
  assert.deepEqual(JSON.parse((await engine.collections.settings.findOneAsync({ _id: 'syncServerSnapshot' })).value), { ...snapshot, playlists: { p: { ...snapshot.playlists.p, metadata: value.metadata, videos: ['new'] } } })
})

test('SQLite sync uploads repaired metadata for existing IDs without changing duplicate occurrences', async t => {
  const { engine, sync } = fixture(t)
  const old = { videoId: 'abcdefghijk', title: 'abcdefghijk', authorId: 'channel', author: 'channel', published: 0, lengthSeconds: 0 }
  const repaired = { ...old, title: 'Repaired', author: 'Known channel', published: 1735689600000, lengthSeconds: 120 }
  const original = { _id: 'p', playlistName: 'Saved', videos: [{ ...repaired, playlistItemId: 'first', unknown: new Date(1) }, { ...repaired, playlistItemId: 'second', unknown: new Date(2) }], unknown: new Date(3) }
  await engine.collections.playlists.insertAsync(original)
  const memberIds = engine.playlistPage({ id: 'p' }).records.map(record => record._libraryMemberId)
  for (const remote of [videoToRemote(old), videoToRemote(repaired)]) {
    const job = await sync.start({ kind: 'playlist', playlistId: 'p', metadata: { title: 'Saved', description: '' } })
    await sync.chunk({ ...job, section: 'remote', records: [remote] })
    await sync.plan(job)
    const uploads = (await sync.page({ ...job, section: 'playlistUploads' })).records
    assert.deepEqual(uploads, remote.title === old.title ? [videoToRemote(repaired)] : [])
    assert.equal(await sync.apply(job, {}), true)
    const saved = await engine.playlistSnapshot({ id: 'p' })
    assert.deepEqual(saved.videos, original.videos)
    assert.equal(saved.unknown.getTime(), 3)
    assert.deepEqual(engine.playlistPage({ id: 'p' }).records.map(record => record._libraryMemberId), memberIds)
    await sync.cancel(job)
  }
})

for (const allowMissingUploader of [false, true]) {
  test(`remote-matched retained playlist occurrences remain present before merge with missing uploaders: ${allowMissingUploader}`, async t => {
    const { engine, sync } = fixture(t)
    const known = { ...video(2), playlistItemId: 'known' }
    const missing = { videoId: video(1).videoId, title: 'Saved title', lengthSeconds: 30, playlistItemId: 'duplicate', unknown: new Date(1) }
    const original = { _id: 'retained', playlistName: 'Retained', description: '', videos: [missing, { ...missing, playlistItemId: 'duplicate-2' }, known], unknown: new Date(2) }
    await engine.collections.playlists.insertAsync(original)
    const identities = engine.prepare("SELECT membership_id FROM members WHERE collection = 'playlists' AND record_id = ? ORDER BY position").all(original._id)
    const remote = [videoToRemote(video(1)), videoToRemote(known)]
    const job = await sync.start({ kind: 'playlist', playlistId: original._id, metadata: { title: original.playlistName, description: '' }, options: { allowMissingUploader } })
    await sync.chunk({ ...job, section: 'remote', records: remote })
    await sync.chunk({ ...job, section: 'previous', records: remote.map(record => record.id) })
    await sync.plan(job)
    assert.deepEqual((await sync.page({ ...job, section: 'playlistRemovals' })).records, [])
    assert.deepEqual((await sync.page({ ...job, section: 'playlistIds' })).records, remote.map(record => record.id))
    assert.equal(await sync.apply(job, {}), true)
    const saved = await engine.playlistSnapshot({ id: original._id })
    assert.deepEqual(saved, { ...original, lastUpdatedAt: saved.lastUpdatedAt, videos: original.videos.map(record => record === known ? record : { ...record, authorId: 'channel', author: 'Author' }) })
    assert.deepEqual(engine.prepare("SELECT membership_id FROM members WHERE collection = 'playlists' AND record_id = ? ORDER BY position").all(original._id), identities)
  })
}
