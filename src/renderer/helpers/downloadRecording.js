import { formatBytes } from './fileSize'
import { formatDurationAsTimestamp } from './utils'

/**
 * Whether a live recording can be stopped and kept. iOS never marks a download as live.
 * @param {{ live?: boolean, status: string }} download
 */
export function canStopRecording(download) {
  return download.live === true && download.status === 'downloading'
}

/**
 * @param {{ recordedSeconds?: number, recordedBytes?: number }} download
 * @param {(key: string) => string} t
 */
export function recordingStatusText(download, t) {
  return [
    t('Downloads.Recording'),
    Number.isFinite(download.recordedSeconds) ? formatDurationAsTimestamp(download.recordedSeconds) : '',
    Number.isFinite(download.recordedBytes) ? formatBytes(download.recordedBytes) : ''
  ].filter(Boolean).join(' • ')
}
