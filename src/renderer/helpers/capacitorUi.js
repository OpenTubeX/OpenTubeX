import { Capacitor } from '@capacitor/core'
import { OrientationType, ScreenOrientation } from '@capawesome/capacitor-screen-orientation'
import { SettingsLauncher } from '@capawesome/capacitor-settings-launcher'

export function getFullscreenAspectRatio(videoAspectRatio, shortsPlayer) {
  return videoAspectRatio > 0 ? videoAspectRatio : shortsPlayer ? 9 / 16 : null
}

export function shouldRotateFullscreenToLandscape(fullscreen, video, enabled = true, aspectRatio = null) {
  const videoAspectRatio = video?.videoWidth > 0 && video?.videoHeight > 0
    ? video.videoWidth / video.videoHeight
    : aspectRatio

  return Boolean(
    enabled &&
    fullscreen &&
    videoAspectRatio > 1
  )
}

export async function setFullscreenOrientation(fullscreen, video, enabled = true, aspectRatio = null) {
  if (!Capacitor.isNativePlatform()) return

  // Track replacement briefly clears the video size. Keep the current lock
  // until the new dimensions arrive unless metadata already has its aspect ratio.
  if (fullscreen && enabled && !(video?.videoWidth > 0 && video?.videoHeight > 0) && !(aspectRatio > 0)) return

  return shouldRotateFullscreenToLandscape(fullscreen, video, enabled, aspectRatio)
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
