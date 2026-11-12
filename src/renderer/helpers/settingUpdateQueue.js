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
    const currentValue = read()
    const previous = pending.get(settingId)
    const saved = previous && previous.optimisticValue === currentValue ? previous : { value: currentValue }
    const token = {}
    saved.latest = token
    pending.set(settingId, saved)
    commit(value)
    const optimisticValue = read()
    saved.optimisticValue = optimisticValue

    return runUpdate(settingId, async isLatest => {
      try {
        await persist(value)
        saved.value = value
      } catch (error) {
        if (isLatest() && read() === optimisticValue) commit(saved.value)
        throw error
      }
    }).finally(() => {
      if (pending.get(settingId) === saved && saved.latest === token) pending.delete(settingId)
    })
  }
}

/**
 * Tracks this window's setting writes:
 * - Another window can save a setting while this window writes it, and either
 *   save can end up last. Once this window's last write of the setting
 *   finishes, it shows the saved value. Windows receive saves in the order the
 *   database applied them, so a later one is newer than that value.
 * - Sync waits for `settled`, so it reads each value with its edit time.
 * @param {(settingId: string) => Promise<unknown>} readSaved
 */
export function createSettingWriteTracker(readSaved) {
  const writes = new Map()
  const running = new Set()

  return {
    /**
     * Runs `write` for `settingId`.
     * @template T
     * @param {string} settingId
     * @param {() => Promise<T>} write
     * @returns {Promise<T>}
     */
    track(settingId, write) {
      const entry = writes.get(settingId) ?? { count: 0, apply: null }
      writes.set(settingId, entry)
      entry.count++
      const run = (async () => {
        try {
          return await write()
        } finally {
          try {
            const apply = entry.count === 1 ? entry.apply : null
            if (apply) {
              const saved = await readSaved(settingId)
              // Otherwise a newer write started and shows the saved value when
              // it finishes, or a newer save arrived and was already shown.
              if (entry.count === 1 && entry.apply === apply) {
                entry.apply = null
                apply(saved)
              }
            }
          } catch (error) {
            console.error(`Failed to show the saved ${settingId} setting`, error)
          }
          if (--entry.count === 0) writes.delete(settingId)
        }
      })()
      const settle = () => running.delete(run)
      running.add(run)
      run.then(settle, settle)
      return run
    },

    /**
     * Records that another window saved `settingId`. If this window is
     * writing it, `apply` receives the saved value after the writes finish.
     * @param {string} settingId
     * @param {(saved: unknown) => void} apply
     */
    savedElsewhere(settingId, apply) {
      const entry = writes.get(settingId)
      if (entry) entry.apply = apply
    },

    /** A promise for the writes in flight, or `null` if there are none */
    settled: () => running.size > 0 ? Promise.allSettled(running) : null,
  }
}
