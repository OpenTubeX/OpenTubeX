import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { strToU8, Zip, ZipDeflate, zipSync } from 'fflate'

import { classifyTakeoutEntry, forEachSelectedTakeoutZipEntry, isSupportedTakeoutEntry, listYouTubeTakeoutZipEntries, parseTakeoutPlaylistCsv, parseTakeoutPlaylistMetadataCsv, readTakeoutPlaylistMetadata } from '../../src/renderer/helpers/youtube-takeout-zip.js'

test('does not announce complete success after an empty playlist fails and a later playlist succeeds', async () => {
  const source = await readFile(new URL('../../src/renderer/components/DataSettings/DataSettings.vue', import.meta.url), 'utf8')
  const messages = []
  const imported = []
  const busy = { value: false }
  let closed = false
  const context = vm.createContext({
    takeoutBusy: busy,
    selectedTakeoutTypes: { value: ['playlists'] },
    takeoutEntries: { value: [] },
    takeoutFile: { value: new Blob() },
    readTakeoutPlaylistMetadata: async () => ({ errors: [], metadata: new Map([
      ['playlists/Failed-videos.csv', { playlistName: 'Failed' }],
      ['playlists/Success-videos.csv', { playlistName: 'Success' }],
    ]) }),
    forEachSelectedTakeoutZipEntry: async () => {},
    importTakeoutPlaylist: async playlist => {
      imported.push(playlist.playlistName)
      if (playlist.playlistName === 'Failed') { throw new Error('Database write failed') }
    },
    console: { error() {} },
    t: key => key,
    showToast: options => messages.push(options.message),
    closeTakeoutImport: () => { closed = true },
  })
  vm.runInContext(source.slice(source.indexOf('async function importSelectedTakeoutData()'), source.indexOf('function openProfileSettings()')), context)
  await context.importSelectedTakeoutData()
  assert.deepEqual(imported, ['Failed', 'Success'])
  assert.deepEqual(messages, ['Settings.Data Settings.Unable to read file: playlists/Failed-videos.csv'])
  assert.equal(closed, true)
  assert.equal(busy.value, false)
})

test('uses Takeout metadata instead of the sanitized video filename', () => {
  const metadata = {
    playlistName: 'Sets (Techno/Trance/Hard House/UKG)',
    description: 'Sets',
    createdAt: Date.parse('2023-03-29T08:20:30+00:00'),
    lastUpdatedAt: Date.parse('2026-10-01T19:20:15+00:00'),
  }
  const playlist = parseTakeoutPlaylistCsv(
    'Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00',
    'Sets (Techno_Trance_Hard House_UKG)-videos.csv',
    metadata
  )
  assert.deepEqual(playlist, {
    ...metadata,
    videos: [{ videoId: 'abcdefghijk', title: 'abcdefghijk', lengthSeconds: 0, timeAdded: Date.parse('2025-01-01T00:00:00+00:00') }],
  })
})

test('detects supported Takeout entries under the archive root', () => {
  const root = 'takeout-001/Takeout/YouTube and YouTube Music'
  assert.equal(classifyTakeoutEntry(`${root}/subscriptions/subscriptions.csv`), 'subscriptions')
  assert.equal(classifyTakeoutEntry(`${root}/history/watch-history.json`), 'history')
  assert.equal(classifyTakeoutEntry(`${root}/history/search-history.json`), 'searchHistory')
  assert.equal(classifyTakeoutEntry(`${root}/playlists/My list.csv`), 'playlists')
  assert.equal(classifyTakeoutEntry(`${root}/videos/my-video.mp4`), null)
  assert.equal(classifyTakeoutEntry(`${root}/playlists/playlists.csv`), 'playlistMetadata')
})

const metadataHeader = 'Playlist ID,Playlist Title (Original),Playlist Description (Original),Playlist Create Timestamp,Playlist Update Timestamp'

