const LEGACY_APP_NAME = 'OpenTubeX'
const LEGACY_SUFFIX = ` - ${LEGACY_APP_NAME}`

/**
 * Released versions saved and synced tab titles as window titles: with the app
 * name appended, or the bare app name for pages without a title.
 * @param {unknown} title
 * @returns {string}
 */
export function normalizeLegacyTabTitle(title) {
  if (typeof title !== 'string' || title === LEGACY_APP_NAME) {
    return ''
  }
  return title.endsWith(LEGACY_SUFFIX) ? title.slice(0, -LEGACY_SUFFIX.length) : title
}
