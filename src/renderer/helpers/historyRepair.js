import { computed, reactive, ref } from 'vue'
import store from '../store'
import { HistoryRepairUnavailableError, parseHistoryRepairPlayer, parseHistoryRepairYtDlp, repairHistory } from '../../historyRepair'
import { ytDlp } from './ytDlp'
import { getLocalHistoryMetadata } from './api/local'
import { getInvidiousHistoryMetadata } from './api/invidious'

export const metadataRepairBusy = ref(false)

const initialRepairState = {
  running: false, total: 0, checked: 0, repaired: 0, failed: 0, started: false, phase: 'checking', error: ''
}

export function createRepairState() {
  return reactive({ ...initialRepairState })
}

export const historyRepairState = createRepairState()

export const repairCookiesConfigured = computed(() => {
  if (!process.env.IS_ELECTRON && !process.env.IS_CAPACITOR) return false
  const getters = store.getters
  return getters.getYtDlpPlaybackAuthMode === 'file'
    ? !!getters.getYtDlpPlaybackCookiesPath?.trim()
    : process.env.IS_ELECTRON && getters.getYtDlpPlaybackAuthMode === 'browser' && !!getters.getYtDlpPlaybackCookiesBrowser?.trim()
})

let controller

export function cancelMetadataRepair() {
  controller?.abort()
  if (process.env.IS_ELECTRON) ytDlp.ytDlpCancelHistoryRepair().catch(console.error)
}

export async function fetchRepairMetadata(videoId, signal, useCookies) {
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

export async function runMetadataRepair(state, { useCookies = false, ...options }) {
  if (metadataRepairBusy.value) return
  metadataRepairBusy.value = true
  controller = new AbortController()
  Object.assign(state, { ...initialRepairState, running: true, started: true })
  try {
    await repairHistory({
      ...options,
      fetchMetadata: (videoId, signal) => fetchRepairMetadata(videoId, signal, useCookies),
      signal: controller.signal,
      onProgress: progress => Object.assign(state, progress),
      onPhase: phase => { state.phase = phase },
    })
    state.phase = controller.signal.aborted ? 'stopped' : 'finished'
  } catch (error) {
    state.phase = 'stopped'
    state.error = error.message || String(error)
  } finally {
    state.running = false
    controller = null
    metadataRepairBusy.value = false
  }
}

export const cancelHistoryRepair = cancelMetadataRepair

export function startHistoryRepair({ useCookies = false } = {}) {
  return runMetadataRepair(historyRepairState, {
    useCookies,
    records: store.getters.getHistoryCacheSorted,
    getRecord: (videoId, id) => {
      const indexed = store.getters.getHistoryCacheByRecordId[id]
      // Object indexes coerce legacy numeric/boolean IDs to string keys.
      const record = id == null
        ? store.getters.getHistoryCacheById[videoId]
        : indexed?._id === id ? indexed : store.getters.getHistoryCacheSorted.find(record => record._id === id)
      return record?.videoId === videoId ? record : undefined
    },
    saveMetadata: metadata => store.dispatch('updateSubscriptionHistory', { metadata }),
  })
}
