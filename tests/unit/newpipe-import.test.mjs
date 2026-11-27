import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { strToU8, zipSync } from 'fflate'

import { readNewPipeBackup } from '../../src/renderer/helpers/newpipe-import.js'

// NewPipe's schema as its current database version creates it
const SCHEMA = [
  'CREATE TABLE `subscriptions` (`uid` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `service_id` INTEGER NOT NULL, `url` TEXT, `name` TEXT, `avatar_url` TEXT, `subscriber_count` INTEGER, `description` TEXT, `notification_mode` INTEGER NOT NULL)',
  'CREATE TABLE `search_history` (`creation_date` INTEGER, `service_id` INTEGER NOT NULL, `search` TEXT, `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL)',
  'CREATE TABLE `streams` (`uid` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `service_id` INTEGER NOT NULL, `url` TEXT NOT NULL, `title` TEXT NOT NULL, `stream_type` TEXT NOT NULL, `duration` INTEGER NOT NULL, `uploader` TEXT NOT NULL, `uploader_url` TEXT, `thumbnail_url` TEXT, `view_count` INTEGER, `textual_upload_date` TEXT, `upload_date` INTEGER, `is_upload_date_approximation` INTEGER)',
  'CREATE TABLE `stream_history` (`stream_id` INTEGER NOT NULL, `access_date` INTEGER NOT NULL, `repeat_count` INTEGER NOT NULL, PRIMARY KEY(`stream_id`, `access_date`), FOREIGN KEY(`stream_id`) REFERENCES `streams`(`uid`) ON UPDATE CASCADE ON DELETE CASCADE )',
  'CREATE TABLE `stream_state` (`stream_id` INTEGER NOT NULL, `progress_time` INTEGER NOT NULL, PRIMARY KEY(`stream_id`), FOREIGN KEY(`stream_id`) REFERENCES `streams`(`uid`) ON UPDATE CASCADE ON DELETE CASCADE )',
  'CREATE TABLE `playlists` (`uid` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `name` TEXT, `is_thumbnail_permanent` INTEGER NOT NULL, `thumbnail_stream_id` INTEGER NOT NULL, `display_index` INTEGER NOT NULL)',
  'CREATE TABLE `playlist_stream_join` (`playlist_id` INTEGER NOT NULL, `stream_id` INTEGER NOT NULL, `join_index` INTEGER NOT NULL, PRIMARY KEY(`playlist_id`, `join_index`))',
  'CREATE TABLE `feed_group` (`uid` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `name` TEXT NOT NULL, `icon_id` INTEGER NOT NULL, `sort_order` INTEGER NOT NULL)',
  'CREATE TABLE `feed_group_subscription_join` (`group_id` INTEGER NOT NULL, `subscription_id` INTEGER NOT NULL, PRIMARY KEY(`group_id`, `subscription_id`))',
]

const CHANNEL = 'UCaaaaaaaaaaaaaaaaaaaaaa'

