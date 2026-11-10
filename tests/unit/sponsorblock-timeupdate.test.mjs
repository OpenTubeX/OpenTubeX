import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/opentubex/useSponsorBlockPlayback.js', import.meta.url), 'utf8')

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start !== -1 && end !== -1, `missing ${startMarker}`)
  return source.slice(start, end)
}

const isSponsorBlockPointSegment = segment => segment.startTime === segment.endTime

function setupScheduler() {
  const tasks = []
  const video = { currentTime: 10, paused: false, ended: false, playbackRate: 1 }
  const context = vm.createContext({
    AbortController,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    window: {
      scheduler: {
        postTask(callback, { delay, signal }) {
          const task = { callback, delay, signal }
          tasks.push(task)
          return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason))
          })
        },
      },
    },
    SPONSORBLOCK_SKIP_SCHEDULE_LEAD_MS: 500,
    SPONSORBLOCK_SKIP_POLL_INTERVAL_MS: 4,
    isSponsorBlockPointSegment,
    sponsorSkips: { value: { autoSkip: new Set(['sponsor']) } },
    sponsorBlockSegments: [{ uuid: 'a', category: 'sponsor', actionType: 'skip', startTime: 30, endTime: 40 }],
    getSegments: () => context.sponsorBlockSegments,
    sponsorBlockDoNotSkipSegments: new Map(),
    useSponsorBlock: { value: true },
    props: { sponsorBlockAutoSkipDisabled: false },
    video: { value: video },
    canSeek: () => true,
    skipSponsorBlockSegments() {},
  })
  vm.runInContext(`${slice('  let sponsorBlockSkipScheduleTimeout = null', '  function clearSponsorBlockNotFoundRefetchTimeout()')}
${slice('  function getNextSponsorBlockAutoSkipSegment(', '  function syncSponsorBlockMuteSegments(')}`, context)
  const active = () => tasks.filter(task => !task.signal.aborted)
  return { context, tasks, video, active }
}

test('timeupdates keep the pending skip task while the next boundary is unchanged', () => {
  const { context, tasks, video, active } = setupScheduler()
  context.scheduleSponsorBlockSkip()
  for (const time of [10.25, 10.5, 10.75, 11]) {
    video.currentTime = time
    context.scheduleSponsorBlockSkip()
  }
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].delay, 19500)
  assert.equal(active().length, 1)
})

test('a rate change, seek or new next segment reschedules the skip', () => {
  const { context, tasks, video, active } = setupScheduler()
  context.scheduleSponsorBlockSkip()

  video.playbackRate = 2
  context.scheduleSponsorBlockSkip()
  assert.equal(tasks.length, 2)
  assert.equal(tasks[1].delay, 9500)

  // handleSeeking cancels the schedule before the position changes.
  context.cancelSponsorBlockSkipSchedule()
  video.currentTime = 20
  context.scheduleSponsorBlockSkip()
  assert.equal(tasks.length, 3)
  assert.equal(tasks[2].delay, 4500)

  context.sponsorBlockSegments.unshift({ uuid: 'b', category: 'sponsor', actionType: 'skip', startTime: 25, endTime: 26 })
  context.scheduleSponsorBlockSkip()
  assert.equal(tasks.length, 4)
  assert.equal(tasks[3].delay, 2000)
  assert.equal(active().length, 1)

  video.paused = true
  context.scheduleSponsorBlockSkip()
  assert.equal(active().length, 0)
})

test('a task that wakes before the boundary schedules it again', () => {
  const { context, tasks, video, active } = setupScheduler()
  context.scheduleSponsorBlockSkip()
  // Playback stalled, so the timer fires while the boundary is still far away.
  tasks[0].callback()
  assert.equal(tasks.length, 2, 'polling starts with a short check')
  tasks[1].callback()
  assert.equal(tasks.length, 3)
  assert.equal(tasks[2].delay, 19500)
  assert.equal(active().length, 1)

  video.currentTime = 10.25
  context.scheduleSponsorBlockSkip()
  assert.equal(tasks.length, 3)
})
