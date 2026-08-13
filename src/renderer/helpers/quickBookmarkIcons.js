export const QUICK_BOOKMARK_ICONS = [
  'bookmark',
  'clock',
  'heart',
  'list',
  'play',
  'film',
]

export function getQuickBookmarkIconValue(playlist) {
  const icon = playlist?.quickBookmarkIcon

  if (QUICK_BOOKMARK_ICONS.includes(icon)) return icon

  if (
    icon?.type === 'emoji' &&
    typeof icon.value === 'string' &&
    icon.value !== ''
  ) {
    return { type: 'emoji', value: icon.value }
  }

  if (
    icon?.type === 'image' &&
    typeof icon.value === 'string' &&
    /^data:image\/(?:gif|jpeg|png|webp);base64,/i.test(icon.value)
  ) {
    return { type: 'image', value: icon.value }
  }

  return 'bookmark'
}
