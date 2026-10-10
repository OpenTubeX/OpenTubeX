import { watch, onBeforeUnmount } from 'vue'
import { DBLibraryHandlers } from '../../datastores/handlers/index'

const pendingIds = new Set()
let queued = false
let pending = Promise.resolve()

/** Batch visible-card lookups; retained library size never sizes this cache. */
export function hydrateVideoState(store, ids) {
  if (!store.state.history.libraryPaged) return Promise.resolve()
  for (const id of ids) if (typeof id === 'string' && id) pendingIds.add(id)
  if (!queued) {
    queued = true
    pending = pending.catch(console.error).then(async () => {
      // Coalesce synchronous mounts before crossing the process boundary.
      await new Promise(resolve => setTimeout(resolve, 0))
      while (pendingIds.size) {
        const batch = [...pendingIds].slice(0, 250)
        for (const id of batch) pendingIds.delete(id)
        const result = await DBLibraryHandlers.query('videoState', { ids: batch })
        store.commit('cacheHistoryRecords', { ids: batch, records: result.history })
        store.commit('cachePlaylistMemberships', { ids: batch, memberships: result.memberships, retained: Object.keys(store.state.history.activeVideoIds) })
      }
      queued = false
    }).catch(error => { queued = false; throw error })
  }
  return pending
}

export function installLibraryState(store) {
  if (!store.state.history.libraryPaged) return
  const playlistMutations = new Set(['addPlaylist', 'addPlaylists', 'upsertPlaylistToList', 'addVideo', 'addVideos', 'removeAllPlaylists', 'removeAllVideos', 'removeVideo', 'removeVideos', 'removePlaylist', 'removePlaylists'])
  let historyRevision = store.state.history.historyRevision
  let refreshQueued = false
  let refreshHistory = false
  let refreshPlaylists = false
  store.subscribe(mutation => {
    if (store.state.history.historyRevision !== historyRevision) {
      historyRevision = store.state.history.historyRevision
      refreshHistory = true
    }
    if (playlistMutations.has(mutation.type)) refreshPlaylists = true
    if (refreshQueued || (!refreshHistory && !refreshPlaylists)) return
    refreshQueued = true
    setTimeout(async () => {
      const history = refreshHistory
      const playlists = refreshPlaylists
      refreshHistory = false
      refreshPlaylists = false
      refreshQueued = false
      try {
        if (history) store.commit('setHistorySummary', await DBLibraryHandlers.query('historySummary'))
        if (playlists) store.commit('setAllPlaylists', await DBLibraryHandlers.query('playlistSummaries'))
        if (history || playlists) await hydrateVideoState(store, [...new Set([...Object.keys(store.state.playlists.playlistMemberships), ...Object.keys(store.state.history.activeVideoIds)])])
      } catch (error) { console.error(error) }
    }, 0)
  })
}

export function useVideoState(store, getIds) {
  if (!store.state.history.libraryPaged) return
  let retained = []
  watch(getIds, ids => {
    store.commit('releaseVideoState', retained)
    retained = ids.filter(id => typeof id === 'string' && id)
    store.commit('retainVideoState', retained)
    hydrateVideoState(store, retained).catch(console.error)
  }, { immediate: true })
  // Vue pauses dependency tracking for lifecycle hooks. A scope cleanup runs
  // during its parent's patch and would subscribe that render to cache reads.
  onBeforeUnmount(() => store.commit('releaseVideoState', retained))
}
