import assert from 'node:assert/strict'
import fs, { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createDesktopDatastore } from '../../src/datastores/sqliteNode.js'
import { migrateStoredSettings } from '../../src/datastores/settingsMigrations.js'
import { createScheduledBackups } from '../../src/main/scheduledBackups.js'
import { createBackupArchiveFactory } from '../../src/main/backupArchive.js'
import { readUnifiedBackup } from '../../src/renderer/helpers/unifiedBackup.js'
import { NON_TRANSFERABLE_SETTINGS } from '../../src/nonTransferableSettings.js'
import { createDefaultSettings } from '../../src/settingsDefaults.js'

const workerPath = new URL('../../src/main/backupArchiveWorker.js', import.meta.url)
const DAY = 86_400_000
const data = {
  settings: { autoplayVideos: false },
  profiles: [{ _id: 'allChannels', name: 'Main', subscriptions: [{ id: 'UCexample' }] }],
  playlists: [{ _id: 'favorites', playlistName: 'Favorites', videos: [{ videoId: 'abcdefghijk' }] }],
  history: [{ _id: 'history-video', videoId: 'abcdefghijk', timeWatched: 1, watchProgress: 30, isWatched: false }],
  searchHistory: [{ _id: 'query', query: 'music' }],
  watchStats: { records: [{ _id: 'watch-date', date: '2026-10-18', seconds: 42 }], adjustment: { defaultSpeed: 1.5, updatedAt: 2 } },
}
const transferableDefaults = Object.fromEntries(Object.entries(createDefaultSettings({ supportsLocalApi: true, isElectron: true }))
  .filter(([key]) => !NON_TRANSFERABLE_SETTINGS.has(key)))
const expectedData = { ...data, settings: { ...transferableDefaults, ...data.settings, landingPage: 'subscriptions' } }

async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'opentubex-backups-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profileDirectory = await mkdtemp(path.join(tmpdir(), 'opentubex-backup-profile-'))
  t.after(() => rm(profileDirectory, { recursive: true, force: true }))
  const collections = {
    settings: [...Object.entries(data.settings).map(([_id, value]) => ({ _id, value })),
      { _id: 'syncServerToken', value: 'excluded-test-token' }, { _id: 'scheduledBackupEnabled', value: true }],
    profiles: data.profiles,
    playlists: data.playlists,
    history: data.history,
    'search-history': data.searchHistory,
    'watch-stats': [...data.watchStats.records, { _id: 'history-watch-time-v1', adjustment: data.watchStats.adjustment }],
  }
  for (const [name, documents] of Object.entries(collections)) {
    const datastore = createDesktopDatastore(path.join(profileDirectory, `${name}.sqlite`), undefined,
      name === 'playlists' ? { childField: 'videos' } : {})
    try {
      await datastore.insertAsync(documents)
    } finally {
      await datastore.driver.close()
    }
  }
  let timestamp = Date.UTC(2026, 9, 18)
  let reads = 0
  const configuration = { enabled: true, directory, interval: 7, keepCount: 3, status: {} }
  const options = {
    readConfiguration: async () => structuredClone(configuration),
    createArchive: createBackupArchiveFactory(profileDirectory, workerPath, async () => {
      reads++
      const settings = createDesktopDatastore(path.join(profileDirectory, 'settings.sqlite'))
      try {
        await migrateStoredSettings(settings)
      } finally {
        await settings.driver.close()
      }
    }),
    saveStatus: async status => { configuration.status = status },
    now: () => timestamp,
  }
  return {
    directory, profileDirectory, configuration, options,
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
  assert.deepEqual(backup.data, expectedData)
  assert.equal(state.configuration.status.error, false)
  assert.equal(state.configuration.status.lastBackupAt, state.options.now())
  assert.deepEqual(await readdir(state.directory), files)
})

test('scheduled archives include unstored defaults alongside saved preferences', async t => {
  const state = await setup(t)
  await state.service.tick()
  const [filename] = await state.backups()
  const backup = await readUnifiedBackup(new Blob([await readFile(path.join(state.directory, filename))]))
  assert.equal(backup.data.settings.autoplayVideos, false, 'stored preferences override defaults')
  assert.equal(backup.data.settings.autoplayPlaylists, true, 'unstored defaults are captured')
  assert.deepEqual(backup.data.settings.autoPictureInPictureTriggers, [])
  for (const key of NON_TRANSFERABLE_SETTINGS) assert.equal(Object.hasOwn(backup.data.settings, key), false, key)
})

for (const landingPage of [undefined, 'home', 'history']) {
  test(`scheduled archives preserve ${landingPage ?? 'the existing-profile default'} landing page`, async t => {
    const state = await setup(t)
    if (landingPage !== undefined) {
      const settings = createDesktopDatastore(path.join(state.profileDirectory, 'settings.sqlite'))
      try {
        await settings.insertAsync({ _id: 'landingPage', value: landingPage })
      } finally {
        await settings.driver.close()
      }
    }
    await state.service.tick()
    const [filename] = await state.backups()
    const backup = await readUnifiedBackup(new Blob([await readFile(path.join(state.directory, filename))]))
    assert.equal(backup.data.settings.landingPage, landingPage ?? 'subscriptions')
  })
}

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
  const failed = createScheduledBackups({ ...state.options, createArchive: async () => { throw new Error('read failed') } })
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

