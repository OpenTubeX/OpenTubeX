import { Capacitor } from '@capacitor/core'

// The renderer that runs Android's background tasks leaves the plugin out, and asks the app instead.
const backgroundRenderer = process.env.IS_CAPACITOR && !process.env.IS_IOS ? globalThis.OpenTubeXBackgroundSync : undefined

// Lite Android builds omit the yt-dlp runtime and do not register its plugin.
export const isLiteBuild = !!process.env.IS_CAPACITOR &&
  (backgroundRenderer ? !backgroundRenderer.bundlesYtDlp() : !Capacitor.isPluginAvailable('YtDlp'))

export const supportsYtDlp = !!(process.env.IS_ELECTRON || process.env.IS_CAPACITOR) && !isLiteBuild
