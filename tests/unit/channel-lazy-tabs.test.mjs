import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed, ref, shallowRef } from 'vue'

const source = readFileSync(new URL('../../src/renderer/views/Channel/Channel.vue', import.meta.url), 'utf8')

function slice(start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from)
  assert.ok(from !== -1 && to !== -1, `${start} is in Channel.vue`)
  return source.slice(from, to)
}

const SUPPORTED_CHANNEL_TABS = ['home', 'videos', 'shorts', 'live', 'releases', 'shows', 'podcasts', 'courses', 'playlists', 'community', 'about']
const LOADERS = {
  local: ['getChannelAboutLocal', 'getChannelVideosLocal', 'getChannelShortsLocal', 'getChannelLiveLocal', 'getChannelPodcastsLocal', 'getChannelReleasesLocal', 'getChannelCoursesLocal', 'getChannelShowsLocal', 'getChannelPlaylistsLocal', 'getCommunityPostsLocal'],
  invidious: ['channelInvidiousVideos', 'channelInvidiousShorts', 'channelInvidiousLive', 'channelInvidiousPodcasts', 'channelInvidiousReleases', 'channelInvidiousCourses', 'channelInvidiousShows', 'getPlaylistsInvidious', 'getCommunityPostsInvidious'],
}

function channelView({ routeTab, tabs = ['videos', 'shorts', 'live', 'playlists', 'community'] } = {}) {
  const fetched = []
  const dispatched = []
  const loaders = Object.fromEntries([...LOADERS.local, ...LOADERS.invidious].map(name => [name, () => { fetched.push(name) }]))
  const channelTabs = ref([])
  const context = {
    ...loaders,
    process: { env: { SUPPORTS_LOCAL_API: true } },
    apiUsed: '',
    loadedTabs: new Set(),
    pendingTabs: new Map(),
    elementListLoadingTabs: ref({}),
    elementListRequestIds: {},
    channelLoaded: false,
    channelInstance: null,
    channelRouteGeneration: 0,
    isLoading: ref(true),
    id: ref('UCchannel'),
    channelName: ref(''),
    channelVerified: ref(false),
    channelVerifiedArtist: ref(false),
    thumbnailUrl: ref(''),
    bannerUrl: ref(''),
    isFamilyFriendly: ref(true),
    isArtistTopicChannel: ref(false),
    tags: ref([]),
    subCount: ref(0),
    description: ref(''),
    viewCount: ref(0),
    videoCount: ref(0),
    joined: ref(0),
    location: ref(null),
    links: ref([]),
    relatedChannels: ref([]),
    errorMessage: ref(''),
    showSearchBar: ref(false),
    currentTab: ref('videos'),
    autoLoadPaused: ref(false),
    channelTabs,
    subscriptionInfo: ref(null),
    currentInvidiousInstanceUrl: ref('https://invidious.test'),
    hideChannelHome: ref(false),
    hideChannelShorts: ref(false),
    hideChannelPodcasts: ref(false),
    hideChannelReleases: ref(false),
    hideChannelCourses: ref(false),
    hideChannelShows: ref(false),
    hideChannelPlaylists: ref(false),
    hideChannelCommunity: ref(false),
    videoSortBy: ref('newest'),
    liveSortBy: ref('newest'),
    latestVideos: ref([{ videoId: 'video' }]),
    latestLive: ref([]),
    latestCommunityPosts: ref([{ postId: 'post' }]),
    route: { params: { currentTab: routeTab } },
    SUPPORTED_CHANNEL_TABS,
    YTNodes: {},
    store: { dispatch: (action, payload) => { dispatched.push(action) } },
    updateChannelDetails() {},
    resetTabContinuations() {},
    t: key => key,
    autolinker: { link: text => text },
    youtubeImageUrlToInvidious: url => url,
    parseLocalChannelHeader: () => ({ id: 'UCchannel', name: 'Channel', tags: [] }),
    parseLocalSubscriberCount: () => 0,
    getChannelHomeLocal: () => { fetched.push('getChannelHomeLocal') },
    currentOrFirstTab: tab => channelTabs.value.includes(tab) ? tab : channelTabs.value[0],
    ensureChannelInstance: async () => {
      context.channelInstance ??= {
        memo: new Map(),
        metadata: {},
        tabs: ['Videos'],
        has_about: true,
        has_search: true,
        has_videos: tabs.includes('videos'),
        has_shorts: tabs.includes('shorts'),
        has_live_streams: tabs.includes('live'),
        has_playlists: tabs.includes('playlists'),
        has_shows: tabs.includes('shows'),
        has_community: tabs.includes('community'),
      }
    },
    invidiousGetChannelInfo: async () => ({
      author: 'Channel',
      authorId: 'UCchannel',
      authorThumbnails: [],
      authorBanners: [],
      relatedChannels: [],
      tabs: [...tabs, 'about'],
    }),
    document: { getElementById: () => null },
    setErrorMessage: message => { throw new Error(`unexpected error: ${message}`) },
    showApiErrorToast: (message, error) => { throw error },
  }

  vm.runInNewContext([
    slice('async function getChannelLocal() {', 'async function getChannelAboutLocal() {'),
    slice('async function getChannelInfoInvidious() {', 'const latestVideos = shallowRef('),
    slice('const localTabLoaders = {', 'function filterWatchedArray('),
    slice('function startElementListRequest(', 'const isCurrentTabLoading'),
  ].join('\n'), context)
  return { context, fetched, dispatched }
}