async function createBackup() {
  const directory = await mkdtemp(join(tmpdir(), 'newpipe-import-'))
  try {
    const path = join(directory, 'newpipe.db')
    const database = new DatabaseSync(path)
    for (const statement of SCHEMA) database.exec(statement)
    const run = (sql, ...values) => database.prepare(sql).run(...values)

    run('INSERT INTO subscriptions (service_id, url, name, avatar_url, notification_mode) VALUES (0, ?, ?, ?, 0)', `https://www.youtube.com/channel/${CHANNEL}`, 'Channel', 'https://yt3.example/avatar')
    run('INSERT INTO subscriptions (service_id, url, name, notification_mode) VALUES (1, ?, ?, 0)', 'https://soundcloud.com/someone', 'Elsewhere')
    run('INSERT INTO feed_group (name, icon_id, sort_order) VALUES (?, 0, 0)', 'Music')
    run('INSERT INTO feed_group_subscription_join (group_id, subscription_id) VALUES (1, 1)')

    const addStream = (serviceId, url, title, type, duration, uploadDate = null) => run(
      'INSERT INTO streams (service_id, url, title, stream_type, duration, uploader, uploader_url, upload_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      serviceId, url, title, type, duration, 'Channel', `https://www.youtube.com/channel/${CHANNEL}`, uploadDate
    )
    addStream(0, 'https://www.youtube.com/watch?v=aaaaaaaaaaa', 'Started', 'VIDEO_STREAM', 600, 1_600_000_000_000)
    addStream(0, 'https://www.youtube.com/watch?v=bbbbbbbbbbb', 'Finished', 'VIDEO_STREAM', 300)
    addStream(0, 'https://www.youtube.com/watch?v=ccccccccccc', 'Live', 'LIVE_STREAM', 0)
    addStream(1, 'https://soundcloud.com/someone/track', 'Track', 'AUDIO_STREAM', 200)
    // Watched twice, the last time after the other videos
    run('INSERT INTO stream_history VALUES (1, 1000, 1), (1, 4000, 1), (2, 2000, 1), (3, 3000, 1), (4, 5000, 1)')
    run('INSERT INTO stream_state VALUES (1, 30000), (2, 299000)')

    run('INSERT INTO playlists (name, is_thumbnail_permanent, thumbnail_stream_id, display_index) VALUES (?, 0, -1, 0), (?, 0, -1, 1), (?, 0, -1, 2)', 'Mix', 'Tracks', 'Empty')
    run('INSERT INTO playlist_stream_join VALUES (1, 2, 1), (1, 1, 0), (1, 4, 2), (1, 1, 3), (2, 4, 0)')

    run('INSERT INTO search_history (creation_date, service_id, search) VALUES (100, 0, ?), (200, 0, ?), (300, 0, ?), (400, 1, ?)', 'first', 'second', 'first', 'elsewhere')
    database.close()
    const zip = zipSync({ 'newpipe.db': new Uint8Array(await readFile(path)), 'preferences.json': strToU8('{}') })
    return new Blob([zip])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const backup = await createBackup()

test('NewPipe subscriptions keep their groups', async () => {
  assert.deepEqual(await readNewPipeBackup({ file: backup, section: 'subscriptions' }), [
    { id: CHANNEL, name: 'Channel', thumbnail: 'https://yt3.example/avatar', groups: ['Music'] },
  ])
})

test('NewPipe watch history keeps the last watch time and resume position of YouTube videos', async () => {
  const records = await readNewPipeBackup({ file: backup, section: 'history' })
  assert.deepEqual(records.map(({ videoId, timeWatched, watchProgress, isWatched, lengthSeconds, isLive, published }) =>
    ({ videoId, timeWatched, watchProgress, isWatched, lengthSeconds, isLive, published })), [
    { videoId: 'aaaaaaaaaaa', timeWatched: 4000, watchProgress: 30, isWatched: false, lengthSeconds: 600, isLive: false, published: 1_600_000_000_000 },
    { videoId: 'bbbbbbbbbbb', timeWatched: 2000, watchProgress: 299, isWatched: true, lengthSeconds: 300, isLive: false, published: 0 },
    { videoId: 'ccccccccccc', timeWatched: 3000, watchProgress: 0, isWatched: true, lengthSeconds: null, isLive: true, published: 0 },
  ])
  assert.equal(records[0].title, 'Started')
  assert.equal(records[0].authorId, CHANNEL)
})

test('NewPipe playlists keep their order and skip other services', async () => {
  const playlists = await readNewPipeBackup({ file: backup, section: 'playlists' })
  assert.deepEqual(playlists.map(({ playlistName, videos }) => [playlistName, videos.map(video => video.videoId)]), [
    ['Mix', ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'aaaaaaaaaaa']],
    ['Empty', []],
  ])
  const [first, second] = playlists[0].videos
  assert.ok(first.timeAdded < second.timeAdded)
  assert.deepEqual({ ...first, timeAdded: 0 }, {
    videoId: 'aaaaaaaaaaa', title: 'Started', author: 'Channel', authorId: CHANNEL, lengthSeconds: 600, published: 1_600_000_000_000, timeAdded: 0,
  })
})

test('NewPipe search history keeps the latest time of each YouTube search', async () => {
  assert.deepEqual(await readNewPipeBackup({ file: backup, section: 'searchHistory' }), [
    { _id: 'first', query: 'first', lastUpdatedAt: 300 },
    { _id: 'second', query: 'second', lastUpdatedAt: 200 },
  ])
})

test('ZIP files without a NewPipe database are no NewPipe backup', async () => {
  assert.equal(await readNewPipeBackup({ file: new Blob([zipSync({ 'other.json': strToU8('{}') })]), section: 'history' }), null)
  assert.equal(await readNewPipeBackup({ file: new Blob([strToU8('not a zip')]), section: 'history' }), null)
})
