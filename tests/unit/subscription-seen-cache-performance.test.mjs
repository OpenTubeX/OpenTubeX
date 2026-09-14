import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, reactive, ref } from 'vue'
import { applySubscriptionSeenVideosToCache } from '../../src/renderer/helpers/subscription-seen-videos.js'

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

for (const reactiveMarks of [false, true]) {
  test(`cached seen state follows metadata and ${reactiveMarks ? 'reactive' : 'serialized'} mark edits`, () => {
    const cache = reactive({ channel: {
      timestamp: 1,
      videos: [{ videoId: 'video', title: 'Old', isNewInSubscriptionFeed: true, isMembersOnly: true }],
    } })
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
