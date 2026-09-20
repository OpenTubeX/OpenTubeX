import { reactive } from 'vue'
import store from '../store'
import { HistoryRepairUnavailableError, parseHistoryRepairPlayer, parseHistoryRepairYtDlp, repairHistory } from '../../historyRepair'
import { ytDlp } from './ytDlp'
import { getLocalHistoryMetadata } from './api/local'
import { getInvidiousHistoryMetadata } from './api/invidious'

export const historyRepairState = reactive({
  running: false, total: 0, checked: 0, repaired: 0, failed: 0, started: false, phase: 'checking', error: ''
})
let controller

export function cancelHistoryRepair() {
  controller?.abort()
  if (process.env.IS_ELECTRON) ytDlp.ytDlpCancelHistoryRepair().catch(console.error)
}

async function fetchMetadata(videoId, signal, useCookies) {
  if (useCookies) {
    signal.throwIfAborted()
    // Native extraction has its own timeout. Stop waiting on cancellation and
    // discard its eventual result, just as aborted API requests are discarded.
    const { promise, reject } = Promise.withResolvers()
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    try {
      const info = await Promise.race([ytDlp.ytDlpGetHistoryMetadata(videoId), promise])
      return parseHistoryRepairYtDlp(info, videoId)
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }
  const timeoutSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)])
  if (!process.env.SUPPORTS_LOCAL_API || store.getters.getBackendPreference === 'invidious') {
    const info = await getInvidiousHistoryMetadata(videoId, timeoutSignal)
    if (info?.error || info?.videoId !== videoId) throw new HistoryRepairUnavailableError('Video metadata unavailable')
    return {
      ...info,
      published: info.published * 1000,
      isLive: info.liveNow,
    }
  }
  return parseHistoryRepairPlayer(await getLocalHistoryMetadata(videoId, timeoutSignal), videoId)
}

export async function startHistoryRepair({ useCookies = false } = {}) {
  if (historyRepairState.running) return
  controller = new AbortController()
  Object.assign(historyRepairState, { running: true, started: true, total: 0, checked: 0, repaired: 0, failed: 0, phase: 'checking', error: '' })
  try {
    await repairHistory({
      records: store.getters.getHistoryCacheSorted,
      getRecord: id => store.getters.getHistoryCacheById[id],
      fetchMetadata: (videoId, signal) => fetchMetadata(videoId, signal, useCookies),
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
