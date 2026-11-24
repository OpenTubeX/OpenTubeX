import { overrideShakaMethods } from './overrideShakaMethods.js'

// WebKit element fullscreen dismisses on dock scrolling and keyboard focus.
// Use the app's full-window presentation while preserving Shaka's controls.
// Shaka's rotation handler calls its compiled document fullscreen entry
// directly, so Shaka's rotation option stays off and rotation is handled here.
export function bindIosFullscreen(controls, { isEnabled, setEnabled, canRotate, orientation = globalThis.screen?.orientation }) {
  const restore = overrideShakaMethods(controls, {
    isFullScreenSupported: () => true,
    isFullScreenEnabled: isEnabled,
    toggleFullScreen: () => setEnabled(!isEnabled()),
  })
  const rotate = () => {
    if (!canRotate()) return
    const landscape = orientation.type.includes('landscape')
    if (landscape !== isEnabled()) setEnabled(landscape)
  }
  orientation?.addEventListener('change', rotate)
  return () => {
    orientation?.removeEventListener('change', rotate)
    restore()
  }
}
