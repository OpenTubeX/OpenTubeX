import { runCooperatively, runSynchronously } from './cooperativeTask.js'
import { fuzzyTextScore, normalizeSearchText } from './textSearch.js'

/**
 * Yields between records while collecting matches in history order.
 * @template {{title?: string, author?: string}} T
 * @param {T[]} videos
 * @param {string} query
 * @param {boolean} [caseSensitive]
 * @param {string} [locale]
 * @returns {Generator<void, T[], void>}
 */
function * filterVideoSteps(videos, query, caseSensitive = false, locale = 'en-US') {
  const normalize = caseSensitive ? value => value : value => normalizeSearchText(value, locale)
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return videos

  const matches = []
  for (const video of videos) {
    yield
    const fields = [video.title, video.author]
      .filter(value => typeof value === 'string')
      .map(normalize)
    if (tokens.every(token => fields.some(field => field.includes(token) ||
      (!caseSensitive && Number.isFinite(fuzzyTextScore(token, field)))))) matches.push(video)
  }
  return matches
}

/**
 * Matches every search term across the title and channel, preserving history order.
 * Case-sensitive searches use literal tokens so fuzzy edits cannot ignore case.
 * @template {{title?: string, author?: string}} T
 * @param {T[]} videos
 * @param {string} query
 * @param {boolean} [caseSensitive]
 * @param {string} [locale]
 * @returns {T[]}
 */
export function filterVideosWithQuery(videos, query, caseSensitive, locale) {
  return runSynchronously(filterVideoSteps(videos, query, caseSensitive, locale))
}

/**
 * Runs the same search in cooperative batches; returns null when cancelled.
 * @template {{title?: string, author?: string}} T
 * @param {T[]} videos
 * @param {string} query
 * @param {boolean} [caseSensitive]
 * @param {string} [locale]
 * @param {() => boolean} [isCancelled]
 * @returns {Promise<T[] | null>}
 */
export function filterVideosWithQueryAsync(videos, query, caseSensitive, locale, isCancelled) {
  return runCooperatively(filterVideoSteps(videos, query, caseSensitive, locale), isCancelled)
}
