import { existsSync, readdirSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import Datastore from '@seald-io/nedb'

import { test, expect, readDatastore, createUserDataDir, launchApp } from '../../helpers/app.mjs'

const videos = Array.from({ length: 300 }, (_, index) => ({
  videoId: `video${String(index % 100).padStart(6, '0')}`,
  playlistItemId: `item-${index}`,
  title: `Migrated video ${index}`,
  author: 'Channel',
  authorId: 'UCmigration',
  lengthSeconds: 60,
  timeAdded: 1700000000000 + index,
  type: 'video',
}))
const playlist = { _id: 'migrated', playlistName: 'Migrated playlist', protected: false, videos, lastUpdatedAt: 1, createdAt: 1 }
const history = Array.from({ length: 50 }, (_, index) => ({
  _id: `history-${index}`,
  videoId: `hist${String(index).padStart(7, '0')}`,
  title: `History entry ${index}`,
  author: 'Channel',
  authorId: 'UCmigration',
  lengthSeconds: 100,
  watchProgress: index,
  isWatched: false,
  timeWatched: 1700000000000 + index,
  type: 'video',
}))

test.use({
  seed: {
    history,
    playlists: [playlist],
  },
})

const library = (page) => page.evaluate(() => {
  const { getters } = document.querySelector('#app').__vue_app__.config.globalProperties.$store
  const saved = getters.getAllPlaylists.find(playlist => playlist._id === 'migrated')
  return {
    history: getters.getHistoryCacheSorted.map(entry => entry.videoId),
    playlistName: saved?.playlistName,
    videos: saved?.videos.map(video => video.playlistItemId),
  }
})

test('imports legacy NeDB files, leaves them for older versions and applies their later edits', async ({ app, page }) => {
  const expected = {
    history: history.map(entry => entry.videoId).reverse(),
    playlistName: playlist.playlistName,
    videos: videos.map(video => video.playlistItemId),
  }
  await expect.poll(() => library(page)).toEqual(expected)

  const legacyFile = path.join(app.userDataDir, 'playlists.db')
  for (const name of ['history', 'playlists', 'settings']) {
    expect(existsSync(path.join(app.userDataDir, `${name}.sqlite`))).toBe(true)
  }
  const legacyContents = await readFile(legacyFile, 'utf8')
  expect(legacyContents.trim().split('\n').map(line => JSON.parse(line))).toEqual([playlist])

  // An edit in this version stays out of the legacy file.
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store
    .dispatch('removeVideo', { _id: 'migrated', videoId: 'video000000', playlistItemId: 'item-0' }))
  await expect.poll(() => readDatastore(app.userDataDir, 'playlists').trim().split('\n').filter(Boolean)
    .map(line => JSON.parse(line)).find(saved => saved._id === 'migrated')?.videos.length).toBe(videos.length - 1)
  expect(await readFile(legacyFile, 'utf8')).toBe(legacyContents)

  // Rename the playlist in an older version, then return to this one.
  const { page: relaunched } = await app.relaunch(async () => {
    const older = new Datastore({ filename: legacyFile })
    await older.loadDatabaseAsync()
    await older.updateAsync({ _id: 'migrated' }, { $set: { playlistName: 'Renamed in older version' } })
    await older.compactDatafileAsync()
  })
  await expect.poll(() => library(relaunched)).toEqual({
    ...expected,
    playlistName: 'Renamed in older version',
    // The older version never saw the removal, so its copy of the playlist wins.
    videos: videos.map(video => video.playlistItemId),
  })
  expect(readdirSync(app.userDataDir).filter(name => name.startsWith('playlists.sqlite.backup-'))).toHaveLength(1)
})

test('tells users once that their library moved to a new format', async () => {
  // A fresh profile confirms quitting in a native dialog: answer it with Quit.
  const answerQuitConfirmation = (phase, _page, electronApp) => phase === 'electronConnected' && electronApp.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
  })
  async function launchAndCollect(userDataDir, expected) {
    const { electronApp, page } = await launchApp(userDataDir, [], {
      onPhase: answerQuitConfirmation,
      env: { OPENTUBEX_E2E_LIBRARY_NOTICES: 'true' },
    })
    try {
      const notices = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Ok' }) })
      const seen = []
      for (let index = 0; index < expected.length; index++) {
        // Notices show one after the other, never stacked.
        await expect(notices).toHaveCount(1)
        seen.push(await notices.getByRole('heading').textContent())
        await notices.getByRole('button', { name: 'Ok' }).click()
      }
      // Stores open in no fixed order, so neither do their notices.
      expect(seen.toSorted()).toEqual(expected.toSorted())
      // Absence has no event to wait for: give the remaining stores time to open.
      await page.waitForTimeout(3000)
      await expect(notices).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  }
  const migrated = await createUserDataDir({ playlists: [playlist], history })
  const fresh = await createUserDataDir({ freshProfile: true })
  const formatNotice = 'Library moved to a new format'
  try {
    await launchAndCollect(migrated, [formatNotice])
    // Not again, and not for a new installation, which has nothing to migrate.
    await launchAndCollect(migrated, [])
    await launchAndCollect(fresh, [])

    // One store imports again while another applies older-version changes:
    // both notices show, one after the other.
    for (const suffix of ['', '-wal', '-shm']) {
      await rm(path.join(migrated, `history.sqlite${suffix}`), { force: true })
    }
    const older = new Datastore({ filename: path.join(migrated, 'playlists.db') })
    await older.loadDatabaseAsync()
    await older.updateAsync({ _id: 'migrated' }, { $set: { playlistName: 'Renamed in older version' } })
    await older.compactDatafileAsync()
    await launchAndCollect(migrated, [formatNotice, 'Changes from an older version'])
  } finally {
    await rm(migrated, { recursive: true, force: true })
    await rm(fresh, { recursive: true, force: true })
  }
})
