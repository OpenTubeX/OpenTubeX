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
  slice(source, 'function shuffleItems(', 'const playlistItemsWrapper ='),
  slice(source, 'function playNextVideo() {', 'function playPreviousVideo() {'),
  slice(source, 'function playUserPlaylistItem(item) {', 'watch([() => props.videoId, () => props.playlistItemId, () => props.libraryMemberId, sortOrder'),
  slice(source, 'watch(() => props.videoId, (newId, oldId) => {', 'watch(() => props.playlistItemId,'),
  slice(source, 'watch(\n  [() => props.autoSkipUnavailable,', '// The watch view owns the skip actions'),
  'globalThis.actions = { playNextVideo, resetUnavailableSkipChain }',
].join('\n')

function setup(t, items = ['A', 'B', 'C'].map(id => ({ videoId: id, playlistItemId: id })), paged = false) {
  const last = paged ? items[0] : items.at(-1)
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
    isPagedPlaylist: ref(paged), props, playlistItems, randomizedPlaylistItems, computed, ref, watch,
    userWindow: computed(() => {
      const index = items.findIndex(item => props.libraryMemberId ? item._libraryMemberId === props.libraryMemberId : item.playlistItemId === props.playlistItemId)
      return { index, total: items.length, next: items[(index + 1) % items.length] }
    }),
    playlistTotalVideoCount: ref(items.length),
    prevVideoBeforeDeletion: ref(null),
    shuffleEnabled: ref(!paged),
    loopEnabled: ref(true),
    isLoading: ref(false),
    isFetchingPlaylistContinuation: ref(false),
    hasUnloadedPlaylistVideos: ref(false),
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
    // Membership comes directly from the route; Watch updates its copied IDs
    // after awaiting player teardown, then checking the playlist.
    props.libraryMemberId = navigation.query.libraryMemberId
    if (paged) await nextTick()
    props.videoId = navigation.path.slice('/watch/'.length)
    if (paged) await nextTick()
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

for (const duplicate of [false, true]) {
  test(`paged unavailable loop resolves an initial route without membership ID${duplicate ? ' with duplicate legacy item IDs' : ''}`, async t => {
    const items = ['first', 'second', 'third'].map(id => ({
      videoId: duplicate ? 'shared' : id,
      playlistItemId: duplicate ? 'legacy-duplicate' : id,
      _libraryMemberId: id + '-member',
    }))
    const playlist = setup(t, items, true)
    assert.equal(playlist.props.libraryMemberId, undefined)
    await playlist.failCurrentVideo()
    await playlist.finishNavigation()
    assert.equal(playlist.props.libraryMemberId, 'second-member')
    await playlist.failCurrentVideo()
    await playlist.finishNavigation()
    assert.equal(playlist.props.libraryMemberId, 'third-member')
    await playlist.failCurrentVideo()
    assert.equal(playlist.navigations.length, 0, 'all unavailable members have been tried')

    // A manual selection starts a fresh chain, even if video/item IDs match.
    playlist.props.autoSkipUnavailable = false
    playlist.props.libraryMemberId = 'second-member'
    await nextTick()
    await playlist.failCurrentVideo()
    await playlist.finishNavigation()
    assert.equal(playlist.props.libraryMemberId, 'third-member')
  })
}
