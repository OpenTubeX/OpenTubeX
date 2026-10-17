import { Capacitor } from '@capacitor/core'

// Lite Android builds omit the yt-dlp runtime and do not register its plugin.
export const isLiteBuild = !!process.env.IS_CAPACITOR && !Capacitor.isPluginAvailable('YtDlp')

export const supportsYtDlp = !!(process.env.IS_ELECTRON || process.env.IS_CAPACITOR) && !isLiteBuild
