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

/**
 * Publishes list edits immediately so the next edit starts from the intended
 * value. Failed writes restore the last persisted value, unless superseded.
 */
export function createOptimisticSettingUpdater() {
  const runUpdate = createSettingUpdateQueue()
  const pending = new Map()

  return (settingId, value, { read, commit, persist }) => {
    const saved = pending.get(settingId) ?? { value: read() }
    const token = {}
    saved.latest = token
    pending.set(settingId, saved)
    commit(value)

    return runUpdate(settingId, async isLatest => {
      try {
        await persist(value)
        saved.value = value
      } catch (error) {
        if (isLatest()) commit(saved.value)
        throw error
      }
    }).finally(() => {
      if (saved.latest === token) pending.delete(settingId)
    })
  }
}
