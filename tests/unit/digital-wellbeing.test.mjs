import assert from 'node:assert/strict'
import test from 'node:test'

import {
  dailyLimitStatus,
  isWithinDailyWindow,
} from '../../src/renderer/helpers/digitalWellbeing.js'

const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
}
const { default: wellbeing } = await import('../../src/renderer/store/modules/wellbeing.js')

test('daily windows can cross midnight and equal times describe none', () => {
  const start = 22 * 60
  const end = 6 * 60
  assert.equal(isWithinDailyWindow(23 * 60, start, end), true)
  assert.equal(isWithinDailyWindow(5 * 60 + 59, start, end), true)
  assert.equal(isWithinDailyWindow(6 * 60, start, end), false)
  assert.equal(isWithinDailyWindow(21 * 60 + 59, start, end), false)
  assert.equal(isWithinDailyWindow(14 * 60, 13 * 60, 15 * 60), true)
  assert.equal(isWithinDailyWindow(15 * 60, 13 * 60, 15 * 60), false)
  assert.equal(isWithinDailyWindow(60, 60, 60), false)
})

test('daily limits warn five minutes ahead, then stop until extended or ignored', () => {
  assert.equal(dailyLimitStatus(10_000, 0, 0, false), 'off')
  assert.equal(dailyLimitStatus(0, 60, 0, false), 'ok')
  assert.equal(dailyLimitStatus(55 * 60, 60, 0, false), 'warning')
  assert.equal(dailyLimitStatus(60 * 60, 60, 0, false), 'reached')
  assert.equal(dailyLimitStatus(60 * 60, 60, 15 * 60, false), 'ok')
  assert.equal(dailyLimitStatus(60 * 60, 60, 0, true), 'off')
  // A limit shorter than the warning time reaches it without a warning.
  assert.equal(dailyLimitStatus(4 * 60, 5, 0, false), 'ok')
})

function createContext(rootGetters) {
  const state = structuredClone(wellbeing.state)
  const dispatched = []
  const context = {
    state,
    rootGetters,
    commit: (type, payload) => wellbeing.mutations[type](state, payload),
    dispatch: (type, payload) => { dispatched.push([type, payload]) },
  }
  return { state, dispatched, context }
}

test('playback time counts toward limits and is only recorded when watch statistics are on', () => {
  const recording = createContext({ getRememberHistory: true, getEnableWatchStats: true })
  const date = recording.state.day.date
  wellbeing.actions.recordPlaybackTime(recording.context, { date, seconds: 30, isShort: true })
  assert.deepEqual(recording.dispatched, [['recordWatchTime', { date, seconds: 30 }]])
  assert.equal(recording.state.day.unrecordedSeconds, 0)
  assert.equal(recording.state.day.shortsSeconds, 30)
  assert.equal(recording.state.sessionSeconds, 30)

  const private_ = createContext({ getRememberHistory: true, getEnableWatchStats: false })
  wellbeing.actions.recordPlaybackTime(private_.context, { date, seconds: 45, isShort: false })
  assert.deepEqual(private_.dispatched, [])
  assert.equal(private_.state.day.unrecordedSeconds, 45)
  assert.equal(private_.state.day.shortsSeconds, 0)
})

test('only Shorts watched with statistics are saved, whatever the current setting', () => {
  storage.clear()
  const rootGetters = { getRememberHistory: true, getEnableWatchStats: true }
  const { state, context } = createContext(rootGetters)
  const date = state.day.date
  const saved = () => JSON.parse(storage.get('OpenTubeX/digitalWellbeing')).shortsSeconds
  wellbeing.actions.recordPlaybackTime(context, { date, seconds: 30, isShort: true })
  assert.equal(saved(), 30)

  rootGetters.getEnableWatchStats = false
  wellbeing.actions.recordPlaybackTime(context, { date, seconds: 1200, isShort: true })
  assert.equal(state.day.shortsSeconds, 1230)
  assert.equal(saved(), 30)

  rootGetters.getEnableWatchStats = true
  wellbeing.actions.recordPlaybackTime(context, { date, seconds: 15, isShort: true })
  assert.equal(saved(), 45)
})

test('time flushed after midnight starts a new day and late time does not count today', () => {
  const { state, context } = createContext({ getRememberHistory: false, getEnableWatchStats: false })
  state.day.date = '2026-11-01'
  state.day.extraSeconds.watch = 900
  wellbeing.actions.recordPlaybackTime(context, { date: '2026-11-02', seconds: 20, isShort: false })
  assert.equal(state.day.date, '2026-11-02')
  assert.equal(state.day.unrecordedSeconds, 20)
  assert.equal(state.day.extraSeconds.watch, 0)
  wellbeing.actions.recordPlaybackTime(context, { date: '2026-11-01', seconds: 10, isShort: false })
  assert.equal(state.day.unrecordedSeconds, 20)
})

test('only the pause action blocks playback, and the Shorts limit only blocks Shorts', () => {
  const state = structuredClone(wellbeing.state)
  state.status.shorts = 'reached'
  const block = action => wellbeing.getters.getWellbeingPlaybackBlock(state, {}, {}, { getDailyLimitAction: action })
  assert.equal(block('pause')(true), 'shorts')
  assert.equal(block('pause')(false), null)
  assert.equal(block('remind')(true), null)
  state.status.watch = 'reached'
  assert.equal(block('pause')(false), 'watch')
})
