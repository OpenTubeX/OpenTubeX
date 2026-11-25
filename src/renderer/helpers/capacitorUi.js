import { Capacitor } from '@capacitor/core'
import { OrientationType, ScreenOrientation } from '@capawesome/capacitor-screen-orientation'
import { SettingsLauncher } from '@capawesome/capacitor-settings-launcher'

// Native code applies orientation requests in order, so the last one wins.
let landscapeLocked = false

/**
 * While the display is locked to landscape, a portrait orientation event comes
 * from a rotation requested earlier, which a busy device can deliver late.
 */
export function isLandscapeLocked() {
  return landscapeLocked
}

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

export function setLandscapeOrientation(landscape) {
  landscapeLocked = landscape
  return landscape
    ? ScreenOrientation.lock({ type: OrientationType.LANDSCAPE })
    : ScreenOrientation.unlock()
}

/** @param {() => boolean} stillWanted Checked once the orientation is known. */
export async function lockCurrentOrientation(stillWanted) {
  const { type } = await ScreenOrientation.getCurrentOrientation()
  if (!stillWanted()) return
  landscapeLocked = type.startsWith('landscape')
  await ScreenOrientation.lock({ type })
}

export async function setFullscreenOrientation(fullscreen, video, enabled = true, aspectRatio = null) {
  if (!Capacitor.isNativePlatform()) return

  // Track replacement briefly clears the video size. Keep the current lock
  // until the new dimensions arrive unless metadata already has its aspect ratio.
  if (fullscreen && enabled && !(video?.videoWidth > 0 && video?.videoHeight > 0) && !(aspectRatio > 0)) return

  return setLandscapeOrientation(shouldRotateFullscreenToLandscape(fullscreen, video, enabled, aspectRatio))
}

export async function openNotificationSettings() {
  if (!Capacitor.isNativePlatform()) return

  try {
    await SettingsLauncher.openNotificationSettings()
  } catch {
    await SettingsLauncher.openAppSettings()
  }
}
