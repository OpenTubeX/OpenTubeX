import assert from 'node:assert/strict'
import test from 'node:test'
import { bindNativeCaptionTiming } from '../../src/renderer/helpers/player/nativeCaptionTiming.js'

function fixture(offset = 0) {
  const video = new EventTarget()
  const cue = { startTime: 5, endTime: 7 }
  const track = Object.assign(new EventTarget(), { mode: 'hidden', kind: 'captions', cues: [cue] })
  const trackList = [track]
  video.textTracks = Object.assign(new EventTarget(), { [Symbol.iterator]: () => trackList.values() })
  let clears = 0
  let cueChanges = 0
  track.addEventListener('cuechange', () => cueChanges++)
  const binding = bindNativeCaptionTiming(video, () => offset, () => clears++)
  return { video, cue, track, trackList, binding, setOffset: value => { offset = value }, counts: () => ({ clears, cueChanges }) }
}

test('shifts native cues from their original times without accumulating offsets', () => {
  const f = fixture(-2)
  assert.deepEqual(f.cue, { startTime: 3, endTime: 5 })
  f.setOffset(3)
  f.binding.update()
  assert.deepEqual(f.cue, { startTime: 8, endTime: 10 })
  f.setOffset(0)
  f.binding.update()
  assert.deepEqual(f.cue, { startTime: 5, endTime: 7 })
  assert.deepEqual(f.counts(), { clears: 3, cueChanges: 3 })
  f.video.dispatchEvent(new Event('timeupdate'))
  assert.deepEqual(f.counts(), { clears: 3, cueChanges: 3 })
  f.binding.release()
})

test('shifts newly loaded cues and leaves metadata, disabled and MSE tracks alone', () => {
  const f = fixture(null)
  assert.deepEqual(f.cue, { startTime: 5, endTime: 7 })
  f.setOffset(-10)
  f.track.mode = 'disabled'
  f.binding.update()
  f.track.mode = 'hidden'
  f.track.kind = 'chapters'
  f.binding.update()
  assert.deepEqual(f.cue, { startTime: 5, endTime: 7 })
  f.track.kind = 'subtitles'
  f.video.textTracks.dispatchEvent(new Event('change'))
  assert.deepEqual(f.cue, { startTime: 0, endTime: 0 })
  const next = { startTime: 20, endTime: 22 }
  f.track.cues.push(next)
  f.video.dispatchEvent(new Event('load'))
  assert.deepEqual(next, { startTime: 10, endTime: 12 })
  f.binding.release()
  assert.deepEqual(f.cue, { startTime: 5, endTime: 7 })
  assert.deepEqual(next, { startTime: 20, endTime: 22 })
  f.setOffset(1)
  f.video.dispatchEvent(new Event('seeked'))
  f.video.textTracks.dispatchEvent(new Event('addtrack'))
  assert.deepEqual(next, { startTime: 20, endTime: 22 })
})

for (const offset of [10, -2.5]) {
  test(`adjusts and restores every cue in a live list with offset ${offset}`, () => {
    const f = fixture(null)
    const cues = [1, 2, 3].map(start => {
      let currentStart = start
      return {
        get startTime() { return currentStart },
        set startTime(value) {
          currentStart = value
          f.track.cues.sort((a, b) => a.startTime - b.startTime)
        },
        endTime: start + 1
      }
    })
    f.track.cues = cues.slice()
    f.setOffset(offset)
    f.binding.update()
    assert.deepEqual(cues.map(cue => [cue.startTime, cue.endTime]), [1, 2, 3].map(start => [Math.max(0, start + offset), Math.max(0, start + 1 + offset)]))
    f.binding.release()
    assert.deepEqual(cues.map(cue => [cue.startTime, cue.endTime]), [[1, 2], [2, 3], [3, 4]])
  })
}
