/**
 * Runs setting writes in order while dropping queued values that have already
 * been superseded. The callback can check whether an in-flight write is still
 * current before committing its result.
 */
export function createSettingUpdateQueue() {
  const latestUpdates = new Map()
  const pendingUpdates = new Map()

  return (settingId, update) => {
    const token = {}
    latestUpdates.set(settingId, token)

    const previousUpdate = pendingUpdates.get(settingId) ?? Promise.resolve()
    const pendingUpdate = previousUpdate
      .catch(() => {})
      .then(() => latestUpdates.get(settingId) === token
        ? update(() => latestUpdates.get(settingId) === token)
        : undefined)

    pendingUpdates.set(settingId, pendingUpdate)

    return pendingUpdate.finally(() => {
      if (pendingUpdates.get(settingId) === pendingUpdate) {
        pendingUpdates.delete(settingId)
      }
      if (latestUpdates.get(settingId) === token) {
        latestUpdates.delete(settingId)
      }
    })
  }
}
