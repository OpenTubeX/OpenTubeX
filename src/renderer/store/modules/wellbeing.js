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
  // Playback reports time only every few seconds, so starting it marks playback as active right away.
  lastPlayAt: 0,
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
 */
function persist(state) {
  const { date, shortsSeconds, unrecordedShortsSeconds, extraSeconds, ignored } = state.day
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      date,
      // Shorts watched without statistics stay private.
      shortsSeconds: shortsSeconds - unrecordedShortsSeconds,
      extraSeconds,
      ignored,
      bedtimeDismissedNight: state.bedtimeDismissedNight,
    }))
  } catch (error) {
    console.error('Failed to save digital wellbeing state', error)
  }
}

/**
 * Counts played time toward the day's limits.
 * @param {typeof state} state
 * @param {{ date: string, seconds: number, isShort: boolean, recorded: boolean }} playback
 */
function addDayPlayback(state, { date, seconds, isShort, recorded }) {
  // Time flushed after midnight can still belong to the previous day.
  if (date > state.day.date) state.day = createDay(date)
  if (date !== state.day.date) return
  if (!recorded) state.day.unrecordedSeconds += seconds
  if (isShort) state.day.shortsSeconds += seconds
  if (isShort && !recorded) state.day.unrecordedShortsSeconds += seconds
}

/**
 * Adopts the day of an open window. Its reply cannot include the time this
 * window played since asking, as messages from one window arrive in order.
 * @param {typeof state} state
 * @param {{ day: ReturnType<typeof createDay>, own: ReturnType<typeof createDay> }} days the open
 *   window's day, and the time this window played since asking
 */
function joinWellbeingDay(state, { day, own }) {
  if (day.date > state.day.date) state.day = createDay(day.date)
  if (day.date !== state.day.date) return
  const ownDay = own.date === day.date ? own : createDay(day.date)
  state.day.unrecordedSeconds = Math.max(state.day.unrecordedSeconds, day.unrecordedSeconds + ownDay.unrecordedSeconds)
  // Saving subtracts the unrecorded Shorts time, so both counts come from the same window
  const shortsSeconds = day.shortsSeconds + ownDay.shortsSeconds
  if (shortsSeconds >= state.day.shortsSeconds) {
    state.day.shortsSeconds = shortsSeconds
    state.day.unrecordedShortsSeconds = day.unrecordedShortsSeconds + ownDay.unrecordedShortsSeconds
  }
  for (const kind of ['watch', 'shorts']) {
    state.day.extraSeconds[kind] = Math.max(state.day.extraSeconds[kind], day.extraSeconds[kind])
    state.day.ignored[kind] ||= day.ignored[kind]
  }
}

// The limits count playback in every window, so windows share these changes.
// The break reminder counts each window's own session.
const SHARED_MUTATIONS = new Set(['addWellbeingPlayback', 'extendWellbeingLimit', 'setWellbeingBedtimeDismissed'])

/**
 * Store plugin that shares the limits' day and the bedtime dismissal with the
 * other windows. Time that watch statistics do not record stays in memory, so
 * the windows tell each other instead of saving it, and a new window asks the
 * open ones for their day.
 * @param {import('vuex').Store<any>} store
 * @param {BroadcastChannel | null} [channel]
 */
export function shareWellbeingAcrossWindows(store, channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('opentubex-digital-wellbeing')) {
  if (!channel) return
  const id = crypto.randomUUID()
  // The time this window played since asking for the open windows' day
  const own = { day: createDay(store.state.wellbeing.day.date) }
  store.subscribe(({ type, payload }, rootState) => {
    if (type === 'addWellbeingPlayback') addDayPlayback(own, payload)
    if (SHARED_MUTATIONS.has(type)) channel.postMessage({ type, payload, date: rootState.wellbeing.day.date })
  })
  channel.addEventListener('message', ({ data }) => {
    if (data?.type === 'requestWellbeingDay') {
      // The state is reactive, which messages cannot clone
      channel.postMessage({ type: 'wellbeingDay', to: data.id, payload: JSON.parse(JSON.stringify(store.state.wellbeing.day)) })
      return
    }
    if (data?.type === 'wellbeingDay') {
      // Open windows already counted what the reply holds
      if (data.to !== id) return
      store.commit('applySharedWellbeingChange', { type: data.type, payload: { day: data.payload, own: own.day } })
    } else {
      store.commit('applySharedWellbeingChange', data)
    }
    // Another window may have saved its total before it counted this change
    persist(store.state.wellbeing)
  })
  channel.postMessage({ type: 'requestWellbeingDay', id })
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
   * Resolves to `false` when the statistics failed to save, so the caller can retry with `retry` set.
   * @param {{ date: string, seconds: number, isShort: boolean, retry?: boolean }} payload
   */
  recordPlaybackTime({ commit, dispatch, state, rootGetters }, { date, seconds, isShort, retry = false }) {
    if (!Number.isFinite(seconds) || seconds <= 0) return

    const recorded = recordsWatchStats(rootGetters)
    // A retry only writes the statistics again; the limits counted this time when it was played.
    if (!retry) {
      commit('addWellbeingPlayback', { date, seconds, isShort, recorded, now: Date.now() })
      if (isShort) persist(state)
    }
    return recorded ? dispatch('recordWatchTime', { date, seconds }) : undefined
  },

  /** @param {string} date */
  startWellbeingDay({ commit, state }, date) {
    if (state.day.date === date) return
    commit('replaceWellbeingDay', createDay(date))
    persist(state)
  },

  /** @param {{ kind: LimitKind, extraSeconds?: number, ignore?: boolean }} payload */
  extendWellbeingLimit({ commit, state }, payload) {
    commit('extendWellbeingLimit', payload)
    persist(state)
  },

  /** @param {string} night */
  dismissBedtime({ commit, state }, night) {
    commit('setWellbeingBedtimeDismissed', night)
    persist(state)
  },

  clearWellbeingTime({ commit, state }) {
    commit('replaceWellbeingDay', { ...state.day, unrecordedSeconds: 0, shortsSeconds: 0, unrecordedShortsSeconds: 0 })
    commit('resetWellbeingSession')
    persist(state)
  },
}

const mutations = {
  addWellbeingPlayback(state, { date, seconds, isShort, recorded, now }) {
    if (now - state.lastPlaybackAt > BREAK_RESET_GAP_MS) state.sessionSeconds = 0
    state.sessionSeconds += seconds
    state.lastPlaybackAt = now
    addDayPlayback(state, { date, seconds, isShort, recorded })
  },

  /**
   * Applies a change another window made. The window that made it saved it.
   * @param {typeof state} state
   * @param {{ type: string, payload: any, date: string }} change
   */
  applySharedWellbeingChange(state, { type, payload, date }) {
    if (type === 'wellbeingDay') joinWellbeingDay(state, payload)
    else if (type === 'addWellbeingPlayback') addDayPlayback(state, payload)
    else if (type === 'extendWellbeingLimit' && date === state.day.date) {
      // Allowances only grow during a day, so a late message cannot take one back
      state.day.extraSeconds[payload.kind] = Math.max(state.day.extraSeconds[payload.kind], payload.extraSeconds ?? 0)
      state.day.ignored[payload.kind] ||= payload.ignore === true
    } else if (type === 'setWellbeingBedtimeDismissed' && !(payload <= state.bedtimeDismissedNight)) {
      mutations.setWellbeingBedtimeDismissed(state, payload)
    }
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

  markWellbeingPlay(state, now) {
    state.lastPlayAt = now
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
