import { registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

const SubscriptionRefresh = process.env.IS_CAPACITOR
  ? registerPlugin('SubscriptionRefresh')
  : null

let activeStart = null

export async function requestAndroidSubscriptionRefreshNotificationPermission() {
  try {
    let current = await LocalNotifications.checkPermissions()
    if (current.display === 'prompt' || current.display === 'prompt-with-rationale') {
      current = await LocalNotifications.requestPermissions()
    }
    return current.display === 'denied'
  } catch (error) {
    console.error('Failed to request subscription refresh notification permission', error)
    return false
  }
}

export async function startAndroidSubscriptionRefresh(title, cancelLabel) {
  if (!SubscriptionRefresh) return { acquired: true, notificationsDenied: false }

  let notificationsDenied = false
  const start = requestAndroidSubscriptionRefreshNotificationPermission()
    .then(denied => {
      notificationsDenied = denied
      return SubscriptionRefresh.start({ title, cancelLabel })
    })
    .then(({ token, acquired }) => acquired ? token : null)
    .catch(error => {
      console.error('Failed to start Android subscription refresh work', error)
      return null
    })
  activeStart = start
  const token = await start
  return { acquired: token !== null, notificationsDenied }
}

export function updateAndroidSubscriptionRefresh(progress) {
  const start = activeStart
  if (!start) return

  start.then(token => {
    if (activeStart !== start || token === null) return
    return SubscriptionRefresh.update({ token, progress: Math.round(progress) })
  }).catch(error => {
    console.error('Failed to update Android subscription refresh work', error)
  })
}

export function finishAndroidSubscriptionRefresh() {
  const start = activeStart
  activeStart = null
  if (!start) return

  start.then(token => token === null ? null : SubscriptionRefresh.finish({ token })).catch(error => {
    console.error('Failed to finish Android subscription refresh work', error)
  })
}

export function configureAndroidSubscriptionRefresh(configuration) {
  if (!SubscriptionRefresh) return Promise.resolve()
  return SubscriptionRefresh.configure({ configuration })
}

export async function isAndroidSubscriptionRefreshActive() {
  if (!SubscriptionRefresh) return false
  const { active } = await SubscriptionRefresh.isActive()
  return active === true
}

export async function getNextAndroidSubscriptionRefreshResult() {
  if (!SubscriptionRefresh) return null
  const { result } = await SubscriptionRefresh.nextPendingResult()
  return result ?? null
}

export async function acknowledgeAndroidSubscriptionRefreshResult(id) {
  if (!SubscriptionRefresh) return
  const { removed } = await SubscriptionRefresh.acknowledgePendingResult({ id })
  if (!removed) throw new Error('Unable to acknowledge pending subscription refresh data')
}

export function openAndroidNotificationSettings() {
  if (!SubscriptionRefresh) return Promise.resolve()
  return SubscriptionRefresh.openNotificationSettings()
}

export async function addAndroidSubscriptionRefreshCancelledListener(listener) {
  if (!SubscriptionRefresh) return () => {}
  const handle = await SubscriptionRefresh.addListener('cancelled', listener)
  return () => handle.remove()
}
