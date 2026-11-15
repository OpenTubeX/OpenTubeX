const shortcuts = [
  { id: 'subscriptions', androidIcon: 'ic_shortcut_subscriptions', iosIcon: 'dot.radiowaves.left.and.right' },
  { id: 'userplaylists', androidIcon: 'ic_shortcut_playlists', iosIcon: 'bookmark.fill' },
  { id: 'history', androidIcon: 'ic_shortcut_history', iosIcon: 'clock.arrow.circlepath' },
  { id: 'downloads', androidIcon: 'ic_shortcut_downloads', iosIcon: 'arrow.down.to.line' },
]

export function createAppShortcuts(labels) {
  return shortcuts.map(shortcut => ({ ...shortcut, title: labels[shortcut.id] }))
}

/**
 * Downloads opens in the settings window, so it has no path.
 * @param {unknown} shortcutId
 * @returns {string | null}
 */
export function getAppShortcutPath(shortcutId) {
  return shortcutId !== 'downloads' && shortcuts.some(shortcut => shortcut.id === shortcutId) ? `/${shortcutId}` : null
}
