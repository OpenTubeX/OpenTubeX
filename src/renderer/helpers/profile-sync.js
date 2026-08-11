const DEFAULT_PROFILE_BACKGROUND = '#000000'

export function getSyncProfileBackground(color, fallback = DEFAULT_PROFILE_BACKGROUND) {
  const opaqueFallback = fallback == null || fallback === 'transparent'
    ? DEFAULT_PROFILE_BACKGROUND
    : fallback
  return color == null || color === 'transparent' ? opaqueFallback : color
}

export function getMergedProfileBackground(local, usesLocalMetadata, syncedBackground) {
  const preserveLocalTransparency = usesLocalMetadata &&
    local?.icon?.type === 'image' && local.bgColor === 'transparent'

  return preserveLocalTransparency ? 'transparent' : syncedBackground
}
