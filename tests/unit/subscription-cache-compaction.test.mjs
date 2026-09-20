import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'

const source = await readFile(new URL('../../src/datastores/index.js', import.meta.url), 'utf8')
const factory = source.match(/function createDatastore\(name\) \{[\s\S]*?\n\}/)[0]

test('a running desktop session compacts cache revisions without losing the latest feed state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'opentubex-cache-compaction-'))
  t.mock.timers.enable({ apis: ['setInterval'] })
  const createDatastore = vm.runInNewContext(`(${factory})`, {
    Datastore,
    dbPath: name => join(directory, `${name}.db`),
    process: { env: { IS_ELECTRON_MAIN: true } },
    setInterval,
    console,
  })
  const db = createDatastore('subscription-cache')
  t.after(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  await db.loadDatabaseAsync()
  const latest = { _id: 'channel', videos: [{ videoId: 'video', isNewInSubscriptionFeed: false }] }
  for (let revision = 0; revision < 20; revision++) {
    await db.updateAsync({ _id: 'channel' }, {
      ...latest, videos: [{ videoId: 'video', isNewInSubscriptionFeed: true }],
    }, { upsert: true })
  }
  await db.updateAsync({ _id: 'channel' }, latest)
  const before = await readFile(db.filename, 'utf8')
  let compaction
  const compact = db.compactDatafileAsync.bind(db)
  t.mock.method(db, 'compactDatafileAsync', () => {
    compaction = compact()
    return compaction
  })
  t.mock.timers.tick(5 * 60 * 1000)
  assert.ok(compaction, 'the cache must compact during a session, without needing a restart')
  await compaction
  const after = await readFile(db.filename, 'utf8')
  assert.ok(after.length < before.length / 10)
  const reopened = new Datastore({ filename: db.filename })
  await reopened.loadDatabaseAsync()
  assert.deepEqual(await reopened.findAsync({}), [latest])
})

test('a failed periodic compaction is reported and the next attempt succeeds', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const errors = []
  const createDatastore = vm.runInNewContext(`(${factory})`, {
    Datastore,
    dbPath: () => undefined,
    process: { env: { IS_ELECTRON_MAIN: true } },
    setInterval,
    console: { error: (...args) => errors.push(args) },
  })
  const db = createDatastore('subscription-cache')
  await db.loadDatabaseAsync()
  const diskFull = new Error('ENOSPC: no space left on device')
  let attempts = 0
  t.mock.method(db.persistence, 'persistCachedDatabaseAsync', async () => {
    if (++attempts === 1) throw diskFull
  })
  t.mock.timers.tick(5 * 60 * 1000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(errors.length, 1)
  assert.equal(errors[0][1], diskFull)
  t.mock.timers.tick(5 * 60 * 1000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(attempts, 2)
  assert.equal(errors.length, 1)
})
