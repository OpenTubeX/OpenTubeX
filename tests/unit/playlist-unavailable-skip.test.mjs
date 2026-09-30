import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, effectScope, nextTick, reactive, ref, shallowRef, watch } from 'vue'

const source = readFileSync(new URL('../../src/renderer/components/WatchVideoPlaylist/WatchVideoPlaylist.vue', import.meta.url), 'utf8')
const playlistsSource = readFileSync(new URL('../../src/renderer/helpers/playlists.js', import.meta.url), 'utf8')
const slice = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)))
const component = [
  'const skippedUnavailableItems = new Set(); let expectedAutoSkipItem = null',
  slice(playlistsSource, 'export function getPlaylistSkipAvailability(', 'export function videoDurationPresent(').replace('export function', 'function'),
  slice(source, 'function findIndexOfCurrentVideoInPlaylist(', 'function getPlaylistInfoWithDelay('),
  slice(source, 'const currentVideoIndexZeroBased =', 'const upcomingVideos ='),
  slice(source, 'function shufflePlaylistItems() {', 'const playlistItemsWrapper ='),
  slice(source, 'function playNextVideo() {', 'function playPreviousVideo() {'),
  slice(source, 'watch(() => props.videoId, (newId, oldId) => {', 'watch(() => props.playlistItemId,'),
  slice(source, 'watch(\n  [() => props.autoSkipUnavailable,', '// The watch view owns the skip actions'),
  'globalThis.actions = { playNextVideo, resetUnavailableSkipChain }',
].join('\n')

function setup(t, items = ['A', 'B', 'C'].map(id => ({ videoId: id, playlistItemId: id }))) {
  const last = items.at(-1)
  const props = reactive({
    videoId: last.videoId,
    playlistItemId: last.playlistItemId,
    playlistId: 'playlist',
    playlistType: 'user',
    autoSkipUnavailable: false,
    watchViewLoading: false,
  })
  const playlistItems = shallowRef(items)
  const randomizedPlaylistItems = shallowRef(items.slice())
  const navigations = []
  const context = vm.createContext({
    props, playlistItems, randomizedPlaylistItems, computed, ref, watch,
    playlistTotalVideoCount: ref(items.length),
    prevVideoBeforeDeletion: ref(null),
    shuffleEnabled: ref(true),
    loopEnabled: ref(true),
    isLoading: ref(false),
    canPlayNextVideo: ref(true),
    router: { push(payload) { navigations.push(payload) } },
    Math: Object.assign(Object.create(Math), { random: () => 0 }),
    showToast() {},
    t: key => key,
  })
  const scope = effectScope()
  scope.run(() => vm.runInContext(component, context))
  t.after(() => scope.stop())

  async function failCurrentVideo() {
    props.autoSkipUnavailable = true
    await nextTick()
  }

  async function finishNavigation() {
    const navigation = navigations.shift()
    assert.ok(navigation, 'an unavailable video should advance to another playlist item')
    props.watchViewLoading = true
    props.autoSkipUnavailable = false
    props.videoId = navigation.path.slice('/watch/'.length)
    props.playlistItemId = navigation.query.playlistItemId
    await nextTick()
    props.watchViewLoading = false
    await nextTick()
  }

  return { props, navigations, randomizedPlaylistItems, failCurrentVideo, finishNavigation, actions: context.actions }
}

test('looping shuffled playback skips consecutive unavailable videos and reaches a playable item', async t => {
  const playlist = setup(t)
  // B played successfully before C failed at the end of the current shuffle.
  await playlist.failCurrentVideo()
  await playlist.finishNavigation()
  assert.equal(playlist.props.playlistItemId, 'A')
  await playlist.failCurrentVideo()
  await playlist.finishNavigation()
  assert.equal(playlist.props.playlistItemId, 'B')
  playlist.actions.resetUnavailableSkipChain()
  assert.equal(playlist.navigations.length, 0)
})

test('a shuffled loop tries every unavailable entry once before stopping', async t => {
  const playlist = setup(t)
  const attempted = [playlist.props.playlistItemId]
  for (let index = 0; index < 3; index++) {
    await playlist.failCurrentVideo()
    if (playlist.navigations.length === 0) break
    await playlist.finishNavigation()
    attempted.push(playlist.props.playlistItemId)
  }
  assert.deepEqual(attempted, ['C', 'A', 'B'])
  assert.equal(playlist.navigations.length, 0)
})

test('unavailable skipping distinguishes duplicate videos by playlist item ID', async t => {
  const playlist = setup(t, [
    { videoId: 'shared', playlistItemId: 'first' },
    { videoId: 'shared', playlistItemId: 'second' },
    { videoId: 'last', playlistItemId: 'last' },
  ])
  await playlist.failCurrentVideo()
  await playlist.finishNavigation()
  assert.equal(playlist.props.playlistItemId, 'first')
  await playlist.failCurrentVideo()
  await playlist.finishNavigation()
  assert.equal(playlist.props.videoId, 'shared')
  assert.equal(playlist.props.playlistItemId, 'second')
})

test('ordinary playlist loop navigation still reshuffles after successful playback', async t => {
  const playlist = setup(t)
  playlist.actions.playNextVideo()
  assert.deepEqual(playlist.randomizedPlaylistItems.value.map(item => item.playlistItemId), ['C', 'B', 'A'])
  await playlist.finishNavigation()
  assert.deepEqual(playlist.randomizedPlaylistItems.value.map(item => item.playlistItemId), ['A', 'C', 'B'])
})
