import assert from 'node:assert/strict'
import fs, { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createScheduledBackups } from '../../src/main/scheduledBackups.js'
import { readUnifiedBackup } from '../../src/renderer/helpers/unifiedBackup.js'
import { NON_TRANSFERABLE_SETTINGS } from '../../src/nonTransferableSettings.js'

const DAY = 86_400_000
const data = {
  settings: { autoplayVideos: false },
  profiles: [{ _id: 'allChannels', name: 'Main', subscriptions: [{ id: 'UCexample' }] }],
  playlists: [{ _id: 'favorites', playlistName: 'Favorites', videos: [{ videoId: 'abcdefghijk' }] }],
  history: [{ videoId: 'abcdefghijk', timeWatched: 1, watchProgress: 30 }],
  searchHistory: [{ _id: 'query', query: 'music' }],
  watchStats: { records: [{ date: '2026-10-18', seconds: 42 }], adjustment: null },
}

async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-backups-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let timestamp = Date.UTC(2026, 9, 18)
  let reads = 0
  const configuration = { enabled: true, directory, interval: 7, keepCount: 3, status: {} }
  const options = {
    readConfiguration: async () => structuredClone(configuration),
    readData: async () => { reads++; return data },
    saveStatus: async status => { configuration.status = status },
    now: () => timestamp,
  }
  return {
    directory, configuration, options,
    service: createScheduledBackups(options),
    advance: milliseconds => { timestamp += milliseconds },
    reads: () => reads,
    backups: async () => (await readdir(directory)).filter(name => name.endsWith('.zip')).sort(),
  }
}

test('disabled and invalid schedules never read data or write files', async t => {
  const state = await setup(t)
  for (const invalid of [{ enabled: false }, { directory: '' }, { interval: 0 }, { keepCount: 0 }, { keepCount: 1.5 }]) {
    const original = { ...state.configuration }
    Object.assign(state.configuration, invalid)
    await state.service.tick()
    Object.assign(state.configuration, original)
  }
  assert.equal(state.reads(), 0)
  assert.deepEqual(await readdir(state.directory), [])
})

test('first backup is complete, importable, and shared by concurrent ticks', async t => {
  const state = await setup(t)
  await Promise.all([state.service.tick(), state.service.tick()])
  assert.equal(state.reads(), 1)
  const files = await state.backups()
  assert.equal(files.length, 1)
  const backup = await readUnifiedBackup(new Blob([await readFile(path.join(state.directory, files[0]))]))
  assert.deepEqual(backup.data, data)
  assert.equal(state.configuration.status.error, false)
  assert.equal(state.configuration.status.lastBackupAt, state.options.now())
  assert.deepEqual(await readdir(state.directory), files)
})

test('persisted deadlines survive restarts and missed intervals create one catch-up backup', async t => {
  const state = await setup(t)
  await state.service.tick()
  state.advance(6 * DAY)
  const restarted = createScheduledBackups(state.options)
  await restarted.tick()
  assert.equal(state.reads(), 1)
  state.advance(50 * DAY)
  await restarted.tick()
  await restarted.tick()
  assert.equal(state.reads(), 2)
})

test('daily and 30-day schedules run at their selected interval', async t => {
  for (const interval of [1, 30]) {
    const state = await setup(t)
    state.configuration.interval = interval
    await state.service.tick()
    state.advance(interval * DAY - 1)
    await state.service.tick()
    assert.equal(state.reads(), 1)
    state.advance(1)
    await state.service.tick()
    assert.equal(state.reads(), 2)
  }
})

