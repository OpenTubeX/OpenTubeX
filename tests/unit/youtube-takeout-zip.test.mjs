import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { strToU8, Unzip, UnzipInflate, Zip, ZipDeflate, zipSync } from 'fflate'

import { forEachSelectedTakeoutZipEntry, forEachTakeoutImportEntry, isSupportedTakeoutEntry, listYouTubeTakeoutZipEntries, parseTakeoutPlaylistCsv, parseTakeoutPlaylistMetadataCsv, readTakeoutPlaylistMetadata, sniffTakeoutEntry } from '../../src/renderer/helpers/youtube-takeout-zip.js'

test('does not announce complete success after an empty playlist fails and a later playlist succeeds', async () => {
  const source = await readFile(new URL('../../src/renderer/components/DataSettings/DataSettings.vue', import.meta.url), 'utf8')
  const messages = []
  const imported = []
  const busy = { value: false }
  let closed = false
  const context = vm.createContext({
    takeoutBusy: busy,
    takeoutPreviewReady: { value: true },
    selectedTakeoutTypes: { value: ['playlists'] },
    takeoutEntries: { value: [] },
    takeoutFile: { value: new Blob() },
    forEachTakeoutImportEntry: async (_file, _types, _entries, onEntry, onError) => {
      for (const name of ['Failed', 'Success']) {
        try { await onEntry({ type: 'playlists', playlist: { playlistName: name } }) } catch (error) { onError(error, 'playlists', `playlists/${name}-videos.csv`) }
      }
    },
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

const channelId = `UC${'c'.repeat(22)}`
const playlistId = `PL${'p'.repeat(32)}`
const watchHistory = JSON.stringify([{ header: 'YouTube', title: 'Watched video', titleUrl: 'https://www.youtube.com/watch?v=abcdefghijk', time: '2025-01-01T00:00:00Z', products: ['YouTube'] }])
const searchHistory = JSON.stringify([{ header: 'YouTube', title: 'Searched for query', titleUrl: 'https://www.youtube.com/results?search_query=query', time: '2025-01-01T00:00:00Z', products: ['YouTube'] }])

test('detects Takeout entries by content under any localized path', () => {
  const entries = [
    ['subscriptions', `Kanal-ID,Kanal-URL,Kanaltitel\n${channelId},http://www.youtube.com/channel/${channelId},Kanal\n`],
    ['history', watchHistory.replaceAll('=', '\\u003d')],
    ['searchHistory', searchHistory],
    ['playlists', '影片 ID,播放清單影片的建立時間戳記\n-abcdefghij,2025-01-01T00:00:00+00:00\n'],
    ['playlistMetadata', `Playlist-ID,Titel\n${playlistId},Liste\n`],
  ]
  for (const root of ['Takeout/YouTube and YouTube Music', 'Takeout/YouTube und YouTube Music', 'Takeout/YouTube 和 YouTube Music']) {
    for (const [type, content] of entries) {
      const extension = type.endsWith('istory') ? 'json' : 'csv'
      assert.equal(sniffTakeoutEntry(`${root}/Ordner/Datei.${extension}`, `\uFEFF${content}`, true), type)
    }
  }
  assert.equal(sniffTakeoutEntry('Takeout/YouTube/abonnements.opml', `<opml><body><outline xmlUrl="https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}" /></body></opml>`, true), 'subscriptions')
})

test('ignores unrelated or unrecognizable Takeout data', () => {
  for (const [path, content] of [
    ['videos/clip.mp4', 'Video ID,Timestamp\nabcdefghijk,2025-01-01T00:00:00Z'],
    ['playlists/Empty-videos.csv', 'Video ID,Playlist video creation timestamp\n'],
    ['channels/channel.csv', `Channel ID,Channel Title (Original),Channel Visibility\n${channelId},Me,Public\n`],
    ['comments/comments.csv', `Comment ID,Channel ID,Comment Create Timestamp,Video ID\nUgx,${channelId},2025-01-01T00:00:00Z,abcdefghijk\n`],
    ['history/watch-history.html', '<html />'],
    ['history/watch-history.json', '[]'],
    ['subscriptions/subscriptions.csv', `Channel Id,Channel Url,Channel Title\n${channelId},"unclosed\n`],
    // My Activity mixes watches and searches in one file.
    ['My Activity/YouTube/MyActivity.json', `[${watchHistory.slice(1, -1)},${searchHistory.slice(1, -1)}]`],
  ]) {
    assert.equal(sniffTakeoutEntry(path, content, true), null, path)
  }
})

test('classifies a partial head by its first complete record', () => {
  const row = 'abcdefghijk,2025-01-01T00:00:00Z\n'
  const head = `Video ID,Playlist video creation timestamp\n${row.repeat(3)}abcdef`
  assert.equal(sniffTakeoutEntry('playlists/List-videos.csv', head, false), 'playlists')
  const metadata = `Playlist ID,Playlist Description (Original)\n${playlistId},"Line one\nline two"\n${playlistId},"unfinished`
  assert.equal(sniffTakeoutEntry('playlists/playlists.csv', metadata, false), 'playlistMetadata')
  assert.equal(sniffTakeoutEntry('playlists/List-videos.csv', 'Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01', false), null)
})

test('imports localized playlist metadata by matching titles to file names', async () => {
  const root = 'Takeout/YouTube et YouTube Music/playlists'
  const header = 'ID de la playlist,Ajouter les nouvelles vidéos en haut,Titre de la playlist (original),Langue du titre de la playlist (original),Horodatage de création de la playlist,Horodatage de mise à jour de la playlist,Visibilité de la playlist'
  const file = new Blob([zipSync({
    [`${root}/Musique_Rock-vidéos.csv`]: strToU8('ID vidéo,Horodatage de création de la vidéo de la playlist\nabcdefghijk,2025-01-01T00:00:00+00:00\n'),
    [`${root}/Vide-vidéos.csv`]: strToU8('ID vidéo,Horodatage de création de la vidéo de la playlist\n'),
    [`${root}/playlists.csv`]: strToU8(`${header}\n${playlistId},False,Musique/Rock,fr,2024-01-01T00:00:00+00:00,2025-01-01T00:00:00+00:00,Privée\nPL${'v'.repeat(32)},False,Vide,,2024-02-01T00:00:00+00:00,2024-03-01T00:00:00+00:00,Privée\n`),
  })])
  const entries = await listYouTubeTakeoutZipEntries(file)
  assert.deepEqual(entries.map(entry => entry.path), [`${root}/Musique_Rock-vidéos.csv`, `${root}/playlists.csv`])
  const { metadata, errors } = await readTakeoutPlaylistMetadata(file)
  assert.deepEqual(errors, [])
  assert.deepEqual(metadata.get(`${root}/Musique_Rock-vidéos.csv`), {
    playlistName: 'Musique/Rock', createdAt: Date.parse('2024-01-01T00:00:00Z'), lastUpdatedAt: Date.parse('2025-01-01T00:00:00Z'),
  })
  assert.equal(metadata.get(`${root}/Vide-vidéos.csv`).playlistName, 'Vide')
  const playlists = []
  await forEachTakeoutImportEntry(file, new Set(['playlists']), entries, entry => playlists.push(entry.playlist), error => { throw error })
  assert.deepEqual(playlists.map(playlist => [playlist.playlistName, playlist.videos.map(video => video.videoId)]), [['Musique/Rock', ['abcdefghijk']], ['Vide', []]])
})

test('rejects localized playlist metadata whose title column cannot be identified', () => {
  const content = `Playlist-ID,Titel,Sichtbarkeit\n${playlistId},Liste,Privat\n`
  assert.equal(parseTakeoutPlaylistMetadataCsv(content, []), null)
  assert.deepEqual(parseTakeoutPlaylistMetadataCsv(content, ['Liste-Videos']), [{ playlistName: 'Liste' }])
  assert.equal(parseTakeoutPlaylistMetadataCsv(content, ['Liste-Videos', 'Privat-Videos']), null)
})

const metadataHeader = 'Playlist ID,Playlist Title (Original),Playlist Description (Original),Playlist Create Timestamp,Playlist Update Timestamp'

for (const [filename, title] of [
  ['My list.csv', 'My list'],
  ['My list.CSV', 'My list'],
  ['My list-VIDEOS.CSV', 'My list'],
  ['Sets_Techno-videos.csv', 'Sets/Techno-videos'],
]) {
  for (const metadataFirst of [true, false]) {
    test(`matches metadata to ${filename}, metadata first: ${metadataFirst}`, async () => {
      const root = 'Takeout/YouTube/playlists'
      const metadataEntry = [`${root}/playlists.csv`, strToU8(`${metadataHeader}\nPLold,${title},Description,2024-01-01T00:00:00Z,2025-01-01T00:00:00Z`)]
      const videoEntry = [`${root}/${filename}`, strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z')]
      const file = new Blob([zipSync(Object.fromEntries(metadataFirst ? [metadataEntry, videoEntry] : [videoEntry, metadataEntry]))])
      const { metadata, errors } = await readTakeoutPlaylistMetadata(file)
      assert.deepEqual(errors, [])
      assert.equal(metadata.size, 1)
      assert.deepEqual(metadata.get(`${root}/${filename}`), {
        playlistName: title, description: 'Description',
        createdAt: Date.parse('2024-01-01T00:00:00Z'), lastUpdatedAt: Date.parse('2025-01-01T00:00:00Z'),
      })
    })
  }
}

for (const suffixed of [false, true]) {
  test(`matches overlapping playlist titles one-to-one, suffixed files: ${suffixed}`, async () => {
    const root = 'Takeout/YouTube/playlists'
    const names = ['List', 'List-videos', 'List-videos-videos']
    const archive = zipSync(Object.fromEntries([
      [`${root}/playlists.csv`, strToU8(`${metadataHeader}\n${names.map((name, index) => `PL${index},${name},Description ${index},,`).join('\n')}`)],
      ...names.map(name => [`${root}/${name}${suffixed ? '-videos' : ''}.csv`, strToU8('Video ID,Playlist video creation timestamp')]),
    ]))
    const { metadata, errors } = await readTakeoutPlaylistMetadata(new Blob([archive]))
    assert.deepEqual(errors, [])
    assert.equal(metadata.size, 3)
    for (const [index, name] of names.entries()) {
      assert.equal(metadata.get(`${root}/${name}${suffixed ? '-videos' : ''}.csv`).description, `Description ${index}`)
    }
  })
}

test('rejects metadata rows that match the same discovered video file', async () => {
  const root = 'Takeout/YouTube/playlists'
  const file = new Blob([zipSync({
    [`${root}/playlists.csv`]: strToU8(`${metadataHeader}\nPLone,List,,,\nPLtwo,List-videos,,,`),
    [`${root}/List-videos.csv`]: strToU8('Video ID,Playlist video creation timestamp'),
  })])
  const { metadata, errors } = await readTakeoutPlaylistMetadata(file)
  assert.equal(metadata.size, 0)
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /Ambiguous playlist metadata/)
})

test('rejects uncertain metadata when one playlist could match either filename form', async () => {
  const root = 'Takeout/YouTube/playlists'
  const file = new Blob([zipSync({
    [`${root}/playlists.csv`]: strToU8(`${metadataHeader}\nPLone,List,Description,,`),
    [`${root}/List.csv`]: strToU8('Video ID,Playlist video creation timestamp\nabcdefghijk,2025-01-01T00:00:00Z'),
    [`${root}/List-videos.csv`]: strToU8('Video ID,Playlist video creation timestamp\nlmnopqrstuv,2025-01-02T00:00:00Z'),
  })])
  const { metadata, errors } = await readTakeoutPlaylistMetadata(file)
  assert.equal(metadata.size, 0)
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /Ambiguous playlist metadata/)
})

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
  ['malformed', `${metadataHeader}\nPLbad,Title,Description,not-a-date,\n`],
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
    [`${root}/subscriptions/subscriptions.csv`]: strToU8(`Channel Id,Channel Url,Channel Title\n${channelId},http://www.youtube.com/channel/${channelId},Example`),
    [`${root}/history/watch-history.json`]: strToU8(watchHistory),
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
  assert.equal(entries[0].content, watchHistory)
  assert.equal(isSupportedTakeoutEntry(entries[0]), true)
  assert.equal(isSupportedTakeoutEntry({ type: 'history', path: 'history/watch-history.json', content: '<html />' }), false)
})

test('rejects oversized selected entries before inflation', async () => {
  const archive = zipSync({ 'Takeout/YouTube/history/watch-history.json': strToU8(watchHistory) })
  new DataView(archive.buffer).setUint32(22, 256 * 1024 * 1024 + 1, true)
  const file = new Blob([archive])
  assert.equal((await listYouTubeTakeoutZipEntries(file)).length, 1)
  await assert.rejects(
    forEachSelectedTakeoutZipEntry(file, new Set(['history']), () => {}),
    /Takeout entry is too large/
  )
})

test('stops inflating an understated entry after the output limit while retaining later files', async () => {
  const source = await readFile(new URL('../../src/renderer/helpers/youtube-takeout-zip.js', import.meta.url), 'utf8')
  let historyPushes = 0
  class OversizedInflate extends UnzipInflate {
    constructor(name) {
      super()
      this.history = name.endsWith('watch-history.json')
    }

    push(chunk, final) {
      if (this.history) {
        historyPushes++
        // Classify the entry from a real head, then exercise the real limit
        // without allocating a 256 MiB test fixture.
        this.ondata(null, strToU8(watchHistory.padEnd(64 * 1024)), false)
        this.ondata(null, { length: 256 * 1024 * 1024 + 1 }, final)
      } else {
        super.push(chunk, final)
      }
    }
  }
  const context = vm.createContext({ Unzip, UnzipInflate: OversizedInflate, TextDecoder, Uint8Array })
  vm.runInContext(source.replace(/^import .*\n/m, '').replaceAll('export ', ''), context)
  const archive = zipSync({
    'Account/history/watch-history.json': strToU8('[123456789]'),
    'Account/subscriptions/subscriptions.csv': strToU8(`Channel Id,Channel Url,Channel Title\n${channelId},http://www.youtube.com/channel/${channelId},New`),
  })
  const header = new DataView(archive.buffer)
  header.setUint32(22, 1, true)
  const firstChunkEnd = 30 + header.getUint16(26, true) + header.getUint16(28, true) + 1
  const file = {
    stream: () => new ReadableStream({
      start(controller) {
        controller.enqueue(archive.subarray(0, firstChunkEnd))
        controller.enqueue(archive.subarray(firstChunkEnd))
        controller.close()
      },
    }),
  }
  const entries = []
  const errors = []
  await context.forEachSelectedTakeoutZipEntry(file, new Set(['history', 'subscriptions']), entry => entries.push(entry), error => errors.push(error))
  assert.equal(historyPushes, 1, 'No further compressed chunks should reach the failed inflater')
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /Takeout entry is too large/)
  assert.deepEqual(entries.map(entry => entry.type), ['subscriptions'])
  assert.match(entries[0].content, /,New$/)
})

