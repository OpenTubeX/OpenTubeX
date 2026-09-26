import { setFullscreenOrientation } from '../capacitorUi'

/** Cover the gap between native players without releasing the orientation lock. */
export function beginAndroidFullscreenTransition(label, thumbnail, onCancel = () => {}) {
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
  // Network or native presentation can stall without producing a player error.
  const timeout = setTimeout(cancel, 60_000)
  function finish() {
    if (finished) return
    finished = true
    clearTimeout(timeout)
    document.removeEventListener('nativefullscreenready', transferred)
    document.removeEventListener('keydown', back, true)
    overlay.remove()
    if (!document.querySelector('[data-native-player-screen]')) {
      document.documentElement.classList.remove('nativePlaybackScreen')
      setFullscreenOrientation(false).catch(() => {})
    }
  }
  function transferred() {
    if (document.querySelector('[data-native-player-screen]:not(.nativeFullscreenTransition)')) finish()
  }
  function cancel() {
    if (finished) return
    onCancel()
    finish()
    // The close event occurred while the teardown cover still suppressed it.
    document.dispatchEvent(new Event('fullscreenchange'))
  }
  function back(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    cancel()
  }
  document.addEventListener('nativefullscreenready', transferred)
  document.addEventListener('keydown', back, true)
  return finish
}
