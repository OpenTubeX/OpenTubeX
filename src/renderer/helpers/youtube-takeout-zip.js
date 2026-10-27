import { Unzip, UnzipInflate } from 'fflate'

const MAX_ENTRY_SIZE = 256 * 1024 * 1024
// Enough decoded text to classify an entry by its first records.
const SNIFF_SIZE = 64 * 1024
const CANDIDATE_PATTERN = /\.(?:csv|json|opml)$/i
const CHANNEL_ID_PATTERN = /^UC[\w-]{22}$/
const PLAYLIST_ID_PATTERN = /^PL[\w-]+$/
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/
const ACTIVITY_URL_PATTERN = /"titleUrl"\s*:\s*"https:\/\/www\.youtube\.com\/(watch\?v|results\?search_query)/g

/**
 * Classify an entry by its content. Takeout localizes folder names, file
 * names and CSV headers, so only IDs, URLs, timestamps and structure count.
 * @param {string} path
 * @param {string} head The decoded start of the entry.
 * @param {boolean} complete Whether `head` holds the whole entry.
 */
export function sniffTakeoutEntry(path, head, complete) {
  const extension = path.match(CANDIDATE_PATTERN)?.[0].toLowerCase()
  const text = head.replace(/^\uFEFF/, '')
  if (extension === '.opml') {
    return /<opml[\s>]/i.test(text) && text.includes('channel_id') ? 'subscriptions' : null
  }
  if (extension === '.json') {
    if (!text.trimStart().startsWith('[')) { return null }
    if (/"resourceId"\s*:\s*\{[^{}]*"channelId"/.test(text)) { return 'subscriptions' }
    // My Activity mixes watches and searches; YouTube's own export splits them.
    const kinds = new Set(Array.from(text.matchAll(ACTIVITY_URL_PATTERN), match => match[1]))
    if (kinds.size !== 1) { return null }
    return kinds.has('watch?v') ? 'history' : 'searchHistory'
  }
  if (extension !== '.csv') { return null }
  // Judge only the first record, so a damaged file is reported rather than ignored.
  const lines = complete ? text : text.slice(0, text.lastIndexOf('\n') + 1)
  const [header, ...rows] = lines.split(/\r?\n/)
  const firstRow = rows.find(row => row.trim() !== '')
  if (firstRow === undefined) { return null }
  if (parseCsvRecords(header)?.[0]?.length === 2 && parseTakeoutPlaylistVideoRow(firstRow) !== null) {
    return 'playlists'
  }
  const records = parseCsvRecords(lines, !complete)
  const record = records?.slice(1).find(values => values.some(value => value.trim() !== ''))
  if (record === undefined || record.length !== records[0].length) { return null }
  if (record.length === 3 && CHANNEL_ID_PATTERN.test(record[0]) && record[1].includes(record[0])) {
    return 'subscriptions'
  }
  if (record.length >= 2 && record.some(value => PLAYLIST_ID_PATTERN.test(value))) {
    return 'playlistMetadata'
  }
  return null
}

/** Drop compressed bytes for entries that are not selected. */
class SkipDeflate {
  static compression = 8

  push(_chunk, final) {
    if (final) { this.ondata(null, new Uint8Array(0), true) }
  }
}

/**
 * Stream candidate entries, classifying each from its first decoded bytes and
 * inflating the rest only when its type is selected.
 * `onFound` receives every candidate and its decoded start, with a null type
 * when it is unsupported.
 */
async function streamTakeoutZip(file, selectedTypes, onFound, onContent, onEntryError) {
  const pending = []
  let failure

  class SelectiveInflate {
    static compression = 8

    constructor(name, compressedSize, originalSize) {
      this.decoder = CANDIDATE_PATTERN.test(name)
        ? new UnzipInflate(name, compressedSize, originalSize)
        : new SkipDeflate()
      this.decoder.ondata = (error, data, final) => this.ondata(error, data, final)
    }

    push(chunk, final) {
      this.decoder?.push(chunk, final)
    }

    terminate() {
      this.decoder = null
    }
  }

  const unzip = new Unzip(entry => {
    if (!CANDIDATE_PATTERN.test(entry.name)) {
      entry.ondata = () => {}
      entry.start()
      return
    }
    let type
    let done = false
    const stop = () => {
      done = true
      entry.terminate()
    }
    const reportError = error => {
      if (done) return
      stop()
      if (onEntryError) onEntryError(error, { type: type ?? null, path: entry.name })
      else failure = error
    }
    const decoder = new TextDecoder()
    let content = ''
    let size = 0
    entry.ondata = (error, chunk, final) => {
      if (done) return
      if (error) {
        reportError(error)
        return
      }
      size += chunk.length
      if (size > MAX_ENTRY_SIZE) {
        reportError(new Error(`Takeout entry is too large: ${entry.name}`))
        return
      }
      content += decoder.decode(chunk, { stream: !final })
      if (type === undefined && (content.length >= SNIFF_SIZE || final)) {
        type = sniffTakeoutEntry(entry.name, content, final)
        onFound({ type, path: entry.name, head: content })
        if (type === null || !selectedTypes.has(type)) {
          stop()
          return
        }
        if (entry.originalSize > MAX_ENTRY_SIZE) {
          reportError(new Error(`Takeout entry is too large: ${entry.name}`))
          return
        }
      }
      if (final) {
        done = true
        pending.push({ type, path: entry.name, content })
      }
    }
    entry.start()
  })
  unzip.register(SelectiveInflate)

  const reader = file.stream().getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) { break }
      unzip.push(value)
      if (failure) { throw failure }
      for (const entry of pending.splice(0)) {
        await onContent(entry)
      }
    }
    unzip.push(new Uint8Array(0), true)
    if (failure) { throw failure }
    for (const entry of pending) {
      await onContent(entry)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/** Discover supported paths, inflating only the start of data files and never videos. */
export async function listYouTubeTakeoutZipEntries(file) {
  const entries = []
  await streamTakeoutZip(file, new Set(), entry => {
    if (entry.type !== null) {
      entries.push({ type: entry.type === 'playlistMetadata' ? 'playlists' : entry.type, path: entry.path })
    }
  }, () => {}, () => {})
  return entries
}

/** Import selected entries one at a time, bounding renderer memory. */
export async function forEachSelectedTakeoutZipEntry(file, types, onEntry, onEntryError) {
  // Unreadable entries that could not be classified are unrelated as far as we know.
  await streamTakeoutZip(file, types, () => {}, onEntry, onEntryError && ((error, entry) => {
    if (entry.type !== null) onEntryError(error, entry)
  }))
}

export function getTakeoutPlaylistName(filename) {
  return filename.replace(/(?:-videos)?\.csv$/i, '')
}

/**
 * Parse CSV records, including quoted commas, escaped quotes and line breaks.
 * With `partial`, return only the records completed before the content ends.
 */
export function parseCsvRecords(content, partial = false) {
  const records = []
  let record = []
  let field = ''
  let quoted = false
  let closedQuote = false
  const text = content.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          closedQuote = true
        }
      } else {
        field += char
      }
    } else if (char === ',' || char === '\n' || char === '\r') {
      record.push(field)
      field = ''
      closedQuote = false
      if (char !== ',') {
        records.push(record)
        record = []
        if (char === '\r' && text[i + 1] === '\n') { i++ }
      }
    } else if (char === '"' && field === '' && !closedQuote) {
      quoted = true
    } else if (char === '"' || closedQuote) {
      return null
    } else {
      field += char
    }
  }
  if (partial) { return records }
  if (quoted) { return null }
  if (field !== '' || record.length > 0 || closedQuote) {
    records.push([...record, field])
  }
  return records
}

