export const QUICK_BOOKMARK_ICONS = [
  'bookmark',
  'clock',
  'heart',
  'list',
  'play',
  'film',
]

export function getQuickBookmarkIconName(playlist) {
  return QUICK_BOOKMARK_ICONS.includes(playlist?.quickBookmarkIcon)
    ? playlist.quickBookmarkIcon
    : 'bookmark'
}
