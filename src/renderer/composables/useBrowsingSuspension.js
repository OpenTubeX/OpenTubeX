import { inject, onBeforeUnmount, watch } from 'vue'

import { browsingSuspendedKey } from '../tabs/TabContext'

/**
 * Follows whether the browsing page is kept hidden behind Watch, which owns the
 * window's scroll position meanwhile. Resuming waits a frame, until the page
 * has its own scroll position back.
 *
 * @param {{ suspend: () => void, resume: () => void }} handlers
 * @returns {() => boolean} whether the page is suspended or about to resume
 */
export function useBrowsingSuspension({ suspend, resume }) {
  const suspended = inject(browsingSuspendedKey, null)
  if (!suspended) return () => false

  let frame = null
  const cancel = () => {
    cancelAnimationFrame(frame)
    frame = null
  }
  watch(suspended, value => {
    cancel()
    if (value) {
      suspend()
      return
    }
    frame = requestAnimationFrame(() => {
      frame = null
      resume()
    })
  })
  onBeforeUnmount(cancel)
  return () => suspended.value || frame !== null
}
