import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, reactive } from 'vue'
import { getNewSubscriptionEntriesSnapshot } from '../../src/renderer/helpers/subscription-entry-snapshot.js'

test('selects reactive entries without reading display metadata, including after a channel refresh', () => {
  let copied = 0
  const cache = reactive(Object.fromEntries(Array.from({ length: 938 }, (_, channel) => [channel, {
    videos: [{ get title() { copied++; return `Channel ${channel}` }, isNewInSubscriptionFeed: true }]
  }])))
  const feed = computed(() => Object.values(cache).flatMap(channel => getNewSubscriptionEntriesSnapshot(channel.videos)))
  assert.equal(feed.value.length, 938)
  assert.equal(copied, 0)
  const unchangedEntry = feed.value[1]
  cache[0].videos = [{ title: 'Refreshed', isNewInSubscriptionFeed: true }]
  assert.equal(feed.value[0].title, 'Refreshed')
  assert.equal(feed.value[1], unchangedEntry)
  assert.equal(copied, 0)
})

test('tracks seen flags, metadata, added properties and changed array membership', () => {
  const entries = reactive([{ videoId: 'video', title: 'Old', isNewInSubscriptionFeed: true }])
  const feed = computed(() => getNewSubscriptionEntriesSnapshot(entries))
  const initial = feed.value
  entries[0].isNewInSubscriptionFeed = false
  assert.equal(feed.value.length, 0)
  entries[0].isNewInSubscriptionFeed = true
  assert.equal(initial[0].isNewInSubscriptionFeed, true)
  entries[0].title = 'Updated'
  entries[0].viewCount = 1234
  assert.equal(feed.value[0].title, 'Updated')
  assert.equal(feed.value[0].viewCount, 1234)
  delete entries[0].viewCount
  assert.equal('viewCount' in feed.value[0], false)
  entries.push({ videoId: 'another', isNewInSubscriptionFeed: true })
  assert.equal(feed.value.length, 2)
  entries.splice(0, 1)
  assert.equal(feed.value[0].videoId, 'another')
})

test('does not cache non-reactive input that cannot invalidate a snapshot', () => {
  const entries = [{ title: 'Old', isNewInSubscriptionFeed: true }]
  assert.equal(getNewSubscriptionEntriesSnapshot(entries)[0].title, 'Old')
  entries[0].title = 'New'
  assert.equal(getNewSubscriptionEntriesSnapshot(entries)[0].title, 'New')
})

test('Home reuses seen-state selection across visits while retaining reactive source entries', () => {
  let scanned = 0
  const entries = reactive(Array.from({ length: 30000 }, (_, index) => ({
    title: `Entry ${index}`,
    get isNewInSubscriptionFeed() { scanned++; return index === 0 },
  })))
  const firstVisit = computed(() => getNewSubscriptionEntriesSnapshot(entries))
  const first = firstVisit.value
  assert.equal(first[0], entries[0])
  const initialScans = scanned
  const secondVisit = computed(() => getNewSubscriptionEntriesSnapshot(entries))
  assert.equal(secondVisit.value, first)
  assert.equal(scanned, initialScans)
  entries[0].title = 'Updated'
  assert.equal(secondVisit.value[0].title, 'Updated')
  entries.splice(0, 1)
  assert.equal(secondVisit.value.length, 0)
})