test('archive factory waits for datastore readiness before starting its worker', async t => {
  const state = await setup(t)
  const ready = Promise.withResolvers()
  let workers = 0
  const onWorker = () => { workers++ }
  process.on('worker', onWorker)
  t.after(() => process.off('worker', onWorker))
  const createArchive = createBackupArchiveFactory(state.profileDirectory, workerPath, () => ready.promise)
  const pending = createArchive()
  await new Promise(resolve => setImmediate(resolve))
  const workersBeforeReady = workers
  ready.resolve()
  const archive = await pending
  assert.equal(workersBeforeReady, 0)
  assert.equal(workers, 1)
  const backup = await readUnifiedBackup(new Blob([archive]))
  assert.deepEqual(backup.data, expectedData)
})

for (const phase of ['preparation', 'temporary write']) {
  for (const change of ['disable', 'folder']) {
    test(`cancels a backup when ${change} changes during ${phase}`, async t => {
      const state = await setup(t)
      const old = 'opentubex-scheduled-backup-2020-01-01T00-00-00-000Z-00000000-0000-0000-0000-000000000000.zip'
      await writeFile(path.join(state.directory, old), 'previous archive')
      state.configuration.keepCount = 1
      const changeConfiguration = () => {
        if (change === 'disable') state.configuration.enabled = false
        else state.configuration.directory = path.join(state.directory, 'new-folder')
      }
      let service
      if (phase === 'preparation') {
        service = createScheduledBackups({
          ...state.options,
          createArchive: async () => {
            changeConfiguration()
            return state.options.createArchive()
          },
        })
      } else {
        const write = fs.writeFile
        t.mock.method(fs, 'writeFile', async (...args) => {
          await write(...args)
          if (String(args[0]).endsWith('.tmp')) changeConfiguration()
        })
        service = state.service
      }
      await service.tick()
      assert.deepEqual(await readdir(state.directory), [old])
      assert.equal(await readFile(path.join(state.directory, old), 'utf8'), 'previous archive')
      assert.deepEqual(state.configuration.status, {})
    })
  }
}


test('archive worker failures reject without creating missing profile databases', async t => {
  const state = await setup(t)
  const missing = path.join(state.profileDirectory, 'missing')
  const createArchive = createBackupArchiveFactory(missing, workerPath, async () => {})
  await assert.rejects(createArchive(), /unable to open database/)
  await assert.rejects(readdir(missing), { code: 'ENOENT' })
})


test('unavailable destinations skip archive preparation on every retry', async t => {
  t.mock.method(console, 'error', () => {})
  const state = await setup(t)
  await rm(state.directory, { recursive: true })
  await state.service.tick()
  state.advance(300_000)
  await state.service.tick()
  assert.equal(state.configuration.status.error, true)
  assert.equal(state.reads(), 0)
})

test('unwritable destinations skip archive preparation', async t => {
  t.mock.method(console, 'error', () => {})
  const state = await setup(t)
  await fs.chmod(state.directory, 0o500)
  try {
    await state.service.tick()
    assert.equal(state.configuration.status.error, true)
    assert.equal(state.reads(), 0)
  } finally {
    await fs.chmod(state.directory, 0o700)
  }
})

for (const phase of ['preparation', 'temporary write', 'directory listing']) {
  test(`retention uses the latest limit after ${phase}`, async t => {
    const state = await setup(t)
    state.configuration.keepCount = 1
    for (let day = 1; day <= 4; day++) {
      await writeFile(path.join(state.directory, `opentubex-scheduled-backup-2020-01-0${day}T00-00-00-000Z-00000000-0000-0000-0000-000000000000.zip`), 'old archive')
    }
    if (phase === 'preparation') {
      state.service = createScheduledBackups({
        ...state.options,
        createArchive: async () => {
          state.configuration.keepCount = 5
          return state.options.createArchive()
        },
      })
    } else if (phase === 'temporary write') {
      const write = fs.writeFile
      t.mock.method(fs, 'writeFile', async (...args) => {
        await write(...args)
        if (String(args[0]).endsWith('.tmp')) state.configuration.keepCount = 5
      })
    } else {
      const list = fs.readdir
      t.mock.method(fs, 'readdir', async (...args) => {
        const entries = await list(...args)
        state.configuration.keepCount = 5
        return entries
      })
    }
    await state.service.tick()
    assert.equal(state.configuration.status.error, false)
    assert.equal((await state.backups()).length, 5)
  })
}


test('scheduled archives normalize legacy settings and exclude internal window bounds', async t => {
  const state = await setup(t)
  const settings = createDesktopDatastore(path.join(state.profileDirectory, 'settings.sqlite'))
  try {
    await settings.insertAsync([
      { _id: 'defaultTheatreMode', value: true },
      { _id: 'saveWatchedProgress', value: false },
      { _id: 'currentLocale', value: 'en_GB' },
      { _id: 'screenshotAskPath', value: true },
      { _id: 'bounds', value: { x: 10, y: 20 } },
    ])
  } finally {
    await settings.driver.close()
  }
  await state.service.tick()
  const [filename] = await state.backups()
  const backup = await readUnifiedBackup(new Blob([await readFile(path.join(state.directory, filename))]))
  assert.equal(backup.data.settings.defaultViewingMode, 'theatre')
  assert.equal(backup.data.settings.watchedProgressSavingMode, 'never')
  assert.equal(backup.data.settings.currentLocale, 'en-GB')
  assert.equal(backup.data.settings.screenshotMode, 'prompt_folder')
  for (const key of ['defaultTheatreMode', 'saveWatchedProgress', 'screenshotAskPath', 'bounds']) {
    assert.equal(Object.hasOwn(backup.data.settings, key), false, key)
  }
})
