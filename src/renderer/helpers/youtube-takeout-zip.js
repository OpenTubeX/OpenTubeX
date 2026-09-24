import { Unzip, UnzipInflate } from 'fflate'

const textDecoder = new TextDecoder()

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

/** Read only supported Takeout entries, without inflating unrelated videos in the archive. */
export async function readYouTubeTakeoutZip(file) {
  const entries = []
  let failure

  const unzip = new Unzip(entry => {
    const type = classifyTakeoutEntry(entry.name)
    if (type === null) {
      return
    }

    const chunks = []
    entry.ondata = (error, chunk, final) => {
      if (error) {
        failure = error
        return
      }
      chunks.push(chunk)
      if (final) {
        const size = chunks.reduce((total, part) => total + part.length, 0)
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const part of chunks) {
          bytes.set(part, offset)
          offset += part.length
        }
        entries.push({ type, path: entry.name, content: textDecoder.decode(bytes) })
      }
    }
    entry.start()
  })
  unzip.register(UnzipInflate)

  try {
    const reader = file.stream().getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) { break }
      unzip.push(value)
    }
    unzip.push(new Uint8Array(0), true)
  } catch (error) {
    failure = error
  }

  if (failure) { throw failure }
  return entries
}

export function parseTakeoutPlaylistCsv(content, filename) {
  const rows = content.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  if (rows[0] !== 'Video ID,Playlist video creation timestamp') {
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
