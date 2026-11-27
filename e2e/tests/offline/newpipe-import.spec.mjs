import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { zipSync } from 'fflate'

import { expect, goToSettingsSection, test } from '../../helpers/app.mjs'

/** A NewPipe backup with the tables that the history and playlist imports read */
async function createNewPipeBackup() {
  const directory = await mkdtemp(join(tmpdir(), 'newpipe-backup-'))
  try {
    const path = join(directory, 'newpipe.db')
    const database = new DatabaseSync(path)
    database.exec(`
      CREATE TABLE streams (uid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, service_id INTEGER NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, stream_type TEXT NOT NULL, duration INTEGER NOT NULL, uploader TEXT NOT NULL, uploader_url TEXT, thumbnail_url TEXT, view_count INTEGER, textual_upload_date TEXT, upload_date INTEGER, is_upload_date_approximation INTEGER);
      CREATE TABLE stream_history (stream_id INTEGER NOT NULL, access_date INTEGER NOT NULL, repeat_count INTEGER NOT NULL, PRIMARY KEY(stream_id, access_date));
      CREATE TABLE stream_state (stream_id INTEGER NOT NULL, progress_time INTEGER NOT NULL, PRIMARY KEY(stream_id));
      CREATE TABLE playlists (uid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, name TEXT, is_thumbnail_permanent INTEGER NOT NULL, thumbnail_stream_id INTEGER NOT NULL, display_index INTEGER NOT NULL);
      CREATE TABLE playlist_stream_join (playlist_id INTEGER NOT NULL, stream_id INTEGER NOT NULL, join_index INTEGER NOT NULL, PRIMARY KEY(playlist_id, join_index));
      INSERT INTO streams (service_id, url, title, stream_type, duration, uploader) VALUES
        (0, 'https://www.youtube.com/watch?v=newpipeAAAA', 'First video', 'VIDEO_STREAM', 600, 'Channel'),
        (0, 'https://www.youtube.com/watch?v=newpipeBBBB', 'Second video', 'VIDEO_STREAM', 300, 'Channel');
      INSERT INTO stream_history VALUES (1, 1700000000000, 1), (2, 1700000100000, 1);
      INSERT INTO stream_state VALUES (1, 120000);
      INSERT INTO playlists (name, is_thumbnail_permanent, thumbnail_stream_id, display_index) VALUES ('NewPipe playlist', 0, -1, 0);
      INSERT INTO playlist_stream_join VALUES (1, 2, 0), (1, 1, 1);
    `)
    database.close()
    return Array.from(zipSync({ 'newpipe.db': new Uint8Array(await readFile(path)) }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('NewPipe backups import watch history and playlists', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const dataSection = await goToSettingsSection(page, 'data')
  await page.evaluate((bytes) => {
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [{ getFile: async () => new File([new Uint8Array(bytes)], 'NewPipeData-20260101_120000.zip', { type: 'application/zip' }) }],
    })
  }, await createNewPipeBackup())

  await dataSection.getByRole('button', { name: 'Import history', exact: true }).click()
  await expect(page.locator('.toast', { hasText: 'All watched history has been successfully imported' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const historyById = window.$store.getters.getHistoryCacheById
    return ['newpipeAAAA', 'newpipeBBBB'].map(videoId => {
      const { title, timeWatched, watchProgress, isWatched } = historyById[videoId] ?? {}
      return { title, timeWatched, watchProgress, isWatched }
    })
  })).toEqual([
    { title: 'First video', timeWatched: 1700000000000, watchProgress: 120, isWatched: false },
    { title: 'Second video', timeWatched: 1700000100000, watchProgress: 300, isWatched: true },
  ])

  await dataSection.getByRole('button', { name: 'Import playlists', exact: true }).click()
  await expect(page.locator('.toast', { hasText: '1/1 playlist has been successfully imported' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.$store.getters.getAllPlaylists
    .find(playlist => playlist.playlistName === 'NewPipe playlist')?.videos.map(video => video.videoId)))
    .toEqual(['newpipeBBBB', 'newpipeAAAA'])
  expect(pageErrors).toEqual([])
})
