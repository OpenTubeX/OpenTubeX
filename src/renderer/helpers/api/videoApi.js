import { getLocalVideoInfo } from './local'
import { invidiousGetVideoInformation } from './invidious'
import { createVideoApi } from './createVideoApi'

/** @typedef {Awaited<ReturnType<typeof getLocalVideoInfo>>} LocalVideoInformation */
/** @typedef {Awaited<ReturnType<typeof invidiousGetVideoInformation>>} InvidiousVideoInformation */

/** @type {import('./createVideoApi').VideoApi<LocalVideoInformation, InvidiousVideoInformation>} */
export const videoApi = createVideoApi({
  loadLocal: getLocalVideoInfo,
  loadInvidious: invidiousGetVideoInformation,
})
