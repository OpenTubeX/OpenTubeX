const VOLUME_KEY = 'playerVolume'
const MUTED_KEY = 'playerMuted'

/**
 * @returns {{ volume: number, muted: boolean } | null}
 */
export function getRememberedPlayerVolume() {
  const volume = localStorage.getItem(VOLUME_KEY)
  if (volume === null) {
    return null
  }

  const parsedVolume = parseFloat(volume)
  if (Number.isNaN(parsedVolume)) {
    return null
  }

  const muted = localStorage.getItem(MUTED_KEY)
  return {
    volume: Math.min(1, Math.max(0, parsedVolume)),
    muted: muted === 'true'
  }
}

/**
 * @param {number} volume
 * @param {boolean} muted
 */
export function setRememberedPlayerVolume(volume, muted) {
  localStorage.setItem(VOLUME_KEY, Math.min(1, Math.max(0, volume)).toString())
  localStorage.setItem(MUTED_KEY, String(muted))
}
