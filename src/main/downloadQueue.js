export function normalizeDownloadConcurrency(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 10) : 2
}

export function normalizeDownloadBandwidth(value) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 0), 10_000_000) : 0
}

export function compareQueuedDownloads(left, right) {
  return (left.queuePosition ?? left.id) - (right.queuePosition ?? right.id) ||
    left.id - right.id
}

export function updatePendingDownloadStatuses(records, pendingIds, status) {
  const updated = []
  for (const id of pendingIds) {
    const record = records.get(id)
    if (record && ['queued', 'paused'].includes(record.status) && record.status !== status) {
      record.status = status
      updated.push(record)
    }
  }
  return updated
}

export function resumePendingDownload(record, individuallyResumedIds, queuePaused) {
  if (record?.status !== 'paused') return false
  record.status = 'queued'
  if (queuePaused) individuallyResumedIds.add(record.id)
  return true
}

const SPEED_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
const SPEED_REGEX = /^(\d+(?:\.\d+)?)(B|KiB|MiB|GiB|TiB)\/s$/

/**
 * Adds speeds in yt-dlp's format, such as `2.50MiB/s`.
 * @param {(string | null)[]} speeds
 * @returns {string | null} null when no speed is known
 */
export function combineDownloadSpeeds(speeds) {
  let total = null
  for (const speed of speeds) {
    const match = SPEED_REGEX.exec(speed?.trim() ?? '')
    if (match) total = (total ?? 0) + Number(match[1]) * 1024 ** SPEED_UNITS.indexOf(match[2])
  }
  if (total === null) return null
  const exponent = Math.min(Math.max(Math.floor(Math.log(total) / Math.log(1024)), 0), SPEED_UNITS.length - 1)
  return `${(total / 1024 ** exponent).toFixed(2)}${SPEED_UNITS[exponent]}/s`
}
