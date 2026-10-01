import { Capacitor, registerPlugin, SystemBarType, SystemBars } from '@capacitor/core'
import { ScreenOrientation } from '@capawesome/capacitor-screen-orientation'

const AndroidUi = process.env.IS_CAPACITOR && !process.env.IS_IOS ? registerPlugin('AndroidUi') : null
const IOSUi = process.env.IS_CAPACITOR && process.env.IS_IOS ? registerPlugin('IOSUi') : null
const ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE = 'data-android-picture-in-picture-target'
const displayRotationCallbacks = new Set()
let displayRotationHandle = null
let displayRotationTask = Promise.resolve()
let pictureInPictureVideo = null
let stopPictureInPictureBounds = null
let updatePictureInPictureBounds = null
let stopPictureInPictureTransition = null

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

function pictureInPictureSourceRect(video) {
  if (!video || document.body.classList.contains('androidPictureInPicture')) return null
  const rect = video.getBoundingClientRect()
  let { x, y, width, height } = rect
  if (getComputedStyle(video).objectFit === 'contain') {
    const dimensions = videoDimensions(video)
    const scale = Math.min(width / dimensions.width, height / dimensions.height)
    const videoWidth = dimensions.width * scale
    const videoHeight = dimensions.height * scale
    x += (width - videoWidth) / 2
    y += (height - videoHeight) / 2
    width = videoWidth
    height = videoHeight
  }
  const right = Math.min(window.innerWidth, x + width)
  const bottom = Math.min(window.innerHeight, y + height)
  x = Math.max(0, x)
  y = Math.max(0, y)
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y, viewportWidth: window.innerWidth }
    : null
}

function observePictureInPictureBounds(video) {
  if (pictureInPictureVideo === video) return
  stopPictureInPictureBounds?.()
  pictureInPictureVideo = video
  stopPictureInPictureBounds = null
  updatePictureInPictureBounds = null
  if (!video || !AndroidUi) return
  let frame = null
  const update = () => {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      const sourceRect = pictureInPictureSourceRect(video)
      if (sourceRect) {
        AndroidUi.updatePictureInPictureSourceRect({ sourceRect })
          .catch(error => console.warn('Could not update Android PiP bounds', error))
      }
    })
  }
  const observer = new ResizeObserver(update)
  updatePictureInPictureBounds = update
  observer.observe(video)
  window.addEventListener('scroll', update, true)
  window.addEventListener('resize', update)
  window.addEventListener('focus', update)
  video.closest('.ftVideoPlayer')?.addEventListener('transitionend', update)
  stopPictureInPictureBounds = () => {
    observer.disconnect()
    window.removeEventListener('scroll', update, true)
    window.removeEventListener('resize', update)
    window.removeEventListener('focus', update)
    video.closest('.ftVideoPlayer')?.removeEventListener('transitionend', update)
    if (frame !== null) cancelAnimationFrame(frame)
  }
}

function setAndroidPictureInPictureTarget(enabled, video) {
  const player = video?.closest?.('.ftVideoPlayer')
  if (enabled) {
    document.querySelectorAll(`[${ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE}]`)
      .forEach(element => element.removeAttribute(ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE))
    player?.setAttribute(ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE, '')
    observePictureInPictureBounds(video)
  } else {
    player?.removeAttribute(ANDROID_PICTURE_IN_PICTURE_TARGET_ATTRIBUTE)
    if (pictureInPictureVideo === video) observePictureInPictureBounds(null)
  }
}

export async function enterAndroidPictureInPicture(video) {
  const options = { ...videoDimensions(video), sourceRect: pictureInPictureSourceRect(video) }
  setAndroidPictureInPictureTarget(true, video)
  window.dispatchEvent(Object.assign(new Event('opentubex:android-pip'), { active: true, transitioning: true }))
  // Paint the video-only page before Android starts its entry animation.
  // The viewport and source rectangle keep their original video geometry.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const request = AndroidUi?.enterPictureInPicture(options) ?? Promise.resolve()
  return request.catch(error => {
    setAndroidPictureInPictureTarget(false, video)
    setAndroidPictureInPictureDocumentState(false)
    throw error
  })
}

export function setAndroidAutoPictureInPicture(enabled, video) {
  // Pausing or disabling automatic entry must not tear down a manual PiP.
  const retainTarget = pictureInPictureVideo === video && document.body.classList.contains('androidPictureInPicture')
  if (enabled || !retainTarget) setAndroidPictureInPictureTarget(enabled, video)
  return AndroidUi?.setAutoPictureInPicture({
    enabled,
    ...videoDimensions(video),
    sourceRect: pictureInPictureSourceRect(video),
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

export function setAndroidPictureInPictureDocumentState(active, { transitioning = false } = {}) {
  const classes = document.body.classList
  if (active && transitioning && classes.contains('androidPictureInPicture')) return
  stopPictureInPictureTransition?.()
  stopPictureInPictureTransition = null
  if (active && !classes.contains('androidPictureInPicture')) {
    const rect = pictureInPictureVideo?.getBoundingClientRect()
    if (rect) {
      // Keep the video element unchanged while native Android crops and scales
      // the live viewport, including when its safe-area insets change.
      for (const [name, value] of Object.entries({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })) {
        document.documentElement.style.setProperty(`--android-pip-source-${name}`, `${value}px`)
      }
      document.documentElement.style.setProperty('--android-pip-video-fit', getComputedStyle(pictureInPictureVideo).objectFit)
    }
  }
  if (!active && classes.contains('androidPictureInPicture')) {
    classes.toggle('androidPictureInPictureRestoring', true)
  }
  classes.toggle('androidPictureInPicture', active)
  classes.toggle('androidPictureInPictureEntering', active && transitioning)
  if (active) classes.toggle('androidPictureInPictureRestoring', false)
  else if (classes.contains('androidPictureInPictureRestoring')) {
    // Native Android emits exit after the normal window has returned. Commit
    // the restored layout before re-enabling the page's CSS transitions.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        classes.toggle('androidPictureInPictureRestoring', false)
        stopPictureInPictureTransition = null
      })
    })
    stopPictureInPictureTransition = () => cancelAnimationFrame(frame)
  }
  if (!active && pictureInPictureVideo) updatePictureInPictureBounds?.()
}

/** Colors native inset padding used by Android WebViews without edge-to-edge CSS. */
export function setAndroidSystemBarsBackground(color) {
  if (Capacitor.getPlatform() !== 'android') return Promise.resolve()
  const hex = color.replace(/^#([\da-f])([\da-f])([\da-f])$/i, '#$1$1$2$2$3$3')
  return AndroidUi?.setSystemBarsBackground({ color: hex }) ?? Promise.resolve()
}