/** Takeout replaces filename-unsafe characters, including slashes, with underscores. */
function sanitizeTakeoutFilename(name) {
  return name.replaceAll(/[<>:"'/\\|?*\p{Cc}]/gu, '_')
}

/**
 * Locate metadata columns. English headers name them; other languages
 * translate the headers, so infer the columns from their values instead:
 * titles name the playlist files, and the two timestamps keep their order.
 * Descriptions cannot be told apart from other text columns, so they are
 * read only from English headers.
 */
function findPlaylistMetadataColumns(headers, rows, fileNames) {
  const title = headers.indexOf('Playlist Title (Original)')
  if (title !== -1 && headers.includes('Playlist ID')) {
    return {
      title,
      description: headers.indexOf('Playlist Description (Original)'),
      createdAt: headers.indexOf('Playlist Create Timestamp'),
      lastUpdatedAt: headers.indexOf('Playlist Update Timestamp'),
    }
  }
  const indexes = headers.map((_, index) => index)
  const ids = indexes.filter(index => rows.length > 0 && rows.every(row => PLAYLIST_ID_PATTERN.test(row[index])))
  if (ids.length === 0) { return null }
  const timestamps = indexes.filter(index => rows.some(row => row[index]) && rows.every(row => !row[index] || TIMESTAMP_PATTERN.test(row[index])))
  let best = { index: -1, score: 0 }
  let tied = false
  for (const index of indexes) {
    if (ids.includes(index) || timestamps.includes(index) || rows.some(row => !row[index].trim())) { continue }
    const score = rows.filter(row => {
      const filename = sanitizeTakeoutFilename(row[index])
      return fileNames.some(name => name.startsWith(filename))
    }).length
    if (score > best.score) {
      best = { index, score }
      tied = false
    } else if (score > 0 && score === best.score) {
      tied = true
    }
  }
  if (best.index === -1 || tied) { return null }
  const [createdAt, lastUpdatedAt] = timestamps.length === 2 ? timestamps : [-1, -1]
  return { title: best.index, description: -1, createdAt, lastUpdatedAt }
}

/**
 * @param {string} content
 * @param {string[]} fileNames Other CSV names in the same directory, without extensions.
 */
export function parseTakeoutPlaylistMetadataCsv(content, fileNames = []) {
  const records = parseCsvRecords(content)
  if (!records?.length) { return null }
  const headers = records[0]
  const rows = records.slice(1).filter(record => record.length !== 1 || record[0] !== '')
  if (rows.some(row => row.length !== headers.length)) { return null }
  const columns = findPlaylistMetadataColumns(headers, rows, fileNames)
  if (columns === null) { return null }
  const playlists = []
  for (const row of rows) {
    if (!row[columns.title].trim()) { return null }
    const playlist = { playlistName: row[columns.title] }
    if (columns.description !== -1) { playlist.description = row[columns.description] }
    for (const property of ['createdAt', 'lastUpdatedAt']) {
      const value = row[columns[property]]
      if (value) {
        const timestamp = Date.parse(value)
        if (!Number.isFinite(timestamp)) { return null }
        playlist[property] = timestamp
      }
    }
    playlists.push(playlist)
  }
  return playlists
}

/**
 * Learn the localized suffix of playlist video files, such as "-videos", from
 * the most common remainder after a playlist title. Older exports have none.
 */
function findTakeoutPlaylistFileSuffix(titles, fileNames) {
  const counts = new Map()
  for (const title of titles) {
    for (const name of fileNames) {
      if (name.startsWith(title)) {
        const suffix = name.slice(title.length).toLowerCase()
        counts.set(suffix, (counts.get(suffix) ?? 0) + 1)
      }
    }
  }
  let best = '-videos'
  let bestCount = 0
  for (const [suffix, count] of counts) {
    // On ties, keep both filename forms in play so ambiguity is detected.
    if (count > bestCount || (count === bestCount && best === '')) {
      best = suffix
      bestCount = count
    }
  }
  return best
}

function getDirectory(path) {
  return path.slice(0, path.lastIndexOf('/') + 1)
}

/**
 * Read metadata first: Takeout can store playlists.csv after its video files.
 * The extra archive scan between discovery and import avoids buffering video
 * CSVs or inflating unselected metadata during discovery.
 */
export async function readTakeoutPlaylistMetadata(file) {
  const metadata = new Map()
  const errors = []
  const metadataByDirectory = new Map()
  const csvPathsByDirectory = new Map()
  const unreadablePaths = new Set()
  const damagedPaths = new Set()
  await streamTakeoutZip(file, new Set(['playlistMetadata']), entry => {
    // Empty playlists have header-only files that cannot be classified.
    if (entry.type === 'playlistMetadata' || !/\.csv$/i.test(entry.path)) { return }
    if (entry.type === null && /\n[^\r\n]*\S/.test(entry.head.trimEnd())) { damagedPaths.add(entry.path) }
    const directory = getDirectory(entry.path)
    const paths = csvPathsByDirectory.get(directory) ?? []
    paths.push(entry.path)
    csvPathsByDirectory.set(directory, paths)
  }, entry => {
    const directory = getDirectory(entry.path)
    if (metadataByDirectory.has(directory)) {
      metadataByDirectory.set(directory, null)
      errors.push(new Error(`Duplicate playlist metadata CSV: ${entry.path}`))
      return
    }
    metadataByDirectory.set(directory, entry)
  }, (error, entry) => {
    if (entry.type === null) {
      // Unclassified, so only relevant if it shares its path with the metadata.
      unreadablePaths.add(entry.path)
      return
    }
    metadataByDirectory.set(getDirectory(entry.path), null)
    errors.push(error)
  })
  // Resolve paths after the scan so either filename form can follow the metadata.
  for (const [directory, entry] of metadataByDirectory) {
    if (entry === null) { continue }
    if (unreadablePaths.has(entry.path)) {
      errors.push(new Error(`Unreadable duplicate playlist metadata CSV: ${entry.path}`))
      continue
    }
    const files = (csvPathsByDirectory.get(directory) ?? [])
      .map(path => ({ path, name: path.slice(directory.length).replace(/\.csv$/i, '') }))
    const fileNames = files.map(({ name }) => name)
    const playlists = parseTakeoutPlaylistMetadataCsv(entry.content, fileNames)
    if (playlists === null) {
      errors.push(new Error(`Invalid playlist metadata CSV: ${entry.path}`))
      continue
    }
    const titles = playlists.map(playlist => sanitizeTakeoutFilename(playlist.playlistName))
    const suffix = findTakeoutPlaylistFileSuffix(titles, fileNames)
    const accountMetadata = new Map()
    const pending = playlists.map((playlist, index) => {
      const title = titles[index]
      const paths = files
        .filter(({ name }) => name.startsWith(title) && [suffix, ''].includes(name.slice(title.length).toLowerCase()))
        .map(({ path }) => path)
      return { playlist, paths: new Set(paths.length ? paths : [`${directory}${title}${suffix || '-videos'}.csv`]) }
    })
    const claimantsByPath = new Map()
    for (const entry of pending) {
      for (const path of entry.paths) {
        const claimants = claimantsByPath.get(path) ?? []
        claimants.push(entry)
        claimantsByPath.set(path, claimants)
      }
    }
    // Assign forced matches first, removing each claimed path from other rows.
    // A queue also resolves suffix-overlapping titles without rescanning every row.
    const queue = pending.filter(entry => entry.paths.size === 1)
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i]
      if (entry.paths.size !== 1) { continue }
      const path = entry.paths.values().next().value
      accountMetadata.set(path, entry.playlist)
      for (const other of claimantsByPath.get(path)) {
        if (other !== entry && other.paths.delete(path) && other.paths.size === 1) { queue.push(other) }
      }
    }
    if (accountMetadata.size !== pending.length) {
      errors.push(new Error(`Ambiguous playlist metadata: ${entry.path}`))
      continue
    }
    // Commit each account only after all its records have unambiguous filenames.
    for (const [path, playlist] of accountMetadata) {
      // A damaged video file must not turn into an empty playlist.
      if (damagedPaths.has(path)) {
        errors.push(new Error(`Invalid Takeout entry: ${path}`))
      } else {
        metadata.set(path, playlist)
      }
    }
  }
  return { metadata, errors }
}

