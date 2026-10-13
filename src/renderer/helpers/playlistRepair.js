import store from '../store'
import { needsPlaylistRepair, playlistRepairRecords } from '../../playlistRepair'
import { cancelMetadataRepair, createRepairState, runMetadataRepair } from './historyRepair'

export const playlistRepairState = createRepairState()
export const cancelPlaylistRepair = cancelMetadataRepair

export function startPlaylistRepair({ playlistIds, useCookies = false }) {
  const selected = new Set(playlistIds)
  const getPlaylists = () => store.getters.getAllPlaylists.filter(playlist => selected.has(playlist._id))
  return runMetadataRepair(playlistRepairState, {
    useCookies,
    records: playlistRepairRecords(getPlaylists()),
    needsRepair: needsPlaylistRepair,
    getRecord: id => getPlaylists().map(playlist => playlist.videos.find(video => video.videoId === id && needsPlaylistRepair(video))).find(Boolean),
    // Each saved occurrence may be missing different fields. Apply the public
    // metadata to the current entries in the datastore, rather than a snapshot.
    createPatch: (video, metadata) => ({ ...metadata, videoId: video.videoId }),
    saveMetadata: metadata => store.dispatch('repairPlaylistMetadata', { playlistIds, metadata }),
  })
}
