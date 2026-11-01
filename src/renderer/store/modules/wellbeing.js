import { BREAK_RESET_GAP_MS, localDateKey } from '../../helpers/digitalWellbeing.js'

const STORAGE_KEY = 'OpenTubeX/digitalWellbeing'

/** @typedef {'watch' | 'shorts'} LimitKind */
/** @typedef {LimitKind | 'break' | 'bedtime'} WellbeingPrompt */

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

/**
 * @param {string} date
 * @param {Record<string, any>} saved
 */
function createDay(date, saved = {}) {
  const sameDay = saved.date === date
  return {
    date,
    // Time that watch statistics did not record, kept only in memory.
    unrecordedSeconds: 0,
    shortsSeconds: sameDay && Number.isFinite(saved.shortsSeconds) ? saved.shortsSeconds : 0,
    // Never saved, so Shorts watched without statistics stay private.
    unrecordedShortsSeconds: 0,
    extraSeconds: {
      watch: sameDay ? saved.extraSeconds?.watch ?? 0 : 0,
      shorts: sameDay ? saved.extraSeconds?.shorts ?? 0 : 0,
    },
    ignored: {
      watch: sameDay && saved.ignored?.watch === true,
      shorts: sameDay && saved.ignored?.shorts === true,
    },
  }
}

const saved = loadSaved()

const state = {
  day: createDay(localDateKey(Date.now()), saved),
  bedtimeDismissedNight: typeof saved.bedtimeDismissedNight === 'string' ? saved.bedtimeDismissedNight : null,
  bedtimeSnoozedUntil: 0,
  // Played seconds since the last break reminder or a long pause.
  sessionSeconds: 0,
  lastPlaybackAt: 0,
  /** @type {{ id: number, shortsOnly: boolean } | null} */
  pauseRequest: null,
  /** @type {WellbeingPrompt | null} */
  prompt: null,
  status: {
    /** @type {'off' | 'ok' | 'warning' | 'reached'} */
    watch: 'off',
    /** @type {'off' | 'ok' | 'warning' | 'reached'} */
    shorts: 'off',
    bedtime: false,
    // Bedtime started during a video that the reminder waits for.
    bedtimeWaiting: false,
  },
}

/**
 * @param {typeof state} state
 * @param {boolean} saveShortsTime
 */
function persist(state, saveShortsTime) {
  const { date, shortsSeconds, unrecordedShortsSeconds, extraSeconds, ignored } = state.day
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      date,
      ...(saveShortsTime ? { shortsSeconds: shortsSeconds - unrecordedShortsSeconds } : {}),
      extraSeconds,
      ignored,
      bedtimeDismissedNight: state.bedtimeDismissedNight,
    }))
  } catch (error) {
    console.error('Failed to save digital wellbeing state', error)
  }
}

function recordsWatchStats(rootGetters) {
  return rootGetters.getRememberHistory && rootGetters.getEnableWatchStats
}

const getters = {
  getWellbeing(state) {
    return state
  },

  getWellbeingPauseRequest(state) {
    return state.pauseRequest
  },

  /**
   * The limit that stops playback from starting, if any.
   * @returns {(isShort: boolean) => LimitKind | null}
   */
  getWellbeingPlaybackBlock(state, _getters, _rootState, rootGetters) {
    return isShort => {
      if (rootGetters.getDailyLimitAction !== 'pause') return null
      if (state.status.watch === 'reached') return 'watch'
      if (isShort && state.status.shorts === 'reached') return 'shorts'
      return null
    }
  },

  getWellbeingStopsAutoplay(state, _getters, _rootState, rootGetters) {
    return rootGetters.getStopAutoplayAtBedtimeAndLimit && (state.status.bedtime || state.status.watch === 'reached')
  },

  getWellbeingBedtimeWaiting(state) {
    return state.status.bedtimeWaiting
  },
}

const actions = {
  /**
   * Counts played time for the limits and records it in the watch statistics when they are enabled.
   * @param {{ date: string, seconds: number, isShort: boolean }} payload
   */
  recordPlaybackTime({ commit, dispatch, state, rootGetters }, { date, seconds, isShort }) {
    if (!Number.isFinite(seconds) || seconds <= 0) return

    const recorded = recordsWatchStats(rootGetters)
    commit('addWellbeingPlayback', { date, seconds, isShort, recorded, now: Date.now() })
    if (isShort) persist(state, recorded)
    return recorded ? dispatch('recordWatchTime', { date, seconds }) : undefined
  },

  /** @param {string} date */
  startWellbeingDay({ commit, state, rootGetters }, date) {
    if (state.day.date === date) return
    commit('replaceWellbeingDay', createDay(date))
    persist(state, recordsWatchStats(rootGetters))
  },

  /** @param {{ kind: LimitKind, extraSeconds?: number, ignore?: boolean }} payload */
  extendWellbeingLimit({ commit, state, rootGetters }, payload) {
    commit('extendWellbeingLimit', payload)
    persist(state, recordsWatchStats(rootGetters))
  },

  /** @param {string} night */
  dismissBedtime({ commit, state, rootGetters }, night) {
    commit('setWellbeingBedtimeDismissed', night)
    persist(state, recordsWatchStats(rootGetters))
  },

  clearWellbeingTime({ commit, state }) {
    commit('replaceWellbeingDay', { ...state.day, unrecordedSeconds: 0, shortsSeconds: 0, unrecordedShortsSeconds: 0 })
    commit('resetWellbeingSession')
    persist(state, false)
  },
}

const mutations = {
  addWellbeingPlayback(state, { date, seconds, isShort, recorded, now }) {
    if (now - state.lastPlaybackAt > BREAK_RESET_GAP_MS) state.sessionSeconds = 0
    state.sessionSeconds += seconds
    state.lastPlaybackAt = now

    // Time flushed after midnight can still belong to the previous day.
    if (date > state.day.date) state.day = createDay(date)
    if (date !== state.day.date) return
    if (!recorded) state.day.unrecordedSeconds += seconds
    if (isShort) state.day.shortsSeconds += seconds
    if (isShort && !recorded) state.day.unrecordedShortsSeconds += seconds
  },

  replaceWellbeingDay(state, day) {
    state.day = day
  },

  extendWellbeingLimit(state, { kind, extraSeconds = 0, ignore = false }) {
    state.day.extraSeconds[kind] = extraSeconds
    state.day.ignored[kind] = ignore
  },

  setWellbeingBedtimeDismissed(state, night) {
    state.bedtimeDismissedNight = night
    state.bedtimeSnoozedUntil = 0
  },

  snoozeWellbeingBedtime(state, until) {
    state.bedtimeSnoozedUntil = until
  },

  resetWellbeingSession(state) {
    state.sessionSeconds = 0
  },

  requestWellbeingPause(state, { shortsOnly = false } = {}) {
    state.pauseRequest = { id: (state.pauseRequest?.id ?? 0) + 1, shortsOnly }
  },

  /**
   * @param {typeof state} state
   * @param {WellbeingPrompt | null} prompt
   */
  showWellbeingPrompt(state, prompt) {
    if (prompt === null || state.prompt === null) state.prompt = prompt
  },

  updateWellbeingStatus(state, status) {
    state.status = status
  },
}

export default {
  state,
  getters,
  actions,
  mutations,
}
