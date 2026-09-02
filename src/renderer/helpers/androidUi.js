import { Capacitor, registerPlugin, SystemBarType, SystemBars } from '@capacitor/core'

const AndroidUi = process.env.IS_CAPACITOR ? registerPlugin('AndroidUi') : null

function videoDimensions(video) {
  return {
    width: video?.videoWidth || 16,
    height: video?.videoHeight || 9,
  }
}

export function enterAndroidPictureInPicture(video) {
  setAndroidPictureInPictureDocumentState(true)
  const request = AndroidUi?.enterPictureInPicture(videoDimensions(video)) ?? Promise.resolve()
  return request.catch(error => {
    setAndroidPictureInPictureDocumentState(false)
    throw error
  })
}

export function setAndroidAutoPictureInPicture(enabled, video) {
  return AndroidUi?.setAutoPictureInPicture({
    enabled,
    ...videoDimensions(video),
  }) ?? Promise.resolve()
}

export function shouldRotateFullscreenToLandscape(fullscreen, video, enabled = true) {
  return Boolean(
    enabled &&
    fullscreen &&
    video?.videoWidth > 0 &&
    video?.videoHeight > 0 &&
    video.videoWidth > video.videoHeight
  )
}

export function setAndroidFullscreenOrientation(fullscreen, video, enabled = true) {
  return AndroidUi?.setFullscreenOrientation({
    landscape: shouldRotateFullscreenToLandscape(fullscreen, video, enabled),
  }) ?? Promise.resolve()
}

/**
 * @param {{active: boolean, fullscreen: boolean, controlsShown: boolean}} state
 * @returns {boolean}
 */
export function shouldShowAndroidStatusBar({ active, fullscreen, controlsShown }) {
  return !active || !fullscreen || controlsShown
}

export function setAndroidStatusBarVisible(visible) {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SystemBars')) {
    return Promise.resolve()
  }

  return visible
    ? SystemBars.show({ bar: SystemBarType.StatusBar })
    : SystemBars.hide({ bar: SystemBarType.StatusBar })
}

export function writeAndroidClipboard(text) {
  return AndroidUi?.writeClipboard({ text }) ?? Promise.resolve()
}

export function exitAndroidApp() {
  return AndroidUi?.exitApp() ?? Promise.resolve()
}

export async function getAndroidHardwareKeyboardState() {
  const result = await (AndroidUi?.getHardwareKeyboardState() ?? Promise.resolve({ attached: false }))
  return result.attached === true
}

export function setAndroidPictureInPictureDocumentState(active) {
  document.body.classList.toggle('androidPictureInPicture', active)
}
