/**
 * Owns the one renderer refresh that may be waiting for or using native work.
 * A start factory is only called after the controller has reserved the slot.
 */
export function createSubscriptionRefreshStartController() {
  let activeStart = null

  return {
    begin(refreshId, createStart) {
      if (activeStart !== null) return null

      activeStart = { refreshId, start: null }
      try {
        activeStart.start = createStart()
        return activeStart.start
      } catch (error) {
        activeStart = null
        throw error
      }
    },
    current(refreshId) {
      return activeStart?.refreshId === refreshId ? activeStart.start : null
    },
    isCurrent(refreshId, start) {
      return activeStart?.refreshId === refreshId && activeStart.start === start
    },
    finish(refreshId) {
      if (activeStart?.refreshId !== refreshId) return null

      const { start } = activeStart
      activeStart = null
      return start
    }
  }
}
