import { areNotificationDismissalsEqual, normalizeNotificationDismissals } from '../../notificationHistory.js'

/**
 * Combines the notifications read or removed on each device. Dismissals only
 * accumulate, so the merge needs no baseline from the previous sync.
 * @param {{ getNotificationDismissals: () => Promise<unknown>, putNotificationDismissals: (dismissals: import('../../notificationHistory').NotificationDismissals) => Promise<void> }} client
 * @param {{ mergeDismissals: (dismissals: import('../../notificationHistory').NotificationDismissals) => Promise<unknown> }} history
 * @returns {Promise<number>} how many notifications were dismissed
 */
export async function syncNotificationDismissals(client, history) {
  const remote = normalizeNotificationDismissals(await client.getNotificationDismissals())
  const merged = normalizeNotificationDismissals(await history.mergeDismissals(remote))
  if (!areNotificationDismissalsEqual(merged, remote)) await client.putNotificationDismissals(merged)
  return merged.dismissals.length
}