for (const unreadableFirst of [true, false]) {
  test(`invalidates account metadata when a duplicate cannot be inflated, unreadable first: ${unreadableFirst}`, async () => {
    const chunks = []
    const zip = new Zip((error, chunk) => {
      if (error) throw error
      chunks.push(chunk)
    })
    const duplicatePath = 'Repeated account/playlists/playlists.csv'
    for (const unreadable of unreadableFirst ? [true, false] : [false, true]) {
      const entry = new ZipDeflate(duplicatePath)
      zip.add(entry)
      const chunkIndex = chunks.length
      entry.push(strToU8(`${metadataHeader}\nPLfirst,First,Original,,`), true)
      if (unreadable) chunks[chunkIndex + 1][0] = 7 // Reserved DEFLATE block type after the local header.
    }
    const good = new ZipDeflate('Good account/playlists/playlists.csv')
    zip.add(good)
    good.push(strToU8(`${metadataHeader}\nPLgood,Good,List,,`), true)
    zip.end()
    const { metadata, errors } = await readTakeoutPlaylistMetadata(new Blob(chunks))
    assert.equal(metadata.size, 1)
    assert.equal(metadata.get('Good account/playlists/Good-videos.csv').description, 'List')
    assert.ok(errors.length > 0)
  })
}

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
  assert.notEqual(parseTakeoutPlaylistCsv('Video-ID,Zeitstempel\nabcdefghijk,2025-01-01T00:00:00+00:00', 'My list.csv'), null)
  assert.equal(parseTakeoutPlaylistCsv('Video ID,Title,Timestamp\nabcdefghijk,Title,2025-01-01T00:00:00+00:00', 'My list.csv'), null)
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
