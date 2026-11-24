import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, reactive, ref, toRaw } from 'vue'
import { applySubscriptionSeenVideosToCache } from '../../src/renderer/helpers/subscription-seen-videos.js'
import { seenMarksState, withSeenMarkChanges } from '../../src/renderer/helpers/seenMarksState.js'
import { SEEN_VIDEO_MARKS } from '../../src/subscriptionSeenVideos.js'

test('looking up one cached channel does not scan every channel with seen marks', () => {
  let reads = 0
  const cache = reactive(Object.fromEntries(Array.from({ length: 100 }, (_, channel) => [channel, {
    videos: Array.from({ length: 36 }, (_, video) => ({
      get videoId() { reads++; return `${channel}-${video}` },
      isNewInSubscriptionFeed: true
    }))
  }])))
  const feed = computed(() => applySubscriptionSeenVideosToCache(cache, '[{"videoId":"0-0","seenAt":1000}]'))

  assert.equal(feed.value[0].videos[0].isNewInSubscriptionFeed, false)
  assert.ok(reads <= 40, `one channel lookup read ${reads} entries`)
  assert.equal(Object.keys(feed.value).length, 100)
})

test('refreshing a channel does not rescan seen state in unchanged channels', () => {
  let reads = 0
  const cache = reactive(Object.fromEntries(Array.from({ length: 933 }, (_, channel) => [channel, {
    videos: Array.from({ length: 36 }, (_, video) => ({
      get videoId() { reads++; return `${channel}-${video}` },
      isNewInSubscriptionFeed: true,
    })),
  }])))
  const marks = JSON.stringify([{ videoId: '1-0', seenAt: 1000 }])
  const feed = computed(() => applySubscriptionSeenVideosToCache(cache, marks))
  const unchanged = feed.value[1]
  reads = 0
  const start = performance.now()
  for (let refresh = 0; refresh < 80; refresh++) {
    cache[0] = { videos: [{ videoId: 'refreshed', title: String(refresh) }] }
    assert.equal(feed.value[0].videos[0].title, String(refresh))
  }
  console.log(JSON.stringify({ elapsedMs: performance.now() - start, unchangedVideoReads: reads }))
  assert.equal(reads, 0, 'unchanged channels must not be scanned after each response')
  assert.equal(feed.value[1], unchanged)
})

test('marking another video seen only reapplies seen state in its channel', () => {
  let reads = 0
  const cache = reactive(Object.fromEntries(Array.from({ length: 933 }, (_, channel) => [channel, {
    videos: Array.from({ length: 36 }, (_, video) => ({
      get videoId() { reads++; return `${channel}-${video}` },
      isNewInSubscriptionFeed: true
    }))
  }])))
  const marks = ref(JSON.stringify([{ videoId: '1-0', seenAt: 1000 }]))
  const feed = computed(() => Object.values(applySubscriptionSeenVideosToCache(cache, marks.value)))
  assert.equal(feed.value[1].videos[0].isNewInSubscriptionFeed, false)
  const unchanged = feed.value[1]
  reads = 0
  marks.value = JSON.stringify([{ videoId: '1-0', seenAt: 1000 }, { videoId: '2-0', seenAt: 2000 }])
  assert.equal(feed.value[2].videos[0].isNewInSubscriptionFeed, false)
  assert.equal(feed.value[1], unchanged)
  assert.ok(reads <= 80, `marking one channel read ${reads} video IDs`)
})

