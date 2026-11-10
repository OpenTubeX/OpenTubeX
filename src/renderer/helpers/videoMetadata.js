import store from '../store'
import { getLocalHistoryMetadata } from './api/local'
import { getInvidiousHistoryMetadata } from './api/invidious'
import { requestWithFallback } from './api/fallback'
import { parseHistoryRepairPlayer } from '../../historyRepair'

/**
 * Loads the title, author and duration of a video with the preferred backend
 * and its fallback, as a video object for playlists and the watch queue.
 * @param {string} videoId
 * @param {AbortSignal} signal
 */
export async function loadVideoMetadata(videoId, signal) {
  const loadMetadata = async loader => {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
    const metadata = await loader(videoId, requestSignal)
    requestSignal.throwIfAborted()
    return metadata
  }
  const loadInvidious = async () => {
    const info = await loadMetadata(getInvidiousHistoryMetadata)
    if (info?.error || info?.videoId !== videoId) throw new Error('Video metadata unavailable')
    return { ...info, published: info.published * 1000, isLive: info.liveNow }
  }
  const loadLocal = async () => parseHistoryRepairPlayer(await loadMetadata(getLocalHistoryMetadata), videoId)
  const { result: info } = await requestWithFallback({ local: loadLocal, invidious: loadInvidious }, {
    backend: store.getters.getBackendPreference,
    fallback: store.getters.getBackendFallback,
    signal,
  })
  if (typeof info.title !== 'string' || !info.title.trim()) throw new Error('Video title unavailable')
  return { ...info, videoId, type: 'video', lengthSeconds: Number(info.lengthSeconds) || 0 }
}