test('retention deletes oldest scheduled archives and preserves manual backups, unrelated files, and symlinks', async t => {
  const state = await setup(t)
  const manual = path.join(state.directory, 'opentubex-backup-2026-01-01.zip')
  const unrelated = path.join(state.directory, 'notes.txt')
  const symbolic = path.join(state.directory, 'opentubex-scheduled-backup-2020-01-01T00-00-00-000Z-00000000-0000-0000-0000-000000000000.zip')
  await writeFile(manual, 'manual')
  await writeFile(unrelated, 'notes')
  await symlink(manual, symbolic)
  await state.service.tick()
  const first = (await state.backups()).find(name => name.includes('2026-10-18T'))
  for (let index = 0; index < 4; index++) {
    state.advance(7 * DAY)
    await state.service.tick()
  }
  assert.equal((await state.backups()).length, 5)
  assert.equal((await state.backups()).includes(first), false)
  assert.equal(await readFile(manual, 'utf8'), 'manual')
  assert.equal(await readFile(unrelated, 'utf8'), 'notes')
  assert.equal(await readFile(symbolic, 'utf8'), 'manual')
})

test('failed backup preparation preserves old backups and retries after five minutes', async t => {
  t.mock.method(console, 'error', () => {})
  const state = await setup(t)
  await state.service.tick()
  const first = await state.backups()
  state.configuration.keepCount = 1
  state.advance(7 * DAY)
  const failed = createScheduledBackups({ ...state.options, readData: async () => { throw new Error('read failed') } })
  await failed.tick()
  assert.equal(state.configuration.status.error, true)
  assert.deepEqual(await state.backups(), first)
  const restarted = createScheduledBackups(state.options)
  await restarted.tick()
  assert.equal(state.reads(), 1)
  state.advance(300_000)
  await restarted.tick()
  assert.equal(state.reads(), 2)
  assert.equal(state.configuration.status.error, false)
  assert.equal((await state.backups()).length, 1)
  assert.equal((await state.backups()).includes(first[0]), false)
})

test('missing destinations stay missing and report failure without resetting the last success', async t => {
  t.mock.method(console, 'error', () => {})
  const state = await setup(t)
  await state.service.tick()
  const lastBackupAt = state.configuration.status.lastBackupAt
  await rm(state.directory, { recursive: true })
  state.advance(7 * DAY)
  await state.service.tick()
  assert.equal(state.configuration.status.error, true)
  assert.equal(state.configuration.status.lastBackupAt, lastBackupAt)
  await assert.rejects(readdir(state.directory), { code: 'ENOENT' })
})

test('changing the folder starts a fresh schedule and shutdown waits for an active backup', async t => {
  const state = await setup(t)
  state.configuration.status = { directory: '/old-folder', lastBackupAt: state.options.now(), lastAttemptAt: state.options.now() }
  const tick = state.service.tick()
  await state.service.stop()
  await tick
  assert.equal(state.reads(), 1)
  state.advance(7 * DAY)
  await state.service.tick()
  assert.equal(state.reads(), 1)
})

test('backup configuration and status are never exported or synced to another device', () => {
  for (const key of ['scheduledBackupEnabled', 'scheduledBackupFolderPath', 'scheduledBackupInterval', 'scheduledBackupKeepCount', 'scheduledBackupStatus']) {
    assert.ok(NON_TRANSFERABLE_SETTINGS.has(key))
  }
})


test('retention failures preserve successful backup deadlines without five-minute archive retries', async t => {
  t.mock.method(console, 'error', () => {})
  const state = await setup(t)
  state.configuration.keepCount = 1
  const locked = path.join(state.directory, 'opentubex-scheduled-backup-2020-01-01T00-00-00-000Z-00000000-0000-0000-0000-000000000000.zip')
  await writeFile(locked, 'locked archive')
  const unlink = fs.unlink
  t.mock.method(fs, 'unlink', async filename => {
    if (filename === locked) throw Object.assign(new Error('File is locked'), { code: 'EPERM' })
    return unlink(filename)
  })

  await state.service.tick()
  assert.equal(state.configuration.status.error, false)
  assert.equal(state.configuration.status.lastBackupAt, state.options.now())
  assert.equal((await state.backups()).length, 2)
  state.advance(300_000)
  await state.service.tick()
  await createScheduledBackups(state.options).tick()
  assert.equal(state.reads(), 1)
  assert.equal((await state.backups()).length, 2)
  state.advance(7 * DAY)
  await state.service.tick()
  assert.equal(state.reads(), 2)
  assert.equal(state.configuration.status.error, false)
  assert.equal((await state.backups()).length, 2)
})
