import { computed } from 'vue'
import store from '../store'
import { needsPlaylistRepair, playlistRepairRecords } from '../../playlistRepair'
import { cancelMetadataRepair, createRepairState, runMetadataRepair } from './historyRepair'

export const playlistRepairState = createRepairState()
export const cancelPlaylistRepair = cancelMetadataRepair

export function startPlaylistRepair({ playlistIds, useCookies = false }) {
  const selected = new Set(playlistIds)
  const getPlaylists = () => store.getters.getAllPlaylists.filter(playlist => selected.has(playlist._id))
  // Reuse the lookup across a batch, while reacting to selected entries being
  // removed, replaced, or repaired during an in-flight request.
  const recordsById = computed(() => new Map(playlistRepairRecords(getPlaylists()).map(video => [video.videoId, video])))
  return runMetadataRepair(playlistRepairState, {
    useCookies,
    records: [...recordsById.value.values()],
    needsRepair: needsPlaylistRepair,
    saveBatchSize: 100,
    getRecord: id => recordsById.value.get(id),
    // Each saved occurrence may be missing different fields. Apply the public
    // metadata to the current entries in the datastore, rather than a snapshot.
    createPatch: (video, metadata) => ({ ...metadata, videoId: video.videoId }),
    saveMetadata: metadata => store.dispatch('repairPlaylistMetadata', { playlistIds, metadata }),
  })
}
