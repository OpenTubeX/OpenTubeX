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
 * The time one window played today. `seq` grows with each change, so a window
 * keeps the newest counts it hears of, whatever order messages arrive in.
 * @typedef {{ seq: number, unrecordedSeconds: number, shortsSeconds: number, unrecordedShortsSeconds: number }} WindowTime
 */

/**
 * @param {number} seq
 * @param {number} [shortsSeconds]
 * @returns {WindowTime}
 */
function createWindowTime(seq, shortsSeconds = 0) {
  return { seq, unrecordedSeconds: 0, shortsSeconds, unrecordedShortsSeconds: 0 }
}

/**
 * @param {Record<string, any>} saved
 * @returns {Record<string, WindowTime>}
 */
function loadSavedWindows(saved) {
  // Versions before 0.38 saved one total
  if (Number.isFinite(saved.shortsSeconds)) return { earlier: createWindowTime(0, saved.shortsSeconds) }
  // Saved time lacks the unrecorded time, so any count from an open window replaces it
  return Object.fromEntries(Object.entries(saved.windows ?? {})
    .filter(([, seconds]) => Number.isFinite(seconds))
    .map(([id, seconds]) => [id, createWindowTime(0, seconds)]))
}

/**
 * The day's totals over its windows.
 * @param {ReturnType<typeof createDay>} day
 */
function sumWindows(day) {
  const times = Object.values(day.windows)
  // Time that watch statistics did not record, kept only in memory.
  day.unrecordedSeconds = times.reduce((sum, time) => sum + time.unrecordedSeconds, 0)
  day.shortsSeconds = times.reduce((sum, time) => sum + time.shortsSeconds, 0)
  // Never saved, so Shorts watched without statistics stay private.
  day.unrecordedShortsSeconds = times.reduce((sum, time) => sum + time.unrecordedShortsSeconds, 0)
}

/**
 * @param {string} date
 * @param {Record<string, any>} saved
 */
function createDay(date, saved = {}) {
  const sameDay = saved.date === date
  const day = {
    date,
    /** @type {Record<string, WindowTime>} the time each window played, by window ID */
    windows: sameDay ? loadSavedWindows(saved) : {},
    unrecordedSeconds: 0,
    shortsSeconds: 0,
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
  sumWindows(day)
  return day
}

const saved = loadSaved()

const state = {
  // Identifies this window's time to the other windows
  windowId: crypto.randomUUID(),
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
  const { date, windows, extraSeconds, ignored } = state.day
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      date,
      // Saved by window, so a window that opens later does not count an open window's time twice.
      // Shorts watched without statistics stay private.
      windows: Object.fromEntries(Object.entries(windows)
        .map(([id, time]) => [id, time.shortsSeconds - time.unrecordedShortsSeconds])
        .filter(([, seconds]) => seconds > 0)),
      extraSeconds,
      ignored,
      bedtimeDismissedNight: state.bedtimeDismissedNight,
    }))
  } catch (error) {
    console.error('Failed to save digital wellbeing state', error)
  }
}

/**
 * Counts time this window played toward the day's limits.
 * @param {typeof state} state
 * @param {{ date: string, seconds: number, isShort: boolean, recorded: boolean }} playback
 */
function addDayPlayback(state, { date, seconds, isShort, recorded }) {
  // Time flushed after midnight can still belong to the previous day.
  if (date > state.day.date) state.day = createDay(date)
  if (date !== state.day.date) return
  const time = state.day.windows[state.windowId] ??= createWindowTime(0)
  time.seq++
  if (!recorded) time.unrecordedSeconds += seconds
  if (isShort) time.shortsSeconds += seconds
  if (isShort && !recorded) time.unrecordedShortsSeconds += seconds
  sumWindows(state.day)
}

/**
 * Takes the newer time of each window that another window shares, so time
 * that a reply and a later message both hold counts once.
 * @param {typeof state} state
 * @param {Pick<ReturnType<typeof createDay>, 'date' | 'windows'> & Partial<ReturnType<typeof createDay>>} day
 */
function joinWellbeingDay(state, day) {
  if (day.date > state.day.date) state.day = createDay(day.date)
  if (day.date !== state.day.date) return
  for (const [id, time] of Object.entries(day.windows)) {
    // This window's own time is always current
    if (id !== state.windowId && !(time.seq <= state.day.windows[id]?.seq)) state.day.windows[id] = { ...time }
  }
  sumWindows(state.day)
  for (const kind of day.extraSeconds ? ['watch', 'shorts'] : []) {
    state.day.extraSeconds[kind] = Math.max(state.day.extraSeconds[kind], day.extraSeconds[kind])
    state.day.ignored[kind] ||= day.ignored[kind]
  }
}

// The limits count playback in every window, so windows share these changes.
// The break reminder counts each window's own session.
const SHARED_MUTATIONS = new Set(['extendWellbeingLimit', 'setWellbeingBedtimeDismissed'])
// Changes to this window's time, which it shares as its current counts
const TIME_MUTATIONS = new Set(['addWellbeingPlayback', 'clearWellbeingTime'])

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
  const { windowId } = store.state.wellbeing
  // Replies to a request from before the time was cleared would bring it back
  let requestId = windowId
  // The state is reactive, which messages cannot clone
  const clone = value => JSON.parse(JSON.stringify(value))
  store.subscribe(({ type, payload }, { wellbeing: { day } }) => {
    if (type === 'clearWellbeingTime') requestId = crypto.randomUUID()
    if (TIME_MUTATIONS.has(type) && day.windows[windowId]) {
      channel.postMessage({ type: 'wellbeingDay', payload: { date: day.date, windows: { [windowId]: clone(day.windows[windowId]) } } })
    }
    if (SHARED_MUTATIONS.has(type)) channel.postMessage({ type, payload, date: day.date })
  })
  channel.addEventListener('message', ({ data }) => {
    if (data?.type === 'requestWellbeingDay') {
      channel.postMessage({ type: 'wellbeingDay', to: data.id, payload: clone(store.state.wellbeing.day) })
      return
    }
    // Replies go to the window that asked
    if (data?.to != null && data.to !== requestId) return
    store.commit('applySharedWellbeingChange', data)
    // Another window may have saved its time before it counted this change
    persist(store.state.wellbeing)
  })
  channel.postMessage({ type: 'requestWellbeingDay', id: requestId })
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
    commit('clearWellbeingTime')
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
    else if (type === 'extendWellbeingLimit' && date === state.day.date) {
      // Allowances only grow during a day, so a late message cannot take one back
      state.day.extraSeconds[payload.kind] = Math.max(state.day.extraSeconds[payload.kind], payload.extraSeconds ?? 0)
      state.day.ignored[payload.kind] ||= payload.ignore === true
    } else if (type === 'setWellbeingBedtimeDismissed' && !(payload <= state.bedtimeDismissedNight)) {
      mutations.setWellbeingBedtimeDismissed(state, payload)
      // The reminder was dismissed in another window
      if (state.prompt === 'bedtime') state.prompt = null
    }
  },

  replaceWellbeingDay(state, day) {
    state.day = day
  },

  /**
   * Every window clears the time when the watch statistics are cleared. The other
   * windows' time keeps its sequence, so an older copy cannot replace it, and an open
   * window's message from before it cleared cannot outlast the cleared time it shares next.
   * @param {typeof state} state
   */
  clearWellbeingTime(state) {
    for (const [id, { seq }] of Object.entries(state.day.windows)) {
      state.day.windows[id] = createWindowTime(id === state.windowId ? seq + 1 : seq)
    }
    sumWindows(state.day)
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