for (const api of ['local', 'invidious']) {
  const load = api === 'local' ? 'getChannelLocal' : 'getChannelInfoInvidious'
  const videos = api === 'local' ? 'getChannelVideosLocal' : 'channelInvidiousVideos'
  const playlists = api === 'local' ? 'getChannelPlaylistsLocal' : 'getPlaylistsInvidious'

  test(`opening a channel fetches only its current tab (${api})`, async () => {
    const view = channelView()
    await view.context[load]()
    assert.equal(view.context.currentTab.value, 'videos')
    assert.deepEqual(view.fetched.filter(name => name !== 'getChannelHomeLocal'), [videos])
    assert.deepEqual(view.context.channelTabs.value, ['videos', 'shorts', 'live', 'playlists', 'community', 'about'],
      'tab visibility still comes from the channel')

    view.context.changeTab('playlists')
    view.context.changeTab('videos')
    view.context.changeTab('playlists')
    assert.deepEqual(view.fetched.filter(name => name !== 'getChannelHomeLocal'), [videos, playlists],
      'switching fetches a tab once')

    view.context.changeTab('search')
    assert.equal(view.fetched.length, 2, 'the search tab loads through its own search')
  })

  test(`a tab from the route loads first, and a switch during the base load gives way to it (${api})`, async () => {
    const view = channelView({ routeTab: 'playlists' })
    const loading = view.context[load]()
    view.context.changeTab('live')
    assert.deepEqual(view.fetched, [], 'nothing can load before the channel is known')
    await loading
    // As before lazy tabs, the finished load shows the tab from the route.
    assert.equal(view.context.currentTab.value, 'playlists')
    assert.deepEqual(view.fetched.filter(name => name !== 'getChannelHomeLocal'), [playlists])
  })

  test(`the shows tab is listed and fetched when opened (${api})`, async () => {
    const shows = api === 'local' ? 'getChannelShowsLocal' : 'channelInvidiousShows'
    const view = channelView({ tabs: ['videos', 'shows', 'playlists'] })
    await view.context[load]()
    assert.deepEqual(view.context.channelTabs.value, ['videos', 'shows', 'playlists', 'about'])
    view.context.changeTab('shows')
    assert.deepEqual(view.fetched.filter(name => name !== 'getChannelHomeLocal'), [videos, shows])
  })

  test(`reloading a channel fetches its tabs again (${api})`, async () => {
    const view = channelView()
    await view.context[load]()
    view.context.id.value = 'UCother'
    view.context.channelInstance = null
    await view.context[load]()
    assert.deepEqual(view.fetched.filter(name => name !== 'getChannelHomeLocal'), [videos, videos])
  })
}

