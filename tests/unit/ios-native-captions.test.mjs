import assert from 'node:assert/strict'
import test from 'node:test'
import { bindIosNativeCaptions } from '../../src/renderer/helpers/player/iosNativeCaptions.js'

function fixture (mode = 'hidden') {
  const video = new EventTarget()
  video.paused = true
  const track = Object.assign(new EventTarget(), { kind: 'captions', mode, activeCues: [{ text: 'First caption' }] })
  const tracks = [track]
  video.textTracks = Object.assign(new EventTarget(), {
    [Symbol.iterator]: () => tracks[Symbol.iterator]()
  })
  const rendered = []
  track.addEventListener('cuechange', () => rendered.push(track.activeCues.map(cue => cue.text)))
  const cleanup = bindIosNativeCaptions(video)
  const tick = () => video.dispatchEvent(new Event('timeupdate'))
  return { video, track, tracks, rendered, cleanup, tick }
}

test('renders native cues when WebKit omits cuechange, without repeating unchanged cues', () => {
  const f = fixture()
  f.tick()
  f.tick()
  assert.deepEqual(f.rendered, [['First caption']])
  f.track.activeCues = [{ text: 'Second caption' }]
  f.video.dispatchEvent(new Event('seeked'))
  f.tick()
  assert.deepEqual(f.rendered, [['First caption'], ['Second caption']])
  f.track.activeCues = []
  f.tick()
  assert.deepEqual(f.rendered.at(-1), [])
  f.cleanup()
  f.track.activeCues = [{ text: 'After teardown' }]
  f.tick()
  f.video.dispatchEvent(new Event('seeked'))
  assert.equal(f.rendered.length, 3)
})

test('leaves disabled, native-visible and metadata tracks alone and resyncs on return', () => {
  const f = fixture('disabled')
  for (const mode of ['disabled', 'showing']) {
    f.track.mode = mode
    f.tick()
  }
  f.track.mode = 'hidden'
  f.track.kind = 'metadata'
  f.tick()
  assert.deepEqual(f.rendered, [])
  f.track.kind = 'subtitles'
  f.tick()
  f.track.mode = 'showing'
  f.tick()
  f.track.mode = 'hidden'
  f.tick()
  assert.deepEqual(f.rendered, [['First caption'], ['First caption']])
  f.cleanup()
})

test('renders active captions immediately when binding to paused video', () => {
  const f = fixture()
  assert.deepEqual(f.rendered, [['First caption']])
  f.cleanup()
})

test('renders paused track selections and removes the selection listener on cleanup', () => {
  const f = fixture('disabled')
  f.track.mode = 'hidden'
  f.video.textTracks.dispatchEvent(new Event('change'))
  assert.deepEqual(f.rendered, [['First caption']])

  const next = Object.assign(new EventTarget(), { kind: 'subtitles', mode: 'hidden', activeCues: [{ text: 'Other language' }] })
  const selected = []
  next.addEventListener('cuechange', () => selected.push(next.activeCues.map(cue => cue.text)))
  f.tracks.push(next)
  f.track.mode = 'disabled'
  f.video.textTracks.dispatchEvent(new Event('change'))
  f.video.textTracks.dispatchEvent(new Event('change'))
  assert.deepEqual(selected, [['Other language']])

  f.cleanup()
  next.activeCues = [{ text: 'After teardown' }]
  f.video.textTracks.dispatchEvent(new Event('change'))
  assert.deepEqual(selected, [['Other language']])
})
