export function getHistoryChannelKey(video) {
  if (video.authorId) return `id:${video.authorId}`
  if (video.author) return `name:${video.author}`
  return ''
}

export function getHistoryChannels(videos, locale) {
  const channels = new Map()
  for (const video of videos) {
    const key = getHistoryChannelKey(video)
    if (key && !channels.has(key)) channels.set(key, video.author || video.authorId)
  }
  const nameCounts = new Map()
  for (const name of channels.values()) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1)
  return Array.from(channels, ([value, name]) => ({
    value,
    name: nameCounts.get(name) > 1 ? `${name} (${value.slice(value.indexOf(':') + 1)})` : name,
  })).sort((a, b) => a.name.localeCompare(b.name, locale))
}

// Date inputs describe local calendar days, not UTC dates. Advancing the date
// also keeps the inclusive end correct for 23/25-hour daylight-saving days.
export function parseHistoryDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00`)
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== Number(value.slice(0, 4)) ||
      date.getMonth() + 1 !== Number(value.slice(5, 7)) || date.getDate() !== Number(value.slice(8, 10))) return null
  return date
}

export function filterHistoryByDateAndChannel(videos, { fromDate = '', toDate = '', channel = '' } = {}) {
  if (!fromDate && !toDate && !channel) return videos
  const start = parseHistoryDate(fromDate)?.getTime() ?? -Infinity
  const endDate = parseHistoryDate(toDate)
  if (endDate) endDate.setDate(endDate.getDate() + 1)
  const end = endDate?.getTime() ?? Infinity
  return videos.filter(video =>
    (!channel || getHistoryChannelKey(video) === channel) &&
    ((!fromDate && !toDate) || (Number.isFinite(video.timeWatched) && video.timeWatched >= start && video.timeWatched < end)))
}
