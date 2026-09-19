import { Capacitor } from '@capacitor/core'
import { OrientationType, ScreenOrientation } from '@capawesome/capacitor-screen-orientation'
import { SettingsLauncher } from '@capawesome/capacitor-settings-launcher'

export function shouldRotateFullscreenToLandscape(fullscreen, video, enabled = true) {
  return Boolean(
    enabled &&
    fullscreen &&
    video?.videoWidth > 0 &&
    video?.videoHeight > 0 &&
    video.videoWidth > video.videoHeight
  )
}

export async function setFullscreenOrientation(fullscreen, video, enabled = true) {
  if (!Capacitor.isNativePlatform()) return

  if (!(video?.videoWidth > 0 && video?.videoHeight > 0)) {
    video = video?.nativePlayback?.getVideoDimensions?.() ?? video
  }

  // Track replacement briefly clears the video size. Keep the current lock
  // until the new dimensions arrive instead of rotating out of fullscreen.
  if (fullscreen && enabled && !(video?.videoWidth > 0 && video?.videoHeight > 0)) return

  return shouldRotateFullscreenToLandscape(fullscreen, video, enabled)
    ? ScreenOrientation.lock({ type: OrientationType.LANDSCAPE })
    : ScreenOrientation.unlock()
}

export async function openNotificationSettings() {
  if (!Capacitor.isNativePlatform()) return

  try {
    await SettingsLauncher.openNotificationSettings()
  } catch {
    await SettingsLauncher.openAppSettings()
  }
}
