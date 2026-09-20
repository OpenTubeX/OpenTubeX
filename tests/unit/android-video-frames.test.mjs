import assert from 'node:assert/strict'
import test from 'node:test'
import { attachAndroidVideoFrames } from '../../src/renderer/helpers/player/androidVideoFrames.js'

function fixture(t, captureFrame = async () => ({ dataUrl: 'frame' })) {
  let cleanup
  let fieldOfView = 75
  const saved = new Map(['document', 'requestAnimationFrame', 'cancelAnimationFrame', 'Image']
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  t.after(() => {
    cleanup?.()
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  globalThis.document = Object.assign(new EventTarget(), { hidden: false })
  let nextFrame
  globalThis.requestAnimationFrame = callback => { nextFrame = callback; return 1 }
  globalThis.cancelAnimationFrame = () => { nextFrame = null }
  globalThis.Image = class { async decode() {} }
  const uploads = []
  const gl = { texImage2D: (...args) => uploads.push(args.at(-1)) }
  const originalUpload = gl.texImage2D
  const element = Object.assign(new EventTarget(), { currentTime: 2, videoWidth: 640, videoHeight: 360, paused: false })
  const canvas = { width: 640, height: 360, getContext: () => gl }
  const detach = attachAndroidVideoFrames(element, canvas, {
    getFieldOfView: () => fieldOfView,
    captureFrame, canCapture: () => true, onError: assert.fail,
  })
  cleanup = detach
  return { element, canvas, setFieldOfView: value => { fieldOfView = value }, gl, uploads, originalUpload, detach, tick: (now = 50) => nextFrame(now) }
}

test('VR texture uploads use the decoded native frame and leave other textures alone', async t => {
  const { element, gl, uploads, originalUpload, detach, tick } = fixture(t)
  let metadata
  element.requestVideoFrameCallback((_now, value) => { metadata = value })
  await tick()
  gl.texImage2D('texture', element)
  const other = {}
  gl.texImage2D('texture', other)
  assert.equal(uploads[0].src, 'frame')
  assert.equal(uploads[1], other)
  assert.equal(metadata.mediaTime, 2)
  detach()
  assert.equal(gl.texImage2D, originalUpload)
  assert.equal(Object.hasOwn(element, 'requestVideoFrameCallback'), false)
})

test('replacing a source while a native frame is being captured discards that frame', async t => {
  const pending = Promise.withResolvers()
  const { element, gl, uploads, tick } = fixture(t, () => pending.promise)
  let callbacks = 0
  element.requestVideoFrameCallback(() => { callbacks++ })
  const rendering = tick()
  element.dispatchEvent(new Event('emptied'))
  pending.resolve({ dataUrl: 'old-frame' })
  await rendering
  gl.texImage2D('texture', element)
  assert.equal(uploads.length, 0)
  assert.equal(callbacks, 0)
})


test('VR capture accounts for panorama coverage, viewport resizing and zoom without upscaling', async t => {
  const requests = []
  const { element, canvas, tick, setFieldOfView } = fixture(t, async request => {
    requests.push(request)
    return { dataUrl: 'frame' }
  })
  element.videoWidth = 7680
  element.videoHeight = 3840
  canvas.width = 1001
  canvas.height = 501
  element.requestVideoFrameCallback(() => {})
  await tick()
  assert.deepEqual(requests[0], { width: 4809, height: 2404, format: 'jpeg' })
  // Rotation, UI scale and device pixel ratio are reflected in the drawing buffer.
  canvas.width = 1600
  canvas.height = 900
  element.currentTime++
  element.requestVideoFrameCallback(() => {})
  await tick(100)
  assert.deepEqual(requests[1], { width: 5792, height: 2896, format: 'jpeg' })
  canvas.width = 640
  canvas.height = 320
  setFieldOfView(30)
  element.currentTime++
  element.requestVideoFrameCallback(() => {})
  await tick(150)
  assert.deepEqual(requests[2], { width: 5792, height: 2896, format: 'jpeg' })
  element.videoWidth = 640
  element.videoHeight = 320
  element.currentTime++
  element.requestVideoFrameCallback(() => {})
  await tick(200)
  assert.deepEqual(requests[3], { width: 640, height: 320, format: 'jpeg' })
})
