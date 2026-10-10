import { ref, watch } from 'vue'
import { DBLibraryHandlers } from '../../datastores/handlers/index'

export function usePlaylistStatistics(store, id, enabled) {
  const statistics = ref({ total: 0, uniqueCount: 0, duration: 0, missingDuration: 0, watchedCount: 0 })
  let generation = 0
  watch([id, enabled, () => store.state.history.historyRevision, () => store.getters.getPlaylist(id())], async () => {
    const current = ++generation
    if (!enabled() || !id()) return
    try {
      const result = await DBLibraryHandlers.query('playlistStatistics', { id: id() })
      if (current === generation) statistics.value = result
    } catch (error) { console.error(error) }
  }, { immediate: true })
  return statistics
}
