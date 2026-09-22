import { fuzzyTextScore, normalizeSearchText } from './textSearch.js'

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
export function filterVideosWithQuery(videos, query, caseSensitive = false, locale = 'en-US') {
  const normalize = caseSensitive ? value => value : value => normalizeSearchText(value, locale)
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return videos

  return videos.filter(video => {
    const fields = [video.title, video.author]
      .filter(value => typeof value === 'string')
      .map(normalize)
    return tokens.every(token => fields.some(field => caseSensitive
      ? field.includes(token)
      : Number.isFinite(fuzzyTextScore(token, field))))
  })
}
