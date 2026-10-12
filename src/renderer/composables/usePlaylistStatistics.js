import { onScopeDispose, ref, watch } from 'vue'
import { DBLibraryHandlers } from '../../datastores/handlers/index'

export function usePlaylistStatistics(store, id, enabled) {
  const empty = { total: 0, uniqueCount: 0, duration: 0, missingDuration: 0, watchedCount: 0 }
  const statistics = ref({ ...empty })
  let generation = 0
  let statisticsId = null
  let timer
  async function refreshStatistics() {
    const current = ++generation
    clearTimeout(timer)
    const playlistId = id()
    if (!enabled() || !playlistId) {
      statisticsId = null
      statistics.value = { ...empty }
      return
    }
    if (statisticsId !== playlistId) statistics.value = { ...empty }
    statisticsId = playlistId
    try {
      const { refreshAt, ...result } = await DBLibraryHandlers.query('playlistStatistics', { id: playlistId, includeExpiry: true })
      if (current !== generation) return
      statistics.value = result
      if (Number.isFinite(refreshAt)) timer = setTimeout(refreshStatistics, Math.min(2147483647, Math.max(1, refreshAt - Date.now())))
    } catch (error) { console.error(error) }
  }
  watch([id, enabled, () => store.state.history.historyRevision, () => {
    const playlist = store.getters.getPlaylist(id())
    return JSON.stringify([playlist?.videoCount, playlist?.lastUpdatedAt, Array.isArray(playlist?.videos) ? playlist.videos.map(video => [typeof video?.videoId, video?.videoId, typeof video?.lengthSeconds, video?.lengthSeconds]) : []])
  }], refreshStatistics, { immediate: true })
  onScopeDispose(() => { generation++; clearTimeout(timer) })
  return statistics
}