test('invalidates repeated metadata entries for an account while retaining other accounts', async () => {
  const chunks = []
  const zip = new Zip((error, chunk) => {
    if (error) { throw error }
    chunks.push(chunk)
  })
  for (const [path, content] of [
    ['Repeated account/playlists/playlists.csv', `${metadataHeader}\nPLfirst,First,Original,,`],
    ['Good account/playlists/playlists.csv', `${metadataHeader}\nPLgood,Good,List,,`],
    ['Repeated account/playlists/playlists.csv', `${metadataHeader}\nPLfirst,First,Replacement,,\nPLsecond,Second,,,`],
  ]) {
    const entry = new ZipDeflate(path)
    zip.add(entry)
    entry.push(strToU8(content), true)
  }
  zip.end()
  const { metadata, errors } = await readTakeoutPlaylistMetadata(new Blob(chunks))
  assert.equal(metadata.size, 1)
  assert.equal(metadata.get('Good account/playlists/Good-videos.csv').description, 'List')
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /Duplicate playlist metadata.*Repeated account/)
})

for (const [schema, badMetadata] of [
  ['malformed', 'wrong header\n'],
  ['localized', '播放清單 ID,標題\nPLbad,清單\n'],
  ['ambiguous', `${metadataHeader}\nPLone,A/B,,,\nPLtwo,A_B,,,`],
]) {
  for (const badFirst of [true, false]) {
    test(`retains valid account metadata with ${schema} metadata in another account, invalid first: ${badFirst}`, async () => {
      const valid = ['Good account/playlists/playlists.csv', strToU8(`${metadataHeader}\nPLgood,Good/List,Description,2024-01-01T00:00:00Z,2025-01-01T00:00:00Z\nPLempty,Empty,,,`)]
      const invalid = ['Bad account/playlists/playlists.csv', strToU8(badMetadata)]
      const archive = zipSync(Object.fromEntries(badFirst ? [invalid, valid] : [valid, invalid]))
      const { metadata, errors } = await readTakeoutPlaylistMetadata(new Blob([archive]))
      assert.equal(metadata.size, 2)
      assert.deepEqual(metadata.get('Good account/playlists/Good_List-videos.csv'), {
        playlistName: 'Good/List', description: 'Description',
        createdAt: Date.parse('2024-01-01T00:00:00Z'), lastUpdatedAt: Date.parse('2025-01-01T00:00:00Z'),
      })
      assert.equal(metadata.get('Good account/playlists/Empty-videos.csv').playlistName, 'Empty')
      assert.equal(errors.length, 1)
      assert.match(errors[0].message, /Bad account\/playlists\//)
    })
  }
}

test('parses reordered metadata columns, BOM, CRLF and quoted multiline descriptions', () => {
  const content = '\uFEFFPlaylist Description (Original),Playlist Title (Original),Playlist ID,Playlist Update Timestamp,Playlist Create Timestamp\r\n"First, second\r\nSay ""hello""","A/B-videos",PLexample,2025-02-01T00:00:00Z,2024-01-01T00:00:00Z\r\n'
  assert.deepEqual(parseTakeoutPlaylistMetadataCsv(content), [{
    playlistName: 'A/B-videos', description: 'First, second\r\nSay "hello"',
    createdAt: Date.parse('2024-01-01T00:00:00Z'), lastUpdatedAt: Date.parse('2025-02-01T00:00:00Z'),
  }])
  assert.deepEqual(parseTakeoutPlaylistMetadataCsv('Playlist ID,Playlist Title (Original)\nPLempty,Empty'), [{ playlistName: 'Empty' }])
})

test('rejects malformed playlist metadata rather than attaching it to the wrong playlist', () => {
  for (const content of [
    'wrong header',
    `${metadataHeader}\nPLexample,Title,Description,not-a-date,`,
    `${metadataHeader}\nPLexample,Title,Description`,
    `${metadataHeader}\nPLexample, ,Description,,`,
    `${metadataHeader}\nPLexample,"unclosed,Description,,`,
    `${metadataHeader}\nPLexample,"Title"junk,Description,,`,
  ]) {
    assert.equal(parseTakeoutPlaylistMetadataCsv(content), null)
  }
})

test('reads late metadata separately, scopes it to its account, and includes empty playlists', async () => {
  const root = 'Takeout/YouTube and YouTube Music/playlists'
  const archive = zipSync({
    [`${root}/A_B-videos-videos.csv`]: strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z'),
    [`${root}/playlists.csv`]: strToU8(`${metadataHeader}\nPLone,A/B-videos,First account,2024-01-01T00:00:00Z,\nPLempty,Empty,,,\nPLquote,It's music,,,`),
    'Another account/playlists/playlists.csv': strToU8(`${metadataHeader}\nPLtwo,A_B-videos,Second account,,`),
  })
  const file = new Blob([archive])
  const listed = await listYouTubeTakeoutZipEntries(file)
  assert.deepEqual(listed.map(entry => entry.type), ['playlists', 'playlists', 'playlists'])
  const { metadata, errors } = await readTakeoutPlaylistMetadata(file)
  assert.deepEqual(errors, [])
  assert.equal(metadata.get(`${root}/A_B-videos-videos.csv`).playlistName, 'A/B-videos')
  assert.equal(metadata.get(`${root}/Empty-videos.csv`).playlistName, 'Empty')
  assert.equal(metadata.get(`${root}/It_s music-videos.csv`).playlistName, "It's music")
  assert.equal(metadata.get('Another account/playlists/A_B-videos-videos.csv').description, 'Second account')
  const entries = []
  await forEachSelectedTakeoutZipEntry(file, new Set(['playlists']), entry => entries.push(entry))
  assert.equal(entries.length, 1)
  assert.equal(parseTakeoutPlaylistCsv(entries[0].content, 'A_B-videos-videos.csv', metadata.get(entries[0].path)).playlistName, 'A/B-videos')
})

test('rejects ambiguous sanitized filenames within an account', async () => {
  const archive = zipSync({
    'Takeout/YouTube/playlists/playlists.csv': strToU8(`${metadataHeader}\nPLone,A/B,,,\nPLtwo,A_B,,,`),
  })
  const { metadata, errors } = await readTakeoutPlaylistMetadata(new Blob([archive]))
  assert.equal(metadata.size, 0)
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /Ambiguous playlist metadata/)
})

