// @ts-check

import { appFetch } from './rssHub.js'

const SEARCH_URL = 'https://itunes.apple.com/search'
const SEARCH_LIMIT = 25
const FETCH_TIMEOUT_MS = 15_000

/**
 * @typedef {{ feedUrl: string, title: string, author: string, artwork: string | null }} PodcastSearchResult
 */

/**
 * The length of a podcast episode from its `itunes:duration`, which is either
 * seconds or a `[[HH:]MM:]SS` timestamp.
 * @param {string} text
 * @returns {number | undefined} whole seconds
 */
export function parsePodcastDuration(text) {
  const parts = text.trim().split(':')
  if (parts.length > 3 || !parts.every(part => /^\d+(?:\.\d+)?$/.test(part))) return undefined
  const seconds = Math.round(parts.reduce((total, part) => total * 60 + Number(part), 0))
  return seconds > 0 ? seconds : undefined
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function webUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

/**
 * Reads the podcasts of an Apple Podcasts search response. Podcasts without a
 * public feed can't be followed, so they are left out.
 * @param {unknown} response
 * @returns {PodcastSearchResult[]}
 */
export function parseApplePodcastSearch(response) {
  const results = /** @type {{ results?: unknown }} */ (response)?.results
  if (!Array.isArray(results)) throw new Error('Not a podcast search response')
  /** @type {Set<string>} */
  const feedUrls = new Set()
  return results.flatMap(result => {
    const feedUrl = webUrl(result?.feedUrl)
    const title = typeof result?.collectionName === 'string' ? result.collectionName.trim() : ''
    if (!feedUrl || !title || feedUrls.has(feedUrl)) return []
    feedUrls.add(feedUrl)
    return [{
      feedUrl,
      title,
      author: typeof result.artistName === 'string' ? result.artistName.trim() : '',
      artwork: webUrl(result.artworkUrl100) ?? webUrl(result.artworkUrl60)
    }]
  })
}

/**
 * Searches the Apple Podcasts directory, which needs no account or key.
 * @param {string} query
 * @param {AbortSignal} [signal]
 * @returns {Promise<PodcastSearchResult[]>}
 */
export async function searchPodcasts(query, signal) {
  const url = new URL(SEARCH_URL)
  url.search = new URLSearchParams({ media: 'podcast', entity: 'podcast', limit: String(SEARCH_LIMIT), term: query }).toString()
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const response = await appFetch(url.href, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  })
  if (!response.ok) throw new Error(`Podcast search returned HTTP ${response.status}`)
  return parseApplePodcastSearch(await response.json())
}

/**
 * yt-dlp names direct media files, such as podcast episodes, after their file,
 * since they carry no title of their own.
 * @param {string | null} title
 * @param {string} url
 */
export function isMediaFileTitle(title, url) {
  if (!title) return true
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '')
    return title === name || title === name.replace(/\.[^.]*$/, '')
  } catch {
    return false
  }
}

/**
 * Replaces the metadata yt-dlp found for a media file with what its feed or an
 * earlier visit knew about it.
 * @param {import('../../main/ytDlpPlayback').YtDlpPlaybackInfo} info
 * @param {{ title: string, creator: string, creatorAvatar: string | null, thumbnail: string, published: number | null,
 *   duration: number | null }} metadata `published` in milliseconds
 * @returns {import('../../main/ytDlpPlayback').YtDlpPlaybackInfo}
 */
export function withMediaFileMetadata(info, metadata) {
  return {
    ...info,
    title: metadata.title || info.title,
    channel: metadata.creator || info.channel,
    // The file's host is not the creator's page
    channelUrl: metadata.creator ? null : info.channelUrl,
    channelThumbnail: metadata.creatorAvatar || info.channelThumbnail,
    thumbnail: metadata.thumbnail || info.thumbnail,
    duration: info.duration ?? metadata.duration,
    externalMetadata: {
      ...info.externalMetadata,
      // For a media file, yt-dlp only knows when the server last modified it
      timestamp: metadata.published ? Math.floor(metadata.published / 1000) : info.externalMetadata?.timestamp ?? null
    }
  }
}
