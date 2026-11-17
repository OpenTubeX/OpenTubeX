import { registerPlugin } from '@capacitor/core'

// Android freezes a hidden app. While a hold is active, the native side keeps
// the app and its WebView running so a sync or RSS refresh can finish out of view.
const BackgroundSync = process.env.IS_CAPACITOR && !process.env.IS_IOS
  ? registerPlugin('BackgroundSync')
  : null

/** @typedef {'sync' | 'commentReplies' | 'twitchLive'} PeriodicBackgroundTask */

/** @type {Map<PeriodicBackgroundTask, boolean>} */
const enabledTasks = new Map()
/** @type {(() => Promise<unknown>)[]} */
const periodicTasks = []

/**
 * Whether this page is the hidden renderer that the periodic job loads to run
 * the background tasks while the app is closed, rather than the app.
 */
export const isAndroidBackgroundRenderer = Boolean(BackgroundSync) && 'OpenTubeXBackgroundSync' in window

/** Tells the periodic job that the hidden renderer's tasks ended. */
export function finishAndroidBackgroundTasks() {
  return BackgroundSync.finishHiddenSync()
}

/** @returns {() => void} Releases the hold. */
export function holdAndroidBackgroundWork() {
  if (!BackgroundSync) return () => {}
  const hold = BackgroundSync.begin().catch(error => {
    console.error('Failed to keep Android background work running', error)
    return null
  })
  return () => {
    hold.then(result => result && BackgroundSync.end(result)).catch(error => {
      console.error('Failed to release Android background work', error)
    })
  }
}

/**
 * Turns a task of the periodic job on or off. The job runs while the app is
 * hidden or closed, as long as any task is on.
 * @param {PeriodicBackgroundTask} task
 * @param {boolean} enabled
 */
export function setPeriodicBackgroundTask(task, enabled) {
  if (!BackgroundSync || enabledTasks.get(task) === enabled) return
  enabledTasks.set(task, enabled)
  BackgroundSync.setEnabled({ task, enabled }).catch(error => {
    console.error('Failed to schedule an Android background task', error)
  })
}

/**
 * Runs a task whenever the periodic job wakes the hidden app. The job keeps the
 * app running until every task has finished.
 * @param {() => Promise<unknown>} task
 */
export function onPeriodicBackgroundTask(task) {
  if (!BackgroundSync) return
  if (periodicTasks.length === 0) {
    BackgroundSync.addListener('sync', ({ id }) => {
      Promise.allSettled(periodicTasks.map(run => Promise.resolve().then(run).catch(error => {
        console.error('Android background task failed', error)
      }))).finally(() => BackgroundSync.end({ id }).catch(() => {}))
    })
  }
  periodicTasks.push(task)
}

/**
 * Shows a notification that a check found, or leaves it to the visible app.
 * With `history`, the app adds it to its notification history.
 * @param {{
 *   feedType: 'twitch' | 'comment-reply' | 'comment-heart',
 *   id: string,
 *   title: string,
 *   body: string,
 *   thumbnail?: string | null,
 *   live?: boolean,
 *   history: boolean
 * }} notification
 */
export async function deliverAndroidNotification(notification) {
  await BackgroundSync.deliverNotification(notification)
}

/**
 * @param {() => void} callback Runs when the app window loses focus, for example
 * when the user opens recents, where they can swipe the app away.
 */
export function onAndroidWindowBlur(callback) {
  if (BackgroundSync) window.addEventListener('opentubex:android-window-blur', callback)
}
