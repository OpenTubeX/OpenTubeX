// Last-seen images stay on this device and never enter persisted/synced tabs.
// `storage` mirrors them to disk so they survive restarts.
export function createCapacitorPreviewCache(capture, entries = new Map(), limit = 24, storage = null) {
  let generation = 0
  let pending = null
  let pendingGeneration = 0
  const remove = id => {
    entries.delete(id)
    storage?.remove(id)
  }
  const evict = () => {
    while (entries.size > limit) remove(entries.keys().next().value)
  }
  return {
    entries,
    get(tab) {
      const entry = entries.get(tab.id)
      return entry && entry.route === tab.route?.fullPath ? entry.image : null
    },
    invalidate() { generation += 1 },
    clear() { generation += 1; entries.clear() },
    prune(tabs) {
      for (const [id, entry] of entries) {
        if (!tabs.some(tab => tab.id === id && tab.route.fullPath === entry.route)) remove(id)
      }
    },
    /** Add stored previews as the least recently seen, keeping newer captures. */
    restore(stored) {
      const current = new Map(entries)
      entries.clear()
      const oldestFirst = [...stored].sort(([, a], [, b]) => (a.capturedAt || 0) - (b.capturedAt || 0))
      for (const [id, { route, image }] of oldestFirst) {
        if (typeof route === 'string' && !current.has(id)) entries.set(id, { route, image })
      }
      for (const [id, entry] of current) entries.set(id, entry)
      evict()
    },
    async capture(tab) {
      const revision = generation
      if (pending) {
        const previousRevision = pendingGeneration
        await pending
        // A stable-page request must not be consumed by an invalidated capture.
        if (revision === generation && revision !== previousRevision) return this.capture(tab)
        return
      }
      pendingGeneration = revision
      const { id, route: { fullPath: route } } = tab
      pending = (async () => {
        try {
          const image = await capture()
          if (!image || revision !== generation) return
          entries.delete(id)
          entries.set(id, { route, image })
          storage?.write(id, { route, image, capturedAt: Date.now() })
          evict()
        } catch (error) {
          console.warn('Failed to capture mobile tab preview:', error)
        }
      })()
      try { await pending } finally { pending = null }
    }
  }
}

export function canCaptureCapacitorTab(getters, visible) {
  const tab = getters.getPresentedTab
  return !!(getters.getShowTabPreviews && !getters.isAnyPromptOpen &&
    !getters.getSettingsWindowOpen && !getters.getSettingsWindowMorphing &&
    visible && tab && !tab.isLoading && tab.id === getters.getActiveTabId &&
    tab.loadState === 'loaded')
}
