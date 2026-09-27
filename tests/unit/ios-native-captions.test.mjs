import assert from 'node:assert/strict'
import test from 'node:test'
import { bindIosNativeCaptions } from '../../src/renderer/helpers/player/iosNativeCaptions.js'

function fixture () {
  const video = new EventTarget()
  const track = Object.assign(new EventTarget(), { kind: 'captions', mode: 'hidden', activeCues: [{ text: 'First caption' }] })
  video.textTracks = [track]
  const rendered = []
  track.addEventListener('cuechange', () => rendered.push(track.activeCues.map(cue => cue.text)))
  const cleanup = bindIosNativeCaptions(video)
  const tick = () => video.dispatchEvent(new Event('timeupdate'))
  return { video, track, rendered, cleanup, tick }
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
  const f = fixture()
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