test('the local home tab is parsed once at load for related channels, not refetched on switch', async () => {
  const view = channelView()
  view.context.ensureChannelInstance = async () => {
    view.context.channelInstance = {
      memo: new Map(), metadata: {}, tabs: ['Home'], has_home: true, has_about: true, has_videos: true,
    }
  }
  await view.context.getChannelLocal()
  view.context.changeTab('home')
  assert.equal(view.context.currentTab.value, 'home')
  assert.deepEqual(view.fetched, ['getChannelHomeLocal'])
  view.context.changeTab('videos')
  assert.deepEqual(view.fetched, ['getChannelHomeLocal', 'getChannelVideosLocal'])
})

test('subscribing caches only the tabs that were fetched', async () => {
  const view = channelView()
  await view.context.getChannelInfoInvidious()
  view.context.handleSubscription()
  assert.deepEqual(view.dispatched, ['updateSubscriptionVideosCacheByChannel'])

  view.dispatched.length = 0
  view.context.changeTab('community')
  // The community tab is still loading and caches its own posts when it finishes.
  view.context.handleSubscription()
  assert.deepEqual(view.dispatched, ['updateSubscriptionVideosCacheByChannel'])

  await new Promise(resolve => setImmediate(resolve))
  view.dispatched.length = 0
  view.context.handleSubscription()
  assert.deepEqual(view.dispatched, ['updateSubscriptionVideosCacheByChannel', 'updateSubscriptionPostsCacheByChannel'])

  // A sort change reloads the videos without fetchTab, and a failed load leaves
  // an empty list. Neither replaces the cached feed.
  view.dispatched.length = 0
  view.context.elementListLoadingTabs.value.videos = true
  view.context.latestCommunityPosts.value = []
  view.context.handleSubscription()
  assert.deepEqual(view.dispatched, [])
})

test('a superseded Invidious channel load does not update the page', async () => {
  const view = channelView()
  let respond
  view.context.invidiousGetChannelInfo = () => new Promise(resolve => { respond = resolve })
  const stale = view.context.getChannelInfoInvidious()
  // The user navigates away and back to the same channel before it answers.
  view.context.channelRouteGeneration++
  respond({ author: 'Stale', authorId: 'UCchannel', authorThumbnails: [], authorBanners: [], relatedChannels: [], tabs: ['videos'] })
  await stale
  assert.equal(view.context.channelLoaded, false)
  assert.deepEqual(view.fetched, [])
})

test('filtered shorts reuse the parsed shorts instead of copying them', () => {
  const latestShorts = shallowRef([])
  const hideWatchedSubs = ref(false)
  const id = ref('UCchannel')
  const { filteredShorts, withChannelShortsContext } = vm.runInNewContext(`
    ${slice('const filteredShorts = computed(', 'const filteredLive = computed(')}
    ${slice('function withChannelShortsContext(', 'watch(shortSortBy')}
    ;({ filteredShorts, withChannelShortsContext })
  `, {
    computed, latestShorts, hideWatchedSubs, id,
    store: { getters: { getHistoryCacheById: { watched: {} } } },
    filterWatchedArray: videos => videos.filter(video => video.videoId !== 'watched'),
  })

  const shorts = withChannelShortsContext([{ videoId: 'watched' }, { videoId: 'new' }])
  latestShorts.value = shorts
  assert.equal(filteredShorts.value, shorts)
  assert.deepEqual(shorts.map(({ shortSource, shortChannelId }) => [shortSource, shortChannelId]),
    [['channel', 'UCchannel'], ['channel', 'UCchannel']])

  hideWatchedSubs.value = true
  assert.equal(filteredShorts.value[0], shorts[1], 'filtering keeps the stamped objects')
})

test('switching backends invalidates tab requests from the earlier load', async () => {
  const view = channelView()
  await view.context.getChannelLocal()
  const localGeneration = view.context.channelRouteGeneration
  // A local tab request falls back to Invidious while About is pending. The
  // invalidated request stops without clearing its loading state.
  view.context.elementListLoadingTabs.value.about = true
  const isCurrentLocalRequest = view.context.startElementListRequest('community')
  await view.context.getChannelInfoInvidious()
  assert.ok(view.context.channelRouteGeneration > localGeneration)
  assert.equal(isCurrentLocalRequest(), false, 'a late local response is ignored')
  assert.equal(view.context.elementListLoadingTabs.value.about, undefined)
})

