import { getLocalPlaylist, parseLocalPlaylistVideos } from './local'
import { invidiousGetPlaylistInfo } from './invidious'
import { loadInvidiousPlaylistSnapshot, loadLocalPlaylistSnapshot } from '../playlist-snapshot'
import { requestWithFallback } from './fallback'

export async function getPlaylistSnapshot(id, { backend, fallback, signal }) {
  // A fallback restarts from page one on the other API, without mixing snapshots.
  const { result } = await requestWithFallback({
    local: () => loadLocalPlaylistSnapshot(id, {
      getPlaylist: getLocalPlaylist,
      // A snapshot must fail on an empty/invalid continuation instead of silently
      // accepting the partial result used by the browsing view.
      getContinuation: playlist => playlist.getContinuation(),
      parseVideos: parseLocalPlaylistVideos,
      signal,
    }),
    invidious: () => loadInvidiousPlaylistSnapshot(id, {
      getPlaylist: invidiousGetPlaylistInfo,
      signal,
    }),
  }, { backend, fallback, signal })
  return result
}
