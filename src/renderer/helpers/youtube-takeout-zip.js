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
  if (parent === 'playlists' && name.endsWith('.csv') && name !== 'playlists.csv') {
    return 'playlists'
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
  await streamTakeoutZip(file, new Set(), entry => entries.push(entry), () => {})
  return entries
}

/** Import selected entries one at a time, bounding renderer memory. */
export async function forEachSelectedTakeoutZipEntry(file, types, onEntry) {
  await streamTakeoutZip(file, types, () => {}, onEntry)
}

export function parseTakeoutPlaylistCsv(content, filename) {
  const rows = content.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  const header = rows[0].toLowerCase()
  if (header !== 'video id,playlist video creation timestamp' && header !== '影片 id,播放清單影片的建立時間戳記') {
    return null
  }
  const videos = []
  for (const row of rows.slice(1)) {
    const match = row.match(/^(?:"([\w-]{11})"|([\w-]{11})),(?:"([^"]+)"|([^,]+))$/)
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

  return { playlistName: filename.replace(/\.csv$/i, ''), videos }
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
