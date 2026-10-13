import { DBLibraryHandlers } from '../../datastores/handlers/index'
import { computed } from 'vue'
import store from '../store'
import { needsPlaylistRepair, playlistRepairRecords } from '../../playlistRepair'
import { cancelMetadataRepair, createRepairState, runMetadataRepair } from './historyRepair'

export const playlistRepairState = createRepairState()
export const cancelPlaylistRepair = cancelMetadataRepair

export async function readPlaylistRepairRecords(playlistIds, signal, limit = Infinity) {
  const records = new Map()
  for (const id of playlistIds) {
    let cursor = null
    do {
      signal?.throwIfAborted()
      const page = await DBLibraryHandlers.query('playlistPage', { id, cursor, limit: 250, sort: 'custom' })
      signal?.throwIfAborted()
      if (page.stale) throw new Error('The playlist changed during metadata repair; try again')
      for (const entry of page.records) {
        if (needsPlaylistRepair(entry) && !records.has(entry.videoId)) {
          records.set(entry.videoId, entry)
          if (records.size >= limit) return [...records.values()]
        }
      }
      cursor = page.cursor
    } while (cursor)
  }
  return [...records.values()]
}

export function startPlaylistRepair({ playlistIds, useCookies = false }) {
  const selected = new Set(playlistIds)
  const getPlaylists = () => store.getters.getAllPlaylists.filter(playlist => selected.has(playlist._id))
  // Reuse the lookup across a batch, while reacting to selected entries being
  // removed, replaced, or repaired during an in-flight request.
  let pagedRecords = new Map()
  const paged = store.state?.playlists?.libraryPaged === true
  const recordsById = computed(() => new Map(playlistRepairRecords(getPlaylists()).map(video => [video.videoId, video])))
  return runMetadataRepair(playlistRepairState, {
    useCookies,
    records: paged
      ? async signal => {
        const records = await readPlaylistRepairRecords(playlistIds, signal)
        pagedRecords = new Map(records.map(video => [video.videoId, video]))
        return records
      }
      : [...recordsById.value.values()],
    needsRepair: needsPlaylistRepair,
    saveBatchSize: 100,
    getRecord: id => paged ? pagedRecords.get(id) : recordsById.value.get(id),
    // Each saved occurrence may be missing different fields. Apply the public
    // metadata to the current entries in the datastore, rather than a snapshot.
    createPatch: (video, metadata) => ({ ...metadata, videoId: video.videoId }),
    saveMetadata: metadata => store.dispatch('repairPlaylistMetadata', { playlistIds, metadata }),
  })
}
