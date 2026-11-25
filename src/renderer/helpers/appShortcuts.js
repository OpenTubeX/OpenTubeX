// Launchers on iOS and Pixel phones show only four shortcuts. Refreshing opens
// Subscriptions too, so it takes the place of the plain Subscriptions shortcut.
const shortcuts = [
  { id: 'refreshSubscriptions', path: '/subscriptions', androidIcon: 'ic_shortcut_refresh', iosIcon: 'arrow.clockwise' },
  { id: 'userplaylists', path: '/userplaylists', androidIcon: 'ic_shortcut_playlists', iosIcon: 'bookmark.fill' },
  { id: 'history', path: '/history', androidIcon: 'ic_shortcut_history', iosIcon: 'clock.arrow.circlepath' },
  // Downloads opens in the settings window, so it has no path.
  { id: 'downloads', androidIcon: 'ic_shortcut_downloads', iosIcon: 'arrow.down.to.line' },
]

export function createAppShortcuts(labels) {
  return shortcuts.map(({ path, ...shortcut }) => ({ ...shortcut, title: labels[shortcut.id] }))
}

/**
 * @param {unknown} shortcutId
 * @returns {string | null}
 */
export function getAppShortcutPath(shortcutId) {
  // Subscriptions shortcuts pinned to the Android home screen keep working.
  if (shortcutId === 'subscriptions') return '/subscriptions'
  return shortcuts.find(shortcut => shortcut.id === shortcutId)?.path ?? null
}