for (const reactiveMarks of [false, true]) {
  test(`cached seen state follows metadata and ${reactiveMarks ? 'reactive' : 'serialized'} mark edits`, () => {
    const cache = reactive({
      channel: {
        timestamp: 1,
        videos: [{ videoId: 'video', title: 'Old', isNewInSubscriptionFeed: true, isMembersOnly: true }],
      }
    })
    const initial = [{ videoId: 'video', seenAt: 1000, isMembersOnly: true }]
    const marks = ref(reactiveMarks ? initial : JSON.stringify(initial))
    const feed = computed(() => applySubscriptionSeenVideosToCache(cache, marks.value))
    assert.equal(feed.value.channel.videos[0].isNewInSubscriptionFeed, false)
    cache.channel.videos[0].title = 'Updated'
    cache.channel.timestamp = 2
    assert.equal(feed.value.channel.videos[0].title, 'Updated')
    assert.equal(feed.value.channel.timestamp, 2)
    cache.channel.videos[0].isMembersOnly = false
    assert.equal(feed.value.channel.videos[0].isNewInSubscriptionFeed, true)
    const publicMark = [{ videoId: 'video', seenAt: 2000, isMembersOnly: false }]
    if (reactiveMarks) Object.assign(marks.value[0], publicMark[0])
    else marks.value = JSON.stringify(publicMark)
    assert.equal(feed.value.channel.videos[0].isNewInSubscriptionFeed, false)
    if (reactiveMarks) marks.value[0].unseenAt = 3000
    else marks.value = JSON.stringify([{ ...publicMark[0], unseenAt: 3000 }])
    assert.equal(feed.value.channel.videos[0].isNewInSubscriptionFeed, true)
    cache.channel.videos.push({ videoId: 'added', isNewInSubscriptionFeed: true })
    assert.equal(feed.value.channel.videos.length, 2)
    cache.channel.videos.splice(0, 1)
    assert.equal(feed.value.channel.videos[0].videoId, 'added')
    cache.channel.videos = [{ videoId: 'replaced' }]
    assert.equal(feed.value.channel.videos[0].videoId, 'replaced')
    marks.value = reactiveMarks ? [] : '[]'
    assert.equal(feed.value, cache)
    delete cache.channel
    assert.deepEqual(Object.keys(feed.value), [])
  })
}

test('plain mutable cache and marks never reuse stale results', () => {
  const cache = { channel: { videos: [{ videoId: 'video', isNewInSubscriptionFeed: true }] } }
  const marks = [{ videoId: 'video', seenAt: 1000 }]
  assert.equal(applySubscriptionSeenVideosToCache(cache, marks).channel.videos[0].isNewInSubscriptionFeed, false)
  marks[0].unseenAt = 2000
  assert.equal(applySubscriptionSeenVideosToCache(cache, marks).channel.videos[0].isNewInSubscriptionFeed, true)
  cache.channel.videos[0].title = 'Updated'
  assert.equal(applySubscriptionSeenVideosToCache(cache, marks).channel.videos[0].title, 'Updated')
})

test('applying a merge to the store marks reads only the changed video and its channel', () => {
  let markReads = 0
  let idReads = 0
  const cache = reactive(Object.fromEntries(Array.from({ length: 300 }, (_, channel) => [channel, {
    videos: Array.from({ length: 36 }, (_, video) => ({
      get videoId() { idReads++; return `${channel}-${video}` },
      isNewInSubscriptionFeed: true
    }))
  }])))
  const store = { marks: seenMarksState(SEEN_VIDEO_MARKS, '[]') }
  // A full list, whose marks count their reads
  const byId = toRaw(store.marks.byId)
  for (let index = 0; index < 10000; index++) {
    const mark = { videoId: `${index % 300}-${index % 36}x${index}`, isMembersOnly: false }
    Object.defineProperty(mark, 'seenAt', { enumerable: true, get() { markReads++; return 1000 + index } })
    byId.set(mark.videoId, mark)
  }
  const marks = ref(store.marks)
  const feed = computed(() => applySubscriptionSeenVideosToCache(cache, marks.value))
  assert.equal(feed.value[1].videos[0].isNewInSubscriptionFeed, true)
  const channels = Object.keys(cache).map(channel => feed.value[channel])
  markReads = 0
  idReads = 0
  marks.value = withSeenMarkChanges(SEEN_VIDEO_MARKS, marks.value, {
    upserts: [{ videoId: '2-0', seenAt: 20000, isMembersOnly: false }],
    removals: [],
  })
  assert.notEqual(marks.value, store.marks)
  assert.equal(feed.value[2].videos[0].isNewInSubscriptionFeed, false)
  for (const [channel, previous] of channels.entries()) {
    if (channel !== 2) assert.equal(feed.value[channel], previous)
  }
  assert.equal(markReads, 0, 'applying one mark must not read the other saved marks')
  assert.ok(idReads <= 40, `applying one mark read ${idReads} video IDs`)
})
