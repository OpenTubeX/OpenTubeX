/**
 * Labels a quick playback speed bar option the way the player shows it.
 * @param {number} speed
 * @param {string | undefined} name
 * @param {(key: string) => string} t
 */
export function getQuickPlaybackRateLabel(speed, name, t) {
  if (typeof name === 'string' && name.trim() !== '') {
    return name.trim()
  }

  if (Math.abs(speed - 1) < 0.01) {
    return t('Video.Player.Normal')
  }

  if (speed < 1) {
    return `${Math.round(speed * 100)}%`
  }

  return `${speed}x`
}