/** Parse playlist video rows. Takeout localizes the two-column header. */
function parseTakeoutPlaylistVideos(content) {
  const rows = content.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  if (parseCsvRecords(rows[0])?.[0]?.length !== 2) {
    return null
  }
  const videos = rows.slice(1).map(parseTakeoutPlaylistVideoRow)
  return videos.includes(null) ? null : videos
}

function parseTakeoutPlaylistVideoRow(row) {
  const match = row.trimStart().match(/^(?:"([\w-]{11})"|([\w-]{11})),(?:"([^"]+)"|([^,]+))$/)
  if (match === null) {
    return null
  }
  const videoId = match[1] ?? match[2]
  const timeAdded = Date.parse(match[3] ?? match[4])
  if (!Number.isFinite(timeAdded)) {
    return null
  }
  return { videoId, title: videoId, lengthSeconds: 0, timeAdded }
}

export function parseTakeoutPlaylistCsv(content, filename, metadata) {
  const videos = parseTakeoutPlaylistVideos(content)
  if (videos === null) {
    return null
  }
  return { playlistName: getTakeoutPlaylistName(filename), ...metadata, videos }
}

export function isSupportedTakeoutEntry(entry) {
  const path = entry.path.toLowerCase()
  if (entry.type === 'playlists') {
    return parseTakeoutPlaylistCsv(entry.content, path.split('/').at(-1)) !== null
  }
  if (entry.type === 'subscriptions' && path.endsWith('.csv')) {
    return parseCsvRecords(entry.content)?.[0]?.length === 3
  }
  if (entry.type === 'subscriptions' && path.endsWith('.opml')) {
    return entry.content.includes('<opml')
  }
  try {
    return Array.isArray(JSON.parse(entry.content))
  } catch {
    return false
  }
}

