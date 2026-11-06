import { overrideShakaMethods } from './overrideShakaMethods.js'

// WebKit element fullscreen dismisses on dock scrolling and keyboard focus.
// Use the app's full-window presentation while preserving Shaka's controls.
export function bindIosFullscreen(controls, { isEnabled, setEnabled }) {
  return overrideShakaMethods(controls, {
    isFullScreenSupported: () => true,
    isFullScreenEnabled: isEnabled,
    toggleFullScreen: () => setEnabled(!isEnabled()),
  })
}
