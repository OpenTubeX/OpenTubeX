import assert from 'node:assert/strict'
import test from 'node:test'

import { createRealtimeAudio } from '../../src/main/realtimeAudio.js'

const RENDERER = 100
const AUDIO_SERVICE = 200

function createFakes({ refusals = 0, allowRealtime = true } = {}) {
  const calls = []
  const threads = new Map([
    [RENDERER, new Map([[101, 'electron'], [102, 'AudioOutputDevi'], [103, 'Media'], [104, 'Compositor']])],
    [AUDIO_SERVICE, new Map([[201, 'electron'], [202, 'threaded-ml']])],
  ])
  const properties = { MaxRealtimePriority: 5, MinNiceLevel: -15, RTTimeUSecMax: 200_000 }
  const realtimeAudio = createRealtimeAudio({
    getAudioServicePids: () => [AUDIO_SERVICE],
    connect: () => ({
      call: async (member, signature, body) => {
        if (refusals > 0) {
          refusals--
          throw new Error('Operation not permitted')
        }
        calls.push([member, ...body])
      },
      getProperty: async name => properties[name],
      close () {},
    }),
    limitRealtimeTime: async (pid, maximum) => {
      calls.push(['prlimit', pid, maximum])
      return allowRealtime
    },
    readThreads: async (pid) => {
      if (!threads.has(pid)) throw new Error('No such process')
      return threads.get(pid)
    },
  })
  return { calls, threads, realtimeAudio }
}

test('audible renderers get realtime audio threads once, after a CPU time limit', async () => {
  const { calls, threads, realtimeAudio } = createFakes()

  await realtimeAudio.setAudible(RENDERER, true)
  // Renderer and audio service requests can interleave, but each process gets its limit first.
  const callsFor = pid => calls.filter(call => call[1] === pid)
  assert.deepEqual(callsFor(RENDERER), [
    ['prlimit', RENDERER, 200_000],
    // Capped at RealtimeKit's maximum, below Chromium's own priority of 8
    ['MakeThreadRealtimeWithPID', RENDERER, 102, 5],
    ['MakeThreadHighPriorityWithPID', RENDERER, 103, -10],
  ])
  assert.deepEqual(callsFor(AUDIO_SERVICE), [
    ['prlimit', AUDIO_SERVICE, 200_000],
    ['MakeThreadRealtimeWithPID', AUDIO_SERVICE, 202, 5],
  ])

  // The next video's output thread is raised, the others aren't raised again.
  calls.length = 0
  threads.get(RENDERER).delete(102)
  threads.get(RENDERER).set(105, 'AudioOutputDevi')
  await realtimeAudio.setAudible(RENDERER, true)
  assert.deepEqual(calls, [['MakeThreadRealtimeWithPID', RENDERER, 105, 5]])

  realtimeAudio.setAudible(RENDERER, false)
  realtimeAudio.setAudible(RENDERER, false)
})

test('a refused thread is retried on later scans, a low inherited time limit keeps it normal', async (t) => {
  t.mock.method(console, 'warn', () => {})
  // RealtimeKit refuses bursts of requests for a while
  const refused = createFakes({ refusals: 1 })
  await refused.realtimeAudio.setAudible(AUDIO_SERVICE + 1, true)
  assert.deepEqual(refused.calls.filter(call => call[0] !== 'prlimit'), [])
  await refused.realtimeAudio.setAudible(AUDIO_SERVICE + 1, true)
  assert.deepEqual(refused.calls.filter(call => call[0] !== 'prlimit'), [['MakeThreadRealtimeWithPID', AUDIO_SERVICE, 202, 5]])
  refused.realtimeAudio.setAudible(AUDIO_SERVICE + 1, false)
  refused.realtimeAudio.setAudible(AUDIO_SERVICE + 1, false)

  const limited = createFakes({ allowRealtime: false })
  await limited.realtimeAudio.setAudible(RENDERER, true)
  await limited.realtimeAudio.setAudible(RENDERER, true)
  assert.deepEqual(limited.calls.filter(call => call[0] !== 'prlimit'), [['MakeThreadHighPriorityWithPID', RENDERER, 103, -10]])
  limited.realtimeAudio.setAudible(RENDERER, false)
  limited.realtimeAudio.setAudible(RENDERER, false)
})

test('without RealtimeKit, audio threads keep their priority', async (t) => {
  t.mock.method(console, 'warn', () => {})
  let connections = 0
  const realtimeAudio = createRealtimeAudio({
    getAudioServicePids: () => [AUDIO_SERVICE],
    connect: () => {
      connections++
      throw new Error('No system bus')
    },
    limitRealtimeTime: async () => assert.fail('Set a CPU time limit without RealtimeKit'),
    readThreads: async () => new Map([[102, 'AudioOutputDevi']]),
  })

  await realtimeAudio.setAudible(RENDERER, true)
  await realtimeAudio.setAudible(RENDERER, true)
  assert.equal(connections, 1)
})
