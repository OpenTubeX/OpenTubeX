import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bedtimeNightKey,
  dailyLimitStatus,
  isWithinDailyWindow,
  parseTimeOfDay,
} from '../../src/renderer/helpers/digitalWellbeing.js'
import { createUploadNotificationConfiguration, isWithinQuietHours } from '../../src/newUploadNotifications.js'

const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
}
const { default: wellbeing } = await import('../../src/renderer/store/modules/wellbeing.js')

test('times of day parse to minutes and reject invalid values', () => {
  assert.equal(parseTimeOfDay('22:30'), 22 * 60 + 30)
  assert.equal(parseTimeOfDay('00:00'), 0)
  assert.equal(parseTimeOfDay('24:00'), null)
  assert.equal(parseTimeOfDay('7:00'), null)
  assert.equal(parseTimeOfDay(undefined), null)
})

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

test('a bedtime window after midnight belongs to the night it started', () => {
  const start = 22 * 60
  assert.equal(bedtimeNightKey(new Date(2026, 10, 1, 23, 0), start), '2026-11-01')
  assert.equal(bedtimeNightKey(new Date(2026, 10, 2, 1, 30), start), '2026-11-01')
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

test('quiet hours are only sent with enabled notifications and silence inside the window', () => {
  const quietHours = { start: 22 * 60, end: 6 * 60 }
  const subscriptions = [{ id: 'UC1', name: 'One', notificationFeedTypes: ['videos'] }]
  const configuration = createUploadNotificationConfiguration({
    enabled: true, subscriptions, showMembersOnly: false, titles: {}, quietHours,
  })
  assert.deepEqual(configuration.quietHours, quietHours)
  assert.deepEqual(createUploadNotificationConfiguration({
    enabled: false, subscriptions, showMembersOnly: false, titles: {}, quietHours,
  }), { enabled: false })
  assert.equal(isWithinQuietHours(quietHours, new Date(2026, 10, 1, 23, 0)), true)
  assert.equal(isWithinQuietHours(quietHours, new Date(2026, 10, 1, 12, 0)), false)
  assert.equal(isWithinQuietHours(undefined, new Date(2026, 10, 1, 23, 0)), false)
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

test('Shorts watched without statistics are never saved, even after statistics turn on', () => {
  storage.clear()
  const rootGetters = { getRememberHistory: true, getEnableWatchStats: false }
  const { state, context } = createContext(rootGetters)
  const date = state.day.date
  wellbeing.actions.recordPlaybackTime(context, { date, seconds: 1200, isShort: true })
  assert.equal(JSON.parse(storage.get('OpenTubeX/digitalWellbeing')).shortsSeconds, undefined)

  rootGetters.getEnableWatchStats = true
  wellbeing.actions.recordPlaybackTime(context, { date, seconds: 30, isShort: true })
  assert.equal(state.day.shortsSeconds, 1230)
  assert.equal(JSON.parse(storage.get('OpenTubeX/digitalWellbeing')).shortsSeconds, 30)
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

test('autoplay stops at bedtime and after the daily limit only when enabled', () => {
  const state = structuredClone(wellbeing.state)
  const stops = enabled => wellbeing.getters.getWellbeingStopsAutoplay(state, {}, {}, { getStopAutoplayAtBedtimeAndLimit: enabled })
  assert.equal(stops(true), false)
  state.status.bedtime = true
  assert.equal(stops(true), true)
  assert.equal(stops(false), false)
  state.status.bedtime = false
  state.status.watch = 'reached'
  assert.equal(stops(true), true)
  // The Shorts limit only blocks Shorts and leaves autoplay alone.
  state.status.watch = 'ok'
  state.status.shorts = 'reached'
  assert.equal(stops(true), false)
})
