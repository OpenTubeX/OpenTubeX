import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, nextTick, ref } from 'vue'
import { useSeekPreviewThumbnail } from '../../src/renderer/components/ft-shaka-video-player/opentubex/useSeekPreviewThumbnail.js'

const frame = { uris: ['https://example.test/sprite.jpg#xywh=160,0,160,90'], width: 160, height: 90, positionX: 160, positionY: 0 }
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const flush = async () => { await nextTick(); await new Promise(resolve => setImmediate(resolve)) }

function fixture(t, { getThumbnails = async () => frame, tracks = [{}], loadImageDimensions = async () => ({ width: 320, height: 90 }) } = {}) {
  const preview = ref(null)
  const videoId = ref('first')
  const player = { getImageTracks: () => tracks, getThumbnails }
  let style
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} })
  const app = renderer.createApp({ setup() {
    style = useSeekPreviewThumbnail({ preview, getVideoId: () => videoId.value, getPlayer: () => player, loadImageDimensions })
    return () => null
  } })
  app.mount({})
  t.after(() => app.unmount())
  return { preview, videoId, style, app }
}

test('seek preview crops the matching storyboard tile and caches its image within a gesture', async t => {
  let loads = 0
  const { preview, style } = fixture(t, { loadImageDimensions: async () => { loads++; return { width: 320, height: 90 } } })
  preview.value = { time: 21 }
  await flush()
  assert.deepEqual(style.value, {
    '--seek-thumbnail-aspect-ratio': 160 / 90, aspectRatio: '160 / 90',
    backgroundImage: 'url("https://example.test/sprite.jpg")', backgroundSize: '200% 100%', backgroundPosition: '100% 0%',
  })
  preview.value = { time: 22 }
  await flush()
  assert.equal(loads, 1)
  preview.value = null
  await flush()
  assert.equal(style.value, null)
  preview.value = { time: 23 }
  await flush()
  assert.equal(loads, 2)
})

for (const [name, options] of [
  ['no frame tracks', { tracks: [] }], ['missing frame', { getThumbnails: async () => null }],
  ['broken image', { loadImageDimensions: async () => null }],
  ['failed request', { getThumbnails: async () => { throw Error('Unavailable') } }],
]) {
  test(`seek preview keeps time-only feedback with ${name}`, async t => {
    const { preview, style } = fixture(t, options)
    preview.value = { time: 21 }
    await flush()
    assert.equal(style.value, null)
  })
}

test('late frames cannot replace a newer seek target', async t => {
  const first = deferred()
  const { preview, style } = fixture(t, { getThumbnails: async (_, time) => time === 21 ? first.promise : { ...frame, positionX: 0 } })
  preview.value = { time: 21 }
  await flush()
  preview.value = { time: 9 }
  await flush()
  assert.equal(style.value.backgroundPosition, '0% 0%')
  first.resolve(frame)
  await flush()
  assert.equal(style.value.backgroundPosition, '0% 0%')
})

for (const action of ['finish', 'video change', 'unmount']) {
  test(`late images cannot restore the preview after ${action}`, async t => {
    const image = deferred()
    const { preview, videoId, style, app } = fixture(t, { loadImageDimensions: () => image.promise })
    preview.value = { time: 21 }
    await flush()
    if (action === 'unmount') app.unmount()
    else preview.value = null
    if (action === 'video change') videoId.value = 'second'
    await flush()
    image.resolve({ width: 320, height: 90 })
    await flush()
    assert.equal(style.value, null)
  })
}

test('individual frame images use their natural dimensions without a sprite crop', async t => {
  const { preview, style } = fixture(t, {
    getThumbnails: async () => ({ uris: ['https://example.test/frame.jpg'] }),
    loadImageDimensions: async () => ({ width: 90, height: 160 }),
  })
  preview.value = { time: 21 }
  await flush()
  assert.equal(style.value.aspectRatio, '90 / 160')
  assert.equal(style.value.backgroundSize, '100% 100%')
  assert.equal(style.value.backgroundPosition, '0% 0%')
})
