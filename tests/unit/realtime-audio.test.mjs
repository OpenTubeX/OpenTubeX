import assert from 'node:assert/strict'
import test from 'node:test'

import { createRealtimeAudio } from '../../src/main/realtimeAudio.js'

const RENDERER = 100
const AUDIO_SERVICE = 200

function createFakes() {
  const calls = []
  const threads = new Map([
    [RENDERER, new Map([[101, 'electron'], [102, 'AudioOutputDevi'], [103, 'Media'], [104, 'Compositor']])],
    [AUDIO_SERVICE, new Map([[201, 'electron'], [202, 'threaded-ml']])],
  ])
  const properties = { MaxRealtimePriority: 5, MinNiceLevel: -15, RTTimeUSecMax: 200_000 }
  const realtimeAudio = createRealtimeAudio({
    getAudioServicePids: () => [AUDIO_SERVICE],
    connect: () => ({
      call: async (member, signature, body) => { calls.push([member, ...body]) },
      getProperty: async name => properties[name],
      close () {},
    }),
    setRealtimeTimeLimit: async (pid, microseconds) => { calls.push(['prlimit', pid, microseconds]) },
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
  assert.deepEqual(calls.sort(), [
    ['MakeThreadHighPriorityWithPID', RENDERER, 103, -10],
    // Capped at RealtimeKit's maximum, below Chromium's own priority of 8
    ['MakeThreadRealtimeWithPID', AUDIO_SERVICE, 202, 5],
    ['MakeThreadRealtimeWithPID', RENDERER, 102, 5],
    ['prlimit', AUDIO_SERVICE, 200_000],
    ['prlimit', RENDERER, 200_000],
  ].sort())

  // The next video's output thread is raised, the others aren't raised again.
  calls.length = 0
  threads.get(RENDERER).delete(102)
  threads.get(RENDERER).set(105, 'AudioOutputDevi')
  await realtimeAudio.setAudible(RENDERER, true)
  assert.deepEqual(calls, [['MakeThreadRealtimeWithPID', RENDERER, 105, 5]])

  realtimeAudio.setAudible(RENDERER, false)
  realtimeAudio.setAudible(RENDERER, false)
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
    setRealtimeTimeLimit: async () => assert.fail('Set a CPU time limit without RealtimeKit'),
    readThreads: async () => new Map([[102, 'AudioOutputDevi']]),
  })

  await realtimeAudio.setAudible(RENDERER, true)
  await realtimeAudio.setAudible(RENDERER, true)
  assert.equal(connections, 1)
})
