// NewPipe's backup ZIP holds its database, newpipe.db, whose tables are read
// here: subscriptions and their groups, the watch history with resume
// positions, local playlists, and searches. Its forks keep the format.
// Entries of other services than YouTube are skipped.

import { unzipSync } from 'fflate'

import { hasReachedWatchedThreshold } from '../../history.js'
import { extractChannelIdFromUploaderUrl, getYouTubeVideoId } from './libretube.js'
import { openSqliteDatabase } from './sqlite-file-reader.js'

const DATABASE_ENTRY = 'newpipe.db'
const YOUTUBE_SERVICE_ID = 0
const LIVE_STREAM_TYPES = new Set(['LIVE_STREAM', 'AUDIO_LIVE_STREAM'])

/** @typedef {ReturnType<typeof openSqliteDatabase>} Database */

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * @param {unknown} value
 */
function text(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * The YouTube videos of the streams table, by their row ID
 * @param {Database} database
 */
function readYouTubeStreams(database) {
  const streams = new Map()
  for (const stream of database.rows('streams')) {
    const videoId = stream.service_id === YOUTUBE_SERVICE_ID ? getYouTubeVideoId(stream.url) : null
    if (videoId === null) continue
    const isLive = LIVE_STREAM_TYPES.has(stream.stream_type)
    streams.set(stream.uid, {
      videoId,
      title: text(stream.title) || videoId,
      author: text(stream.uploader),
      authorId: extractChannelIdFromUploaderUrl(stream.uploader_url),
      lengthSeconds: !isLive && isNumber(stream.duration) && stream.duration > 0 ? stream.duration : null,
      published: isNumber(stream.upload_date) && stream.upload_date > 0 ? stream.upload_date : 0,
      isLive,
    })
  }
  return streams
}

/**
 * @param {Database} database
 */
export function convertNewPipeSubscriptions(database) {
  const groupNames = new Map(database.rows('feed_group').map(group => [group.uid, text(group.name).trim()]))
  const groupsBySubscription = new Map()
  for (const { group_id: groupId, subscription_id: subscriptionId } of database.rows('feed_group_subscription_join')) {
    const name = groupNames.get(groupId)
    if (!name) continue
    if (!groupsBySubscription.has(subscriptionId)) groupsBySubscription.set(subscriptionId, [])
    groupsBySubscription.get(subscriptionId).push(name)
  }
  return database.rows('subscriptions').flatMap((subscription) => {
    const id = subscription.service_id === YOUTUBE_SERVICE_ID ? extractChannelIdFromUploaderUrl(subscription.url) : ''
    if (!id) return []
    return [{
      id,
      name: text(subscription.name),
      thumbnail: text(subscription.avatar_url) || null,
      groups: groupsBySubscription.get(subscription.uid) ?? [],
    }]
  })
}

/**
 * Each video once, with its latest watch time and its resume position
 * @param {Database} database
 */
export function convertNewPipeWatchHistory(database) {
  const streams = readYouTubeStreams(database)
  const positions = new Map(database.rows('stream_state').map(state => [state.stream_id, state.progress_time]))
  const lastWatched = new Map()
  for (const { stream_id: streamId, access_date: accessDate } of database.rows('stream_history')) {
    if (streams.has(streamId) && isNumber(accessDate) && accessDate > (lastWatched.get(streamId) ?? -Infinity)) {
      lastWatched.set(streamId, accessDate)
    }
  }

  const records = new Map()
  for (const [streamId, timeWatched] of lastWatched) {
    const { videoId, title, author, authorId, lengthSeconds, published, isLive } = streams.get(streamId)
    if ((records.get(videoId)?.timeWatched ?? -Infinity) > timeWatched) continue
    const position = positions.get(streamId)
    // NewPipe saves no position for videos played only briefly or with
    // resuming turned off, so like other imports they count as watched.
    const hasPosition = isNumber(position) && lengthSeconds !== null
    const watchProgress = hasPosition ? Math.min(Math.max(position / 1000, 0), lengthSeconds) : (lengthSeconds ?? 0)
    records.set(videoId, {
      videoId,
      title,
      author,
      authorId,
      published,
      timeWatched,
      description: '',
      lengthSeconds,
      watchProgress,
      isWatched: hasPosition ? hasReachedWatchedThreshold(watchProgress, lengthSeconds) : true,
      isLive,
      type: 'video',
    })
  }
  return [...records.values()]
}

/**
 * Local playlists with their YouTube videos in NewPipe's order. NewPipe saves
 * no add times, so spaced ones keep that order when sorting by date added.
 * @param {Database} database
 * @param {number} now
 */
export function convertNewPipePlaylists(database, now = Date.now()) {
  const streams = readYouTubeStreams(database)
  const entriesByPlaylist = new Map()
  for (const { playlist_id: playlistId, stream_id: streamId, join_index: joinIndex } of database.rows('playlist_stream_join')) {
    if (!entriesByPlaylist.has(playlistId)) entriesByPlaylist.set(playlistId, [])
    entriesByPlaylist.get(playlistId).push({ streamId, joinIndex })
  }

  const playlists = []
  for (const playlist of database.rows('playlists')) {
    const name = text(playlist.name)
    if (!name.trim()) continue
    const entries = (entriesByPlaylist.get(playlist.uid) ?? []).sort((a, b) => a.joinIndex - b.joinIndex)
    const videos = entries.flatMap(({ streamId }) => {
      const stream = streams.get(streamId)
      if (stream === undefined) return []
      const { videoId, title, author, authorId, lengthSeconds, published } = stream
      return [{ videoId, title, author, authorId, lengthSeconds: lengthSeconds ?? 0, ...(published > 0 ? { published } : {}) }]
    })
    // A playlist of another service's videos only
    if (entries.length > 0 && videos.length === 0) continue
    playlists.push({
      playlistName: name,
      videos: videos.map((video, index) => ({ ...video, timeAdded: now - (videos.length - 1 - index) })),
    })
  }
  return playlists
}

/**
 * Each YouTube search once, with its latest time
 * @param {Database} database
 */
export function convertNewPipeSearchHistory(database) {
  const searches = new Map()
  for (const { service_id: serviceId, search, creation_date: creationDate } of database.rows('search_history')) {
    const query = serviceId === YOUTUBE_SERVICE_ID ? text(search).trim() : ''
    if (query && isNumber(creationDate) && creationDate > (searches.get(query) ?? -Infinity)) {
      searches.set(query, creationDate)
    }
  }
  return Array.from(searches, ([query, lastUpdatedAt]) => ({ _id: query, query, lastUpdatedAt }))
}

const CONVERTERS = {
  subscriptions: convertNewPipeSubscriptions,
  history: convertNewPipeWatchHistory,
  playlists: convertNewPipePlaylists,
  searchHistory: convertNewPipeSearchHistory,
}

/**
 * Reads one kind of data from a NewPipe backup ZIP.
 * @param {{ file: Blob, section: keyof typeof CONVERTERS }} input
 * @returns {Promise<object[] | null>} null when the file is no NewPipe backup
 */
export async function readNewPipeBackup({ file, section }) {
  const archive = new Uint8Array(await file.arrayBuffer())
  let entries
  try {
    entries = unzipSync(archive, { filter: entry => entry.name === DATABASE_ENTRY })
  } catch {
    return null
  }
  const database = entries[DATABASE_ENTRY]
  if (database === undefined) return null
  return CONVERTERS[section](openSqliteDatabase(database))
}
