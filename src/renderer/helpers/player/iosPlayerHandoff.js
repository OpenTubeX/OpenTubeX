/**
 * Keep the outgoing media element connected until its replacement advances.
 * On a locked physical iPad, removing the last element before the replacement
 * starts can leave the new stream silently playing. Shaka can still tear down
 * the old source and listeners while Vue delays removing its DOM.
 */
export function createIosPlayerHandoff({
  isEnabled,
  document: target = document,
  now = () => performance.now(),
}) {
  let finish = null
  let disposed = false

  function dispose() {
    disposed = true
    finish?.()
  }

  function leave(element, remove) {
    const scope = element.parentElement
    if (disposed || !isEnabled() || !target.hidden || !scope || !element.querySelector('video, audio') || finish) {
      remove()
      return
    }

    const starts = new WeakMap()
    const events = ['playing', 'timeupdate', 'seeking', 'seeked']
    const onVisibility = () => {
      if (!target.hidden) finish?.()
    }
    function onPlayback(event) {
      const media = event.target
      if (!['VIDEO', 'AUDIO'].includes(media?.tagName) ||
          element.contains(media) || !scope.contains(media)) return
      if (event.type === 'seeking' || media.seeking || media.paused || media.ended) {
        starts.delete(media)
        return
      }
      if (event.type === 'playing' || event.type === 'seeked') {
        starts.set(media, { time: media.currentTime, wall: now() })
      } else if (event.type === 'timeupdate') {
        const start = starts.get(media)
        if (start && now() - start.wall >= 1000 && media.currentTime - start.time >= 0.75) finish?.()
      }
    }

    finish = () => {
      finish = null
      for (const event of events) target.removeEventListener(event, onPlayback, true)
      target.removeEventListener('visibilitychange', onVisibility)
      remove()
    }
    for (const event of events) target.addEventListener(event, onPlayback, true)
    target.addEventListener('visibilitychange', onVisibility)
  }

  return { leave, dispose }
}
