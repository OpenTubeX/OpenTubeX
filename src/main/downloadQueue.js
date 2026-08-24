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
