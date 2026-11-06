import { getCustomIconImageSource } from './customIcons.js'

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

  const imageSource = getCustomIconImageSource(icon)
  if (imageSource) return { type: 'image', value: imageSource }

  return 'bookmark'
}