test('lists supported entries and reads only selected archive content', async () => {
  const root = 'Takeout/YouTube and YouTube Music'
  const archive = zipSync({
    [`${root}/subscriptions/subscriptions.csv`]: strToU8('Channel Id,Channel Url,Channel Title\nUC123,https://youtube.com/channel/UC123,Example'),
    [`${root}/history/watch-history.json`]: strToU8('[]'),
    [`${root}/playlists/Favorites.csv`]: strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00'),
    [`${root}/videos/movie.mp4`]: new Uint8Array(100000),
  })
  const file = new Blob([archive])
  const listed = await listYouTubeTakeoutZipEntries(file)
  assert.deepEqual(listed.map(entry => entry.type).sort(), ['history', 'playlists', 'subscriptions'])
  assert.equal(listed.every(entry => !Object.hasOwn(entry, 'content')), true)
  const entries = []
  await forEachSelectedTakeoutZipEntry(file, new Set(['history']), entry => entries.push(entry))
  assert.deepEqual(entries.map(entry => entry.type), ['history'])
  assert.equal(entries[0].content, '[]')
  assert.equal(isSupportedTakeoutEntry(entries[0]), true)
  assert.equal(isSupportedTakeoutEntry({ type: 'history', path: 'history/watch-history.json', content: '<html />' }), false)
})

test('rejects oversized selected entries before inflation', async () => {
  const archive = zipSync({ 'Takeout/YouTube/history/watch-history.json': strToU8('[]') })
  new DataView(archive.buffer).setUint32(22, 256 * 1024 * 1024 + 1, true)
  const file = new Blob([archive])
  assert.equal((await listYouTubeTakeoutZipEntries(file)).length, 1)
  await assert.rejects(
    forEachSelectedTakeoutZipEntry(file, new Set(['history']), () => {}),
    /Takeout entry is too large/
  )
})

