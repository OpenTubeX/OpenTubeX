import assert from 'node:assert/strict'
import test from 'node:test'
import { createStore } from 'vuex'

import {
  dailyLimitStatus,
  isWithinDailyWindow,
} from '../../src/renderer/helpers/digitalWellbeing.js'

const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
}
const { default: wellbeing, shareWellbeingAcrossWindows } = await import('../../src/renderer/store/modules/wellbeing.js')

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
  wellbeing.actions.recordPlaybackTime(recording.context, { date, seconds: 30, isShort: true, retry: true })
  assert.deepEqual(recording.dispatched[1], ['recordWatchTime', { date, seconds: 30 }], 'A retry writes the statistics again')
  assert.equal(recording.state.day.shortsSeconds, 30, 'A retry does not count toward the limits again')
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

test('windows share the time and choices that limits count, but not the break session', async () => {
  const channels = [new EventTarget(), new EventTarget()]
  channels.forEach((channel, index) => {
    channel.postMessage = data => channels[1 - index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) }))
  })
  const [first, second] = channels.map(channel => {
    const store = createStore({
      modules: { wellbeing: { ...wellbeing, state: () => structuredClone(wellbeing.state) } },
      // Without watch statistics, played time is only counted in memory
      getters: { getRememberHistory: () => true, getEnableWatchStats: () => false },
    })
    shareWellbeingAcrossWindows(store, channel)
    return store
  })
  const date = first.state.wellbeing.day.date

  await first.dispatch('recordPlaybackTime', { date, seconds: 30, isShort: true })
  await second.dispatch('recordPlaybackTime', { date, seconds: 20, isShort: false })
  await first.dispatch('extendWellbeingLimit', { kind: 'shorts', ignore: true })
  await second.dispatch('dismissBedtime', date)

  for (const { state: { wellbeing: state } } of [first, second]) {
    assert.equal(state.day.unrecordedSeconds, 50)
    assert.equal(state.day.shortsSeconds, 30)
    assert.equal(state.day.ignored.shorts, true)
    assert.equal(state.bedtimeDismissedNight, date)
  }
  assert.deepEqual([first.state.wellbeing.sessionSeconds, second.state.wellbeing.sessionSeconds], [30, 20])
})

test('a window opened later starts from the open windows\' day, and saved Shorts time counts both', async () => {
  const channels = []
  let pending = 0
  // Messages arrive after the sender continues, as across processes
  const connect = () => {
    const channel = new EventTarget()
    channel.postMessage = data => channels.filter(other => other !== channel).forEach(other => {
      pending++
      setTimeout(() => {
        other.dispatchEvent(new MessageEvent('message', { data: structuredClone(data) }))
        pending--
      })
    })
    channels.push(channel)
    return channel
  }
  const open = () => {
    const store = createStore({
      modules: { wellbeing: { ...wellbeing, state: () => structuredClone(wellbeing.state) } },
      getters: { getRememberHistory: () => true, getEnableWatchStats: () => true },
      actions: { recordWatchTime() {} },
    })
    shareWellbeingAcrossWindows(store, connect())
    return store
  }
  const settle = async () => {
    while (pending > 0) await new Promise(resolve => setTimeout(resolve))
  }
  const [first, second] = [open(), open()]
  await settle()
  const date = first.state.wellbeing.day.date

  await first.dispatch('recordPlaybackTime', { date, seconds: 10, isShort: true })
  await second.dispatch('recordPlaybackTime', { date, seconds: 10, isShort: true })
  await settle()
  assert.equal(JSON.parse(localStorage.getItem('OpenTubeX/digitalWellbeing')).shortsSeconds, 20)

  // It plays before the open windows' day arrives
  const third = open()
  await third.dispatch('recordPlaybackTime', { date, seconds: 5, isShort: true })
  await settle()
  assert.deepEqual([first, second, third].map(store => store.state.wellbeing.day.shortsSeconds), [25, 25, 25])
})
