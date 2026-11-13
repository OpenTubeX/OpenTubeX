/** The intervals feeds can refresh on their own at, in milliseconds */
export const AUTO_REFRESH_INTERVAL_VALUES = ['0', '1800000', '3600000', '7200000', '14400000', '21600000', '28800000']

/**
 * @param {(key: string) => string} t
 */
export function getAutoRefreshIntervalNames(t) {
  return [
    t('Settings.General Settings.Avoid translation.Disabled'),
    '30 min',
    '1 h',
    '2 h',
    '4 h',
    '6 h',
    '8 h'
  ]
}
