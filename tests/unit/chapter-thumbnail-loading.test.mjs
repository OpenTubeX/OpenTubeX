import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { nextTick, reactive, ref, watch } from 'vue'

const source = await readFile(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const watcherStart = source.indexOf('    watch(() => props.chapters,')
const watcherEnd = source.indexOf('\n    watch(sponsorBlockSubmissionVisibleButtons,', watcherStart)
const loaderStart = source.indexOf('    watch(chapterThumbnails,')
const loaderEnd = source.indexOf('\n    /**', loaderStart)

function deferred() {
  let resolve
  const promise = new Promise(res => { resolve = res })
  return { promise, resolve }
}

function thumbnail(url) {
  return { uris: [url], width: 160, height: 90, imageWidth: 160, imageHeight: 90 }
}

function setup({ chapterThumbnailsWanted = true } = {}) {
  const props = reactive({ videoId: 'testVideo01', chapters: [], sidebarChaptersOpen: false })
  const showChaptersOverlay = ref(false)
  const chapterThumbnails = ref([])
  const requests = []
  const player = {
    getImageTracks: () => [{}],
    getThumbnails(_track, time) {
      const pending = deferred()
      requests.push({ time, ...pending })
      return pending.promise
    }
  }
  const dependencies = {
    props, chapterThumbnails, player, watch, showChaptersOverlay, chapterThumbnailsWanted,
    hasLoaded: ref(true),
    closeChaptersOverlay() {},
    refreshChapterMarkers() {},
    emit() {},
    loadImageDimensions: () => assert.fail('Unexpected sprite image'),
  }
  const compiled = compileFunction(`${source.slice(loaderStart, loaderEnd)}\n${source.slice(watcherStart, watcherEnd)}`, Object.keys(dependencies))
  compiled(...Object.values(dependencies))
  return { props, chapterThumbnails, requests, player, showChaptersOverlay }
}

const flushLoads = () => new Promise(resolve => setImmediate(resolve))

test('older thumbnail results cannot overwrite a newer chapter list', async () => {
  const { props, chapterThumbnails, requests } = setup()
  props.chapters = [{ startSeconds: 0 }]
  await nextTick()
  props.chapters = [{ startSeconds: 10 }, { startSeconds: 20 }]
  await nextTick()
  assert.deepEqual(requests.map(request => request.time), [0, 10, 20])

  requests[1].resolve(thumbnail('new-first.jpg'))
  requests[2].resolve(thumbnail('new-second.jpg'))
  await flushLoads()
  assert.deepEqual(chapterThumbnails.value.map(result => result.url), ['new-first.jpg', 'new-second.jpg'])

  requests[0].resolve(thumbnail('old.jpg'))
  await flushLoads()
  assert.deepEqual(chapterThumbnails.value.map(result => result.url), ['new-first.jpg', 'new-second.jpg'])
})

test('clearing chapters invalidates a pending thumbnail load', async () => {
  const { props, chapterThumbnails, requests } = setup()
  props.chapters = [{ startSeconds: 0 }]
  await nextTick()
  props.chapters = []
  await nextTick()

  requests[0].resolve(thumbnail('old.jpg'))
  await flushLoads()
  assert.deepEqual(chapterThumbnails.value, [])
})

test('a load without image tracks invalidates older pending results', async () => {
  const { props, chapterThumbnails, requests, player } = setup()
  props.chapters = [{ startSeconds: 0 }]
  await nextTick()
  player.getImageTracks = () => []
  props.chapters = [{ startSeconds: 10 }, { startSeconds: 20 }]
  await nextTick()

  requests[0].resolve(thumbnail('old.jpg'))
  await flushLoads()
  assert.deepEqual(chapterThumbnails.value, [])
})

test('does not request thumbnails until a chapter list is opened', async () => {
  const { props, chapterThumbnails, requests } = setup({ chapterThumbnailsWanted: false })
  props.chapters = [{ startSeconds: 0 }, { startSeconds: 10 }]
  await nextTick()
  assert.equal(requests.length, 0)

  props.sidebarChaptersOpen = true
  await nextTick()
  assert.deepEqual(requests.map(request => request.time), [0, 10])
  requests[0].resolve(thumbnail('first.jpg'))
  requests[1].resolve(thumbnail('second.jpg'))
  await flushLoads()
  assert.deepEqual(chapterThumbnails.value.map(result => result.url), ['first.jpg', 'second.jpg'])

  // Closing and reopening reuses the loaded thumbnails.
  props.sidebarChaptersOpen = false
  await nextTick()
  props.sidebarChaptersOpen = true
  await nextTick()
  assert.equal(requests.length, 2)
})

test('opening the fullscreen chapter overlay loads thumbnails', async () => {
  const { props, requests, showChaptersOverlay } = setup({ chapterThumbnailsWanted: false })
  props.chapters = [{ startSeconds: 0 }]
  await nextTick()
  showChaptersOverlay.value = true
  await nextTick()
  assert.deepEqual(requests.map(request => request.time), [0])
})
