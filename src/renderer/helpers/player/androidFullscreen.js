import { overrideShakaMethods } from './overrideShakaMethods.js'

// Request native rotation while the inline page is intact, then let Chromium
// enter fullscreen in the same turn. Waiting for a fullscreen paint first
// exposes a portrait fullscreen frame and an incomplete header in the snapshot.
export function bindAndroidFullscreen(controls, { isActive, prepareEnter, finishEnter }) {
  const toggle = controls.toggleFullScreen.bind(controls)
  let pending = null
  let disposed = false
  const restore = overrideShakaMethods(controls, {
    toggleFullScreen: () => {
      if (pending) return pending
      if (disposed || !isActive()) return Promise.resolve()
      if (controls.isFullScreenEnabled()) return toggle()
      pending = (async () => {
        try {
          // A rejected orientation preference must not prevent fullscreen.
          await prepareEnter().catch(() => {})
          if (!disposed && isActive()) await toggle()
        } finally {
          // Shaka reports requestFullscreen failures as events, not rejections.
          finishEnter(controls.isFullScreenEnabled())
          pending = null
        }
      })()
      return pending
    },
  })
  return () => {
    disposed = true
    restore()
  }
}
