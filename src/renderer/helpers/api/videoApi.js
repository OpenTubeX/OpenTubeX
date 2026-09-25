import { getLocalVideoInfo } from './local'
import { invidiousGetVideoInformation } from './invidious'
import { createVideoApi } from './createVideoApi'
import { mapLocalWatchVideo, mapInvidiousWatchVideo } from './watchVideoModel'

/** @typedef {Awaited<ReturnType<typeof getLocalVideoInfo>>} LocalVideoInformation */
/** @typedef {Awaited<ReturnType<typeof invidiousGetVideoInformation>>} InvidiousVideoInformation */

/** @type {import('./createVideoApi').VideoApi<LocalVideoInformation, InvidiousVideoInformation, import('./watchVideoModel').WatchVideoMetadata, import('./watchVideoModel').WatchVideoMetadata>} */
export const videoApi = createVideoApi({
  loadLocal: getLocalVideoInfo,
  loadInvidious: invidiousGetVideoInformation,
  mapLocal: mapLocalWatchVideo,
  mapInvidious: mapInvidiousWatchVideo,
})
