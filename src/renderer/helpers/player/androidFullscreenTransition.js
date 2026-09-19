import { setFullscreenOrientation } from '../capacitorUi'

/** Cover the gap between native players without releasing the orientation lock. */
export function beginAndroidFullscreenTransition(label, thumbnail) {
  const overlay = document.createElement('div')
  overlay.className = 'nativeFullscreenTransition'
  overlay.setAttribute('data-native-player-screen', '')
  overlay.setAttribute('role', 'progressbar')
  overlay.setAttribute('aria-label', label)
  if (thumbnail) {
    const image = document.createElement('img')
    image.src = thumbnail
    image.alt = ''
    overlay.append(image)
  }
  document.body.append(overlay)
  document.documentElement.classList.add('nativePlaybackScreen')
  let finished = false
  function finish() {
    if (finished) return
    finished = true
    document.removeEventListener('fullscreenchange', transferred)
    overlay.remove()
    if (!document.querySelector('[data-native-player-screen]')) {
      document.documentElement.classList.remove('nativePlaybackScreen')
      setFullscreenOrientation(false).catch(() => {})
    }
  }
  function transferred() {
    if (document.querySelector('[data-native-player-screen]:not(.nativeFullscreenTransition)')) finish()
  }
  document.addEventListener('fullscreenchange', transferred)
  return finish
}
