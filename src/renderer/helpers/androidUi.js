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

function pictureInPictureGeometry(video) {
  const bounds = video.getBoundingClientRect()
  const rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
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
  if (x + width <= 0 || y + height <= 0 || x >= window.innerWidth || y >= window.innerHeight) {
    // Keep automatic PiP available after scrolling the video offscreen. Move
    // its live content and enclosing element together into the native crop.
    const offsetX = Math.max(0, Math.min(x, window.innerWidth - width)) - x
    const offsetY = Math.max(0, Math.min(y, window.innerHeight - height)) - y
    x += offsetX
    y += offsetY
    rect.x += offsetX
    rect.y += offsetY
  }
  return { rect, content: { x, y, width, height } }
}

function pictureInPictureSourceRect(video) {
  if (!video || document.body.classList.contains('androidPictureInPicture')) return null
  let { x, y, width, height } = pictureInPictureGeometry(video).content
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
  let lastSent
  const update = () => {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      if (document.body.classList.contains('androidPictureInPicture')) return
      const sourceRect = pictureInPictureSourceRect(video)
      const key = JSON.stringify(sourceRect)
      if (key === lastSent) return
      lastSent = key
      AndroidUi.updatePictureInPictureSourceRect({ sourceRect })
        .catch(error => {
          if (lastSent === key) lastSent = undefined
          console.warn('Could not update Android PiP bounds', error)
        })
    })
  }
  const focused = () => {
    // Native Android ignores bounds while unfocused. Resend on return even
    // when the renderer's geometry has stayed unchanged.
    lastSent = undefined
    update()
  }
  const observer = new ResizeObserver(update)
  updatePictureInPictureBounds = update
  observer.observe(video)
  window.addEventListener('scroll', update, true)
  window.addEventListener('resize', update)
  window.addEventListener('focus', focused)
  video.closest('.ftVideoPlayer')?.addEventListener('transitionend', update)
  stopPictureInPictureBounds = () => {
    observer.disconnect()
    window.removeEventListener('scroll', update, true)
    window.removeEventListener('resize', update)
    window.removeEventListener('focus', focused)
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

function waitForPictureInPicturePaint() {
  return new Promise(resolve => {
    let frame = null
    let timer = null
    let finished = false
    const finish = (painted, nativeChange = false) => {
      if (finished) return
      finished = true
      if (frame !== null) cancelAnimationFrame(frame)
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('blur', interrupted)
      window.removeEventListener('opentubex:android-pip', changed)
      resolve({ painted, nativeChange })
    }
    const interrupted = () => finish(false)
    const changed = () => finish(false, true)
    const hidden = () => { if (document.hidden) interrupted() }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('blur', interrupted)
    window.addEventListener('opentubex:android-pip', changed)
    timer = setTimeout(interrupted, 1000)
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => finish(true)) })
    if (document.hidden || !document.hasFocus()) interrupted()
  })
}

export async function enterAndroidPictureInPicture(video) {
  const options = { ...videoDimensions(video), sourceRect: pictureInPictureSourceRect(video) }
  setAndroidPictureInPictureTarget(true, video)
  window.dispatchEvent(Object.assign(new Event('opentubex:android-pip'), { active: true, transitioning: true }))
  // Paint the video-only page before Android starts its entry animation.
  // The viewport and source rectangle keep their original video geometry.
  const { painted, nativeChange } = await waitForPictureInPicturePaint()
  if (!painted || document.hidden || !document.hasFocus()) {
    // Home may already be entering automatic PiP. Leave its preparation intact
    // until Android's mode/resume callback reconciles the backgrounded page.
    if (!nativeChange && document.body.classList.contains('androidPictureInPictureEntering')) {
      const restore = () => {
        if (!document.hidden && document.hasFocus()) setAndroidPictureInPictureDocumentState(false)
      }
      // A notification shade can blur the WebView without pausing the Activity.
      // Native mode callbacks cancel this fallback if automatic PiP takes over.
      window.addEventListener('focus', restore)
      stopPictureInPictureTransition = () => window.removeEventListener('focus', restore)
      restore()
    }
    return
  }
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
    sourceRect: enabled || retainTarget ? pictureInPictureSourceRect(video) : null,
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
  stopPictureInPictureTransition?.()
  stopPictureInPictureTransition = null
  if (active && transitioning && classes.contains('androidPictureInPicture')) return
  if (active && !classes.contains('androidPictureInPicture')) {
    const rect = pictureInPictureVideo ? pictureInPictureGeometry(pictureInPictureVideo).rect : null
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
        window.dispatchEvent(new Event('opentubex:android-pip-restored'))
        // Commit reanchoring while CSS transitions are still suppressed.
        frame = requestAnimationFrame(() => {
          classes.toggle('androidPictureInPictureRestoring', false)
          stopPictureInPictureTransition = null
        })
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