/** Read supported data one entry at a time, using the same names for preview and import. */
export async function forEachTakeoutImportEntry(file, selected, entries, onEntry, onError) {
  // The next suffix to try for each name. Lower suffixes are taken already.
  const nextPlaylistSuffixes = new Map()
  const allocatedPlaylistNames = new Set()
  let metadata = new Map()
  if (selected.has('playlists')) {
    try {
      const result = await readTakeoutPlaylistMetadata(file)
      metadata = result.metadata
      result.errors.forEach(error => onError(error, 'playlists'))
    } catch (error) {
      onError(error, 'playlists')
    }
  }
  const reservedPlaylistNames = new Set([
    ...[...metadata.values()].map(playlist => playlist.playlistName.trim()),
    ...entries.filter(entry => entry.type === 'playlists')
      .map(entry => (metadata.get(entry.path)?.playlistName ?? getTakeoutPlaylistName(entry.path.split('/').at(-1))).trim()),
  ])
  const importedPaths = new Set()
  async function importPlaylist(playlist) {
    const name = playlist.playlistName.trim()
    let playlistName = name
    let suffix = nextPlaylistSuffixes.get(name)
    if (suffix !== undefined) {
      while (reservedPlaylistNames.has(`${name} (${suffix})`) || allocatedPlaylistNames.has(`${name} (${suffix})`)) {
        suffix++
      }
      playlistName = `${name} (${suffix})`
    }
    nextPlaylistSuffixes.set(name, (suffix ?? 1) + 1)
    allocatedPlaylistNames.add(playlistName)
    await onEntry({ type: 'playlists', playlist: { ...playlist, playlistName } })
  }
  await forEachSelectedTakeoutZipEntry(file, selected, async entry => {
    if (entry.type === 'playlists') { importedPaths.add(entry.path) }
    try {
      if (!isSupportedTakeoutEntry(entry)) { throw new Error(`Invalid Takeout entry: ${entry.path}`) }
      if (entry.type === 'playlists') {
        const playlist = parseTakeoutPlaylistCsv(entry.content, entry.path.split('/').at(-1), metadata.get(entry.path))
        await importPlaylist(playlist)
      } else {
        await onEntry(entry)
      }
    } catch (error) {
      onError(error, entry.type, entry.path)
    }
  }, (error, entry) => {
    if (entry.type === 'playlists') importedPaths.add(entry.path)
    onError(error, entry.type, entry.path)
  })
  for (const [path, playlist] of metadata) {
    if (!importedPaths.has(path)) {
      try {
        await importPlaylist({ ...playlist, videos: [] })
      } catch (error) {
        onError(error, 'playlists', path)
      }
    }
  }
}
