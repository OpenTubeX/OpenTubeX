export const DEFAULT_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB = 5
export const MIN_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB = 0
export const MAX_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB = 16

export function normalizeYtDlpPlaybackCacheMaxEntrySize(value) {
  const size = Number(value)
  return Number.isInteger(size) &&
    size >= MIN_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB &&
    size <= MAX_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB
    ? size
    : DEFAULT_YT_DLP_PLAYBACK_CACHE_MAX_ENTRY_SIZE_MB
}