test('parses Takeout playlist CSV and rejects other CSV files', () => {
  assert.deepEqual(parseTakeoutPlaylistCsv('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00\n', 'My list.csv'), {
    playlistName: 'My list',
    videos: [{ videoId: 'abcdefghijk', title: 'abcdefghijk', lengthSeconds: 0, timeAdded: Date.parse('2025-01-01T00:00:00+00:00') }],
  })
  assert.equal(parseTakeoutPlaylistCsv('wrong header\n', 'My list.csv'), null)
  assert.equal(parseTakeoutPlaylistCsv('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00\ninvalid row', 'My list.csv'), null)
  const quotedPlaylist = parseTakeoutPlaylistCsv('Video ID,Playlist video creation timestamp\n"abcdefghijk","2025-01-01T00:00:00+00:00"', 'My list.csv')
  assert.deepEqual(quotedPlaylist.videos.map(video => video.videoId), ['abcdefghijk'])
  assert.notEqual(parseTakeoutPlaylistCsv('Video ID,Playlist Video Creation Timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00', 'My list.csv'), null)
  assert.notEqual(parseTakeoutPlaylistCsv('影片 ID,播放清單影片的建立時間戳記\nabcdefghijk,2025-01-01T00:00:00+00:00', 'My list.csv'), null)
  assert.equal(parseTakeoutPlaylistCsv('Video,Timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00', 'My list.csv'), null)
})

test('strips only the final Takeout video-file suffix from playlist names', () => {
  const content = 'Video ID,Playlist Video Creation Timestamp\nabcdefghijk,2025-01-01T00:00:00+00:00\n'
  for (const [filename, playlistName] of [
    ['Favorites-videos.csv', 'Favorites'],
    ['Favorites-videos.CSV', 'Favorites'],
    ['Favorites.csv', 'Favorites'],
    ['My-videos collection-videos.csv', 'My-videos collection'],
    ['My-videos-videos.csv', 'My-videos'],
    ['旅行-videos.csv', '旅行'],
  ]) {
    assert.equal(parseTakeoutPlaylistCsv(content, filename).playlistName, playlistName)
  }
})

test('parses Takeout playlist CSV with spaces before dash-prefixed video IDs', () => {
  for (const idField of [' -abcdefghij', '   -abcdefghij', '  "-abcdefghij"']) {
    for (const newline of ['\n', '\r\n']) {
      const content = `Video ID,Playlist video creation timestamp${newline}abcdefghijk,2025-01-01T00:00:00+00:00${newline}${idField},2025-01-02T00:00:00+00:00${newline}`
      assert.deepEqual(parseTakeoutPlaylistCsv(content, 'Favorites.csv'), {
        playlistName: 'Favorites',
        videos: [
          { videoId: 'abcdefghijk', title: 'abcdefghijk', lengthSeconds: 0, timeAdded: Date.parse('2025-01-01T00:00:00+00:00') },
          { videoId: '-abcdefghij', title: '-abcdefghij', lengthSeconds: 0, timeAdded: Date.parse('2025-01-02T00:00:00+00:00') },
        ],
      })
      assert.equal(isSupportedTakeoutEntry({ type: 'playlists', path: 'playlists/Favorites.csv', content }), true)
    }
  }
})

test('still rejects malformed Takeout playlist rows after removing leading spaces', () => {
  for (const row of [' -abcdefghi,2025-01-01T00:00:00+00:00', ' -abcd efghi,2025-01-01T00:00:00+00:00', ' -abcdefghij,invalid date']) {
    assert.equal(parseTakeoutPlaylistCsv(`Video ID,Playlist video creation timestamp\n${row}\n`, 'Favorites.csv'), null)
  }
})