test('a failed page pauses automatic loading only while its tab is selected', async () => {
  const continuations = { videos: 'videos-2', playlists: 'playlists-2' }
  let finishVideos
  const context = {
    currentTab: ref('videos'),
    autoLoadPaused: ref(false),
    isFetchMoreLoading: ref(false),
    tabApiUsed: new Map([['videos', 'invidious'], ['playlists', 'invidious']]),
    process: { env: {} },
    console,
    // Fails: the continuation stays unchanged once the request settles.
    channelInvidiousVideos: () => new Promise(resolve => { finishVideos = resolve }),
    getPlaylistsInvidiousMore: async () => { continuations.playlists = 'playlists-3' },
  }
  for (const [name, tab] of [['video', 'videos'], ['short'], ['live'], ['release'], ['podcast'], ['courses'], ['playlist', 'playlists'], ['community'], ['search']]) {
    Object.defineProperty(context, `${name}ContinuationData`, { get: () => ({ value: continuations[tab] ?? null }) })
  }
  vm.runInNewContext([
    slice('function tabContinuation(', 'const showFetchMoreButton'),
    slice('async function handleFetchMore() {', '/**\n * Handles a user-initiated tab change'),
  ].join('\n'), context)

  const videos = context.handleFetchMore()
  context.currentTab.value = 'playlists'
  finishVideos()
  await videos
  assert.equal(context.autoLoadPaused.value, false, 'the selected tab keeps loading automatically')

  context.currentTab.value = 'videos'
  const retry = context.handleFetchMore()
  finishVideos()
  await retry
  assert.equal(context.autoLoadPaused.value, true, 'the failed tab waits for a click')

  context.currentTab.value = 'playlists'
  await context.handleFetchMore()
  assert.equal(context.autoLoadPaused.value, false, 'a page that loads resumes automatic loading')
})

test('a superseded search page cannot pause the next search, and a new list loads automatically again', async () => {
  const pending = []
  const context = {
    currentTab: ref('search'),
    autoLoadPaused: ref(false),
    isFetchMoreLoading: ref(false),
    isSearchTabLoading: ref(false),
    tabApiUsed: new Map([['search', 'invidious']]),
    process: { env: {} },
    console,
    id: ref('UCchannel'),
    channelRouteGeneration: 0,
    elementListRequestIds: {},
    lastSearchQuery: ref('old'),
    searchResults: shallowRef([]),
    hideChannelPlaylists: ref(false),
    getInvidiousChannelSearchResultType: () => 'video',
    searchInvidiousChannel: () => new Promise(resolve => { pending.push(resolve) }),
  }
  for (const name of ['video', 'short', 'live', 'release', 'podcast', 'courses', 'playlist', 'community', 'search']) {
    context[`${name}ContinuationData`] = shallowRef(null)
  }
  vm.runInNewContext([
    slice('function startElementListRequest(', 'const isCurrentTabLoading'),
    slice('function tabContinuation(', 'const showFetchMoreButton'),
    slice('async function searchChannelInvidious() {', '/**\n * @param {string} query'),
    slice('async function handleFetchMore() {', '/**\n * Handles a user-initiated tab change'),
  ].join('\n'), context)
  const video = { type: 'video', videoId: 'video' }

  context.startElementListRequest('search')
  const firstSearch = context.searchChannelInvidious()
  pending.shift()([video])
  await firstSearch
  const oldPageTwo = context.handleFetchMore()

  // A new search starts while page 2 of the old one is still loading.
  context.searchContinuationData.value = null
  context.startElementListRequest('search')
  const newSearch = context.searchChannelInvidious()
  pending.pop()([video])
  await newSearch
  pending.shift()([video])
  await oldPageTwo
  assert.equal(context.autoLoadPaused.value, false, 'the new search keeps loading automatically')

  context.autoLoadPaused.value = true
  context.startElementListRequest('videos')
  assert.equal(context.autoLoadPaused.value, true, 'a list loading in a hidden tab keeps the selected tab paused')
  context.startElementListRequest('search')
  assert.equal(context.autoLoadPaused.value, false, 'reloading a list, for example after sorting, resumes automatic loading')
})
