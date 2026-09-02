import { registerPlugin } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'

const SubscriptionRefresh = process.env.IS_CAPACITOR
  ? registerPlugin('SubscriptionRefresh')
  : null

let activeStart = null

async function requestNotificationPermission() {
  try {
    const current = await LocalNotifications.checkPermissions()
    if (current.display === 'prompt' || current.display === 'prompt-with-rationale') {
      await LocalNotifications.requestPermissions()
    }
  } catch (error) {
    console.error('Failed to request subscription refresh notification permission', error)
  }
}

export function startAndroidSubscriptionRefresh(title) {
  if (!SubscriptionRefresh) return

  requestNotificationPermission()
  const start = SubscriptionRefresh.start({ title })
    .then(({ token }) => token)
    .catch(error => {
      console.error('Failed to start Android subscription refresh work', error)
      return null
    })
  activeStart = start
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
