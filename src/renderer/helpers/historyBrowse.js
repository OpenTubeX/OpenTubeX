/**
 * Associate names with known IDs, marking names shared by different IDs as ambiguous.
 * @param {{authorId?: string, author?: string}[]} videos
 * @returns {Map<string, string | null>}
 */
function getChannelIdsByName(videos) {
  const ids = new Map()
  for (const video of videos) {
    if (!video.author || !video.authorId) continue
    if (!ids.has(video.author)) ids.set(video.author, video.authorId)
    else if (ids.get(video.author) !== video.authorId) ids.set(video.author, null)
  }
  return ids
}

/**
 * Resolve ID-less records by name only when the name identifies one known channel.
 * @param {{authorId?: string, author?: string}} video
 * @param {Map<string, string | null> | null} channelIdsByName
 * @returns {string}
 */
export function getHistoryChannelKey(video, channelIdsByName) {
  const id = video.authorId || channelIdsByName?.get(video.author)
  if (id) return `id:${id}`
  if (video.author) return `name:${video.author}`
  return ''
}

/**
 * Build channel options from newest-first history, disambiguating duplicate names by ID.
 * @param {{authorId?: string, author?: string}[]} videos
 * @param {string} locale
 * @returns {{value: string, name: string}[]}
 */
export function getHistoryChannels(videos, locale) {
  const channelIdsByName = getChannelIdsByName(videos)
  const channels = new Map()
  for (const video of videos) {
    const key = getHistoryChannelKey(video, channelIdsByName)
    if (key && !channels.has(key)) channels.set(key, video.author || video.authorId)
  }
  const nameCounts = new Map()
  for (const name of channels.values()) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  return Array.from(channels, ([value, name]) => ({
    value,
    name: nameCounts.get(name) > 1 && value.startsWith('id:') ? `${name} (${value.slice(3)})` : name,
  })).sort((a, b) => a.name.localeCompare(b.name, locale))
}

/**
 * Parse a validated local calendar day rather than a UTC date.
 * @param {unknown} value
 * @returns {Date | null}
 */
export function parseHistoryDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00`)
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== Number(value.slice(0, 4)) ||
      date.getMonth() + 1 !== Number(value.slice(5, 7)) || date.getDate() !== Number(value.slice(8, 10))) return null
  return date
}

/**
 * Filter whole local calendar days and channel identities while retaining history order.
 * @template {{authorId?: string, author?: string, timeWatched?: number}} T
 * @param {T[]} videos
 * @param {{fromDate?: string, toDate?: string, channel?: string}} [filters]
 * @returns {T[]}
 */
export function filterHistoryByDateAndChannel(videos, { fromDate = '', toDate = '', channel = '' } = {}) {
  if (!fromDate && !toDate && !channel) return videos
  const channelIdsByName = channel ? getChannelIdsByName(videos) : null
  const start = parseHistoryDate(fromDate)?.getTime() ?? -Infinity
  const endDate = parseHistoryDate(toDate)
  if (endDate) {
    endDate.setDate(endDate.getDate() + 1)
    endDate.setHours(0, 0, 0, 0)
  }
  const end = endDate?.getTime() ?? Infinity
  return videos.filter(video =>
    (!channel || getHistoryChannelKey(video, channelIdsByName) === channel) &&
    ((!fromDate && !toDate) || (Number.isFinite(video.timeWatched) && video.timeWatched >= start && video.timeWatched < end)))
}
