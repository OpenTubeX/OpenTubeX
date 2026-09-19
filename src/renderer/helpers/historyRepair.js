import { reactive } from 'vue'
import store from '../store'
import { parseHistoryRepairPlayer, repairHistory } from '../../historyRepair'
import { getLocalHistoryMetadata } from './api/local'
import { getInvidiousHistoryMetadata } from './api/invidious'

export const historyRepairState = reactive({
  running: false, total: 0, checked: 0, repaired: 0, failed: 0, started: false, phase: 'checking', error: ''
})
let controller

export function cancelHistoryRepair() {
  controller?.abort()
}

async function fetchMetadata(videoId, signal) {
  const timeoutSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
  if (!process.env.SUPPORTS_LOCAL_API || store.getters.getBackendPreference === 'invidious') {
    const info = await getInvidiousHistoryMetadata(videoId, timeoutSignal)
    if (info.error || info.videoId !== videoId) throw new Error('Video metadata unavailable')
    return {
      ...info,
      published: info.published * 1000,
      isLive: info.liveNow,
    }
  }
  return parseHistoryRepairPlayer(await getLocalHistoryMetadata(videoId, timeoutSignal), videoId)
}

export async function startHistoryRepair() {
  if (historyRepairState.running) return
  controller = new AbortController()
  Object.assign(historyRepairState, { running: true, started: true, total: 0, checked: 0, repaired: 0, failed: 0, phase: 'checking', error: '' })
  try {
    await repairHistory({
      records: store.getters.getHistoryCacheSorted,
      getRecord: id => store.getters.getHistoryCacheById[id],
      fetchMetadata,
      saveMetadata: metadata => store.dispatch('updateSubscriptionHistory', { metadata }),
      signal: controller.signal,
      onProgress: progress => Object.assign(historyRepairState, progress),
      onPhase: phase => { historyRepairState.phase = phase },
    })
    historyRepairState.phase = controller.signal.aborted ? 'stopped' : 'finished'
  } catch (error) {
    historyRepairState.phase = 'stopped'
    historyRepairState.error = error.message || String(error)
  } finally {
    historyRepairState.running = false
    controller = null
  }
}
