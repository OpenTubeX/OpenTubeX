import { Unzip, UnzipInflate } from 'fflate'

const MAX_ENTRY_SIZE = 256 * 1024 * 1024

export function classifyTakeoutEntry(path) {
  const parts = path.toLowerCase().split('/')
  const name = parts.at(-1)
  const parent = parts.at(-2)

  if (parent === 'subscriptions' && /^subscriptions\.(csv|json|opml)$/.test(name)) {
    return 'subscriptions'
  }
  if (parent === 'history' && name === 'watch-history.json') {
    return 'history'
  }
  if (parent === 'history' && name === 'search-history.json') {
    return 'searchHistory'
  }
  if (parent === 'playlists' && name.endsWith('.csv')) {
    return name === 'playlists.csv' ? 'playlistMetadata' : 'playlists'
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

async function streamTakeoutZip(file, selectedTypes, onFound, onContent) {
  const pending = []
  let failure

  class SelectiveInflate {
    static compression = 8

    constructor(name, compressedSize, originalSize) {
      this.decoder = selectedTypes.has(classifyTakeoutEntry(name))
        ? new UnzipInflate(name, compressedSize, originalSize)
        : new SkipDeflate()
      this.decoder.ondata = (error, data, final) => this.ondata(error, data, final)
    }

    push(chunk, final) {
      this.decoder.push(chunk, final)
    }
  }

  const unzip = new Unzip(entry => {
    const type = classifyTakeoutEntry(entry.name)
    if (type !== null) { onFound({ type, path: entry.name }) }

    if (type === null || !selectedTypes.has(type)) {
      entry.ondata = () => {}
      entry.start()
      return
    }
    if (entry.originalSize > MAX_ENTRY_SIZE) {
      failure = new Error(`Takeout entry is too large: ${entry.name}`)
      return
    }

    const decoder = new TextDecoder()
    let content = ''
    let size = 0
    entry.ondata = (error, chunk, final) => {
      if (error) {
        failure = error
        return
      }
      size += chunk.length
      if (size > MAX_ENTRY_SIZE) {
        failure = new Error(`Takeout entry is too large: ${entry.name}`)
        return
      }
      content += decoder.decode(chunk, { stream: !final })
      if (final) {
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

/** Discover supported paths without inflating their contents or unrelated videos. */
export async function listYouTubeTakeoutZipEntries(file) {
  const entries = []
  await streamTakeoutZip(file, new Set(), entry => {
    entries.push({ ...entry, type: entry.type === 'playlistMetadata' ? 'playlists' : entry.type })
  }, () => {})
  return entries
}

/** Import selected entries one at a time, bounding renderer memory. */
export async function forEachSelectedTakeoutZipEntry(file, types, onEntry) {
  await streamTakeoutZip(file, types, () => {}, onEntry)
}

export function getTakeoutPlaylistName(filename) {
  return filename.replace(/(?:-videos)?\.csv$/i, '')
}

/** Parse CSV records, including quoted commas, escaped quotes and line breaks. */
export function parseCsvRecords(content) {
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
  if (quoted) { return null }
  if (field !== '' || record.length > 0 || closedQuote) {
    records.push([...record, field])
  }
  return records
}

export function parseTakeoutPlaylistMetadataCsv(content) {
  const records = parseCsvRecords(content)
  if (!records?.length) { return null }
  const headers = records[0]
  const titleIndex = headers.indexOf('Playlist Title (Original)')
  if (titleIndex === -1 || !headers.includes('Playlist ID')) { return null }
  const playlists = []
  for (const record of records.slice(1)) {
    if (record.length === 1 && record[0] === '') { continue }
    if (record.length !== headers.length || !record[titleIndex].trim()) { return null }
    const playlist = { playlistName: record[titleIndex] }
    const descriptionIndex = headers.indexOf('Playlist Description (Original)')
    if (descriptionIndex !== -1) { playlist.description = record[descriptionIndex] }
    for (const [column, property] of [
      ['Playlist Create Timestamp', 'createdAt'],
      ['Playlist Update Timestamp', 'lastUpdatedAt'],
    ]) {
      const value = record[headers.indexOf(column)]
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
 * Read metadata first: Takeout can store playlists.csv after its video files.
 * The extra archive scan between discovery and import avoids buffering video
 * CSVs or inflating unselected metadata during discovery.
 */
export async function readTakeoutPlaylistMetadata(file) {
  const metadata = new Map()
  const errors = []
  const playlistsByDirectory = new Map()
  const videoPaths = new Map()
  const suffixedVideoPaths = new Map()
  await streamTakeoutZip(file, new Set(['playlistMetadata']), entry => {
    if (entry.type !== 'playlists') { return }
    const csvPath = `${entry.path.slice(0, -4)}.csv`
    for (const [index, key] of [[videoPaths, csvPath], [suffixedVideoPaths, csvPath.replace(/-videos\.csv$/i, '-videos.csv')]]) {
      const paths = index.get(key) ?? []
      paths.push(entry.path)
      index.set(key, paths)
    }
  }, entry => {
    const directory = entry.path.slice(0, entry.path.lastIndexOf('/') + 1)
    if (playlistsByDirectory.has(directory)) {
      playlistsByDirectory.set(directory, null)
      errors.push(new Error(`Duplicate playlist metadata CSV: ${entry.path}`))
      return
    }
    const playlists = parseTakeoutPlaylistMetadataCsv(entry.content)
    playlistsByDirectory.set(directory, playlists)
    if (playlists === null) {
      errors.push(new Error(`Invalid playlist metadata CSV: ${entry.path}`))
    }
  })
  // Resolve paths after the scan so either filename form can follow the metadata.
  for (const [directory, playlists] of playlistsByDirectory) {
    if (playlists === null) { continue }
    const accountMetadata = new Map()
    const pending = playlists.map(playlist => {
      // Takeout replaces filename-unsafe characters, including slashes, with underscores.
      const filename = playlist.playlistName.replaceAll(/[<>:"'/\\|?*\p{Cc}]/gu, '_')
      const suffixedPath = `${directory}${filename}-videos.csv`
      const unsuffixedPath = `${directory}${filename}.csv`
      const paths = [...(suffixedVideoPaths.get(suffixedPath) ?? []), ...(videoPaths.get(unsuffixedPath) ?? [])]
      return { playlist, paths: new Set(paths.length ? paths : [suffixedPath]) }
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
      errors.push(new Error(`Ambiguous playlist metadata: ${directory}playlists.csv`))
      continue
    }
    // Commit each account only after all its records have unambiguous filenames.
    for (const [path, playlist] of accountMetadata) { metadata.set(path, playlist) }
  }
  return { metadata, errors }
}

export function parseTakeoutPlaylistCsv(content, filename, metadata) {
  const rows = content.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  const header = rows[0].toLowerCase()
  if (header !== 'video id,playlist video creation timestamp' && header !== '影片 id,播放清單影片的建立時間戳記') {
    return null
  }
  const videos = []
  for (const row of rows.slice(1)) {
    const match = row.trimStart().match(/^(?:"([\w-]{11})"|([\w-]{11})),(?:"([^"]+)"|([^,]+))$/)
    if (match === null) {
      return null
    }
    const videoId = match[1] ?? match[2]
    const timeAdded = Date.parse(match[3] ?? match[4])
    if (!Number.isFinite(timeAdded)) {
      return null
    }
    videos.push({ videoId, title: videoId, lengthSeconds: 0, timeAdded })
  }

  return { playlistName: getTakeoutPlaylistName(filename), ...metadata, videos }
}

export function isSupportedTakeoutEntry(entry) {
  const path = entry.path.toLowerCase()
  if (entry.type === 'playlists') {
    return parseTakeoutPlaylistCsv(entry.content, path.split('/').at(-1)) !== null
  }
  if (entry.type === 'subscriptions' && path.endsWith('.csv')) {
    return entry.content.replace(/^\uFEFF/, '').startsWith('Channel Id,Channel Url,Channel Title')
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
  const playlistNameCounts = new Map()
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
    const count = (playlistNameCounts.get(name) ?? 0) + 1
    playlistNameCounts.set(name, count)
    let playlistName = name
    if (count > 1) {
      let suffix = 2
      while (reservedPlaylistNames.has(`${name} (${suffix})`) || allocatedPlaylistNames.has(`${name} (${suffix})`)) {
        suffix++
      }
      playlistName = `${name} (${suffix})`
    }
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
