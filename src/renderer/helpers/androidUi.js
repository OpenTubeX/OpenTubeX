import { Capacitor, registerPlugin, SystemBarType, SystemBars } from '@capacitor/core'
import { ScreenOrientation } from '@capawesome/capacitor-screen-orientation'

const AndroidUi = process.env.IS_CAPACITOR && !process.env.IS_IOS ? registerPlugin('AndroidUi') : null
const IOSUi = process.env.IS_CAPACITOR && process.env.IS_IOS ? registerPlugin('IOSUi') : null
const ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE = 'data-android-picture-in-picture-target'
const displayRotationCallbacks = new Set()
let displayRotationHandle = null
let displayRotationTask = Promise.resolve()

function reconcileDisplayRotationListener() {
  displayRotationTask = displayRotationTask.then(async () => {
    if (displayRotationCallbacks.size && !displayRotationHandle) {
      displayRotationHandle = await ScreenOrientation.addListener('screenOrientationChange', ({ type }) => {
        for (const callback of displayRotationCallbacks) callback(type.startsWith('landscape'))
      })
    } else if (!displayRotationCallbacks.size && displayRotationHandle) {
      await displayRotationHandle.remove()
      displayRotationHandle = null
    }
  }).catch(error => console.warn('Could not observe Android display rotation', error))
}

export function observeAndroidDisplayRotation(callback) {
  if (!AndroidUi) return () => {}
  displayRotationCallbacks.add(callback)
  reconcileDisplayRotationListener()
  return () => {
    displayRotationCallbacks.delete(callback)
    reconcileDisplayRotationListener()
  }
}

function videoDimensions(video) {
  return {
    width: video?.videoWidth || 16,
    height: video?.videoHeight || 9,
  }
}

function setAndroidPictureInPictureTarget(enabled, video) {
  const player = video?.closest?.('.ftVideoPlayer')
  if (enabled) {
    document.querySelectorAll(`[${ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE}]`)
      .forEach(element => element.removeAttribute(ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE))
    player?.setAttribute(ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE, '')
  } else {
    player?.removeAttribute(ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE)
  }
}

export function enterAndroidPictureInPicture(video) {
  setAndroidPictureInPictureTarget(true, video)
  setAndroidPictureInPictureDocumentState(true)
  const request = AndroidUi?.enterPictureInPicture(videoDimensions(video)) ?? Promise.resolve()
  return request.catch(error => {
    setAndroidPictureInPictureTarget(false, video)
    setAndroidPictureInPictureDocumentState(false)
    throw error
  })
}

export function setAndroidAutoPictureInPicture(enabled, video) {
  setAndroidPictureInPictureTarget(enabled, video)
  return AndroidUi?.setAutoPictureInPicture({
    enabled,
    ...videoDimensions(video),
  }) ?? Promise.resolve()
}

export async function isAndroidLauncherReturnInProgress() {
  try {
    const state = await (AndroidUi?.isLauncherReturnInProgress() ?? Promise.resolve({ inProgress: false }))
    return state.inProgress === true
  } catch (error) {
    console.warn('Could not check Android launcher return', error)
    return false
  }
}

/**
 * @param {{active: boolean, fullscreen: boolean, controlsShown: boolean}} state
 * @returns {boolean}
 */
export function shouldShowAndroidStatusBar({ active, fullscreen, controlsShown }) {
  return !active || !fullscreen || controlsShown
}

function setAndroidSystemBarVisible(bar, visible) {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SystemBars')) {
    return Promise.resolve()
  }

  return visible
    ? SystemBars.show({ bar })
    : SystemBars.hide({ bar })
}

export function setAndroidStatusBarVisible(visible) {
  return setAndroidSystemBarVisible(SystemBarType.StatusBar, visible)
}

export function setAndroidNavigationBarVisible(visible) {
  return setAndroidSystemBarVisible(SystemBarType.NavigationBar, visible)
}

export function exitAndroidApp() {
  return AndroidUi?.exitApp() ?? Promise.resolve()
}

export function restartAndroidApp() {
  return AndroidUi?.restartApp() ?? Promise.resolve()
}

export async function getAndroidHardwareKeyboardState() {
  const result = await ((IOSUi ?? AndroidUi)?.getHardwareKeyboardState() ?? Promise.resolve({ attached: false }))
  return result.attached === true
}

export function getAndroidDeviceArchitecture() {
  return AndroidUi?.getDeviceArchitecture() ?? Promise.resolve({ architecture: '' })
}

export function setAndroidPictureInPictureDocumentState(active) {
  document.body.classList.toggle('androidPictureInPicture', active)
}

/** Colors native inset padding used by Android WebViews without edge-to-edge CSS. */
export function setAndroidSystemBarsBackground(color, followSystem) {
  if (Capacitor.getPlatform() !== 'android') return Promise.resolve()
  const hex = color.replace(/^#([\da-f])([\da-f])([\da-f])$/i, '#$1$1$2$2$3$3')
  return AndroidUi?.setSystemBarsBackground({ color: hex, followSystem }) ?? Promise.resolve()
}
