import { computed, onBeforeUnmount, ref, shallowRef, toRaw, watch } from 'vue'
import store from '../store/index'
import { DBLibraryHandlers } from '../../datastores/handlers/index'
import { buildRecommendationProfileAsync, rankRecommendationCandidatesAsync, recommendationSubscriptionIds, getRecommendationLearningEntries } from '../helpers/recommendations'
import { runCooperatively } from '../helpers/cooperativeTask'
import { collectRecommendationCandidates, fetchRecommendationSource, mergeRecommendationCandidates } from '../helpers/recommendationCandidates'
import { getLocalChannelVideos, getLocalSearchResults, getLocalRelatedVideos } from '../helpers/api/local'
import { getInvidiousChannelVideos, getInvidiousSearchResults, getInvidiousRelatedVideos } from '../helpers/api/invidious'
import { isVideoHiddenByPreferences } from '../helpers/subscriptions'
import { shouldHideMembersOnlyContent } from '../helpers/restricted-playback'
import { getUpcomingPremiereTimestamp } from '../helpers/subscription-entries'
import { useTabContext } from '../tabs/TabContext'

let cachedCandidates = null
const CACHE_LIFETIME = 15 * 60 * 1000

/** @param {import('vue').ComputedRef<boolean>} visible */
export function useHomeRecommendations(visible) {
  let candidates = []
  let generation = 0
  let rankingGeneration = 0
  let requestController = null
  let initialized = false
  let restoringCachedFeed = false
  let round = 0
  let limit = 24
  let feedId = crypto.randomUUID()
  const ranked = shallowRef([])
  const isLoading = ref(false)
  const feedVersion = ref(0)
  const hasError = ref(false)
  const { isTabPresented } = useTabContext()
  const presented = computed(() => isTabPresented?.value ?? true)
  const enabled = computed(() => store.getters.getEnableHomeRecommendations)
  const history = computed(() => store.getters.getHistoryCacheSorted)
  const libraryInputs = shallowRef({ history: [], favorites: [], saved: [] })
  const eligibleHistory = computed(() => process.env.IS_ELECTRON ? libraryInputs.value.history : getRecommendationLearningEntries(history.value, isVisible))
  const favorites = computed(() => process.env.IS_ELECTRON ? libraryInputs.value.favorites : getRecommendationLearningEntries(store.getters.getPlaylist('favorites')?.videos ?? [], isVisible, 500))
  const saved = computed(() => process.env.IS_ELECTRON ? libraryInputs.value.saved : getRecommendationLearningEntries(savedPlaylistVideos(), isVisible, 500))
  function * savedPlaylistVideos() {
    for (const playlist of store.getters.getAllPlaylists) {
      if (playlist._id !== 'favorites') yield * playlist.videos
    }
  }
  const subscriptions = computed(() => recommendationSubscriptionIds(store.getters.getActiveProfile?.subscriptions))
  const exploration = computed(() => Math.max(0, Math.min(0.5, Number(store.getters.getRecommendationExploration) || 0)))
  const records = computed(() => store.getters.getRecommendationRecords.filter(isVisible))
  const hasSeeds = computed(() => store.getters.getRememberHistory && (
    history.value.some(isVisible) || favorites.value.length > 0 || saved.value.length > 0 ||
    (process.env.IS_ELECTRON && (store.state.history.historyTotal > 0 || store.getters.getAllPlaylists.some(playlist => playlist.videoCount > 0))) ||
    records.value.some(record => record.feedback === 'positive') || subscriptions.value.length > 0
  ))
  // Dismissals affect the next ranking; channel blocks still hide cards immediately.
  const blockedChannelIds = computed(() => new Set(records.value
    .filter(record => record.feedback === 'blockChannel').map(record => record.authorId)))
  const visibleRanked = computed(previous => {
    const videos = ranked.value.filter(video => {
      const record = store.state.recommendations.recommendationRecords[video.videoId]
      return isVisible(video) && record?.feedback !== 'blockChannel' && !blockedChannelIds.value.has(video.authorId)
    })
    // Impression updates replace feedback records without changing the feed.
    // Retain its identity so they cannot rerender every card and shelf.
    return previous && videos.length === previous.length && videos.every((video, index) => video === previous[index])
      ? previous
      : videos
  })
  // Keep an existing feed usable when feedback removes its last positive seed.
  const hasHistory = computed(() => store.getters.getRememberHistory &&
    (hasSeeds.value || visibleRanked.value.length > 0))
  const recommendations = computed(() => enabled.value && hasHistory.value ? visibleRanked.value : [])

  function isVisible(video) {
    return video != null && typeof video === 'object' &&
      !shouldHideMembersOnlyContent(video.isMembersOnly, store.getters) &&
      !isVideoHiddenByPreferences(video, {
        hideLiveStreams: store.getters.getHideLiveStreams,
        hideUpcomingPremieres: store.getters.getHideUpcomingPremieres,
        hiddenChannelNames: store.getters.getActiveChannelsHiddenNames,
        forbiddenTitles: store.getters.getActiveForbiddenTitles,
      })
  }
  async function makeProfile(isCancelled) {
    if (process.env.IS_ELECTRON) {
      const inputs = await DBLibraryHandlers.query('recommendationInputs', {
        preferences: {
          hideLiveStreams: store.getters.getHideLiveStreams,
          hideUpcomingPremieres: store.getters.getHideUpcomingPremieres,
          hiddenChannelNames: [...(store.getters.getActiveChannelsHiddenNames ?? [])],
          forbiddenTitles: store.getters.getActiveForbiddenTitles,
          restrictedPlaybackConfigured: !shouldHideMembersOnlyContent(true, store.getters)
        }
      })
      if (isCancelled()) return null
      libraryInputs.value = inputs
    }
    // Snapshot only the bounded learning inputs. Do not track every field of
    // every history record while Home mounts or serialize the entire library.
    const inputGroups = { history: eligibleHistory.value, records: records.value, favorites: favorites.value, saved: saved.value }
    function * snapshotInputs() {
      const inputs = {}
      for (const [name, videos] of Object.entries(inputGroups)) {
        inputs[name] = []
        for (const video of videos) {
          inputs[name].push({ ...toRaw(video) })
          yield
        }
      }
      return inputs
    }
    const snapshots = await runCooperatively(snapshotInputs(), isCancelled)
    if (!snapshots) return null
    return buildRecommendationProfileAsync(snapshots.history, {
      records: snapshots.records, favorites: snapshots.favorites, saved: snapshots.saved, subscriptions: subscriptions.value, round,
    }, isCancelled)
  }
  async function rerank(profile = null) {
    if (!visible.value || !enabled.value) return
    const currentRanking = ++rankingGeneration
    const isCancelled = () => currentRanking !== rankingGeneration
    profile ??= await makeProfile(isCancelled)
    if (!profile || isCancelled()) return
    // An impression must affect the next feed, not remove a card under the pointer.
    const learned = {
      ...profile,
      evidence: new Map([...profile.evidence].map(([id, record]) => [id, record.lastFeedId === feedId
        ? { ...record, impressions: record.impressions?.slice(0, -1) }
        : record]))
    }
    const watched = new Set()
    if (process.env.IS_ELECTRON) {
      for (let offset = 0; offset < candidates.length; offset += 250) {
        const state = await DBLibraryHandlers.query('videoState', { ids: candidates.slice(offset, offset + 250).map(video => video.videoId) })
        if (isCancelled()) return
        state.history.forEach(video => watched.add(video.videoId))
      }
    }
    const result = await rankRecommendationCandidatesAsync(candidates.filter(video => isVisible(video) &&
      !watched.has(video.videoId) && !store.getters.getHistoryCacheById[video.videoId]), learned, { limit, exploration: exploration.value }, isCancelled)
    if (!result || isCancelled()) return
    // History can change while ranking yields to the event loop.
    ranked.value = result.filter(item => !store.getters.getHistoryCacheById[item.video.videoId])
      .map(item => ({ ...item.video, recommendationReason: item.reason }))
  }
  const sourceIdentity = videos => videos.map(video => [video.videoId, video.timeWatched, video.title])
  // This identifies reusable candidates when opening Home, not a reason to
  // replace a feed that is already on screen.
  const context = computed(() => JSON.stringify({
    visible: visible.value,
    enabled: enabled.value,
    rememberHistory: store.getters.getRememberHistory,
    history: sourceIdentity(eligibleHistory.value),
    favorites: sourceIdentity(favorites.value),
    saved: sourceIdentity(saved.value),
    subscriptions: subscriptions.value,
    feedback: records.value.filter(record => record.feedback).map(record => [record.videoId, record.feedback, record.feedbackAt]),
    epoch: store.getters.getRecommendationEpoch,
    backend: store.getters.getBackendPreference,
    fallback: store.getters.getBackendFallback,
    instance: store.getters.getCurrentInvidiousInstanceUrl,
    authorization: store.getters.getCurrentInvidiousInstanceAuthorization,
    familyFriendly: store.getters.getShowFamilyFriendlyOnly,
  }))
  const rankingContext = computed(() => JSON.stringify({
    exploration: exploration.value,
    blockLists: store.getters.getEnableBlockLists,
    hideLiveStreams: store.getters.getHideLiveStreams,
    hideUpcomingPremieres: store.getters.getHideUpcomingPremieres,
    hiddenChannels: [...(store.getters.getActiveChannelsHiddenNames ?? [])],
    forbiddenTitles: store.getters.getActiveForbiddenTitles,
    hideMembersOnly: shouldHideMembersOnlyContent(true, store.getters),
  }))
  function nextVisibilityChange() {
    if (!store.getters.getHideUpcomingPremieres) return Infinity
    const now = Date.now()
    let next = Infinity
    for (const video of candidates) {
      const timestamp = getUpcomingPremiereTimestamp(video)
      if (timestamp != null && timestamp > now) next = Math.min(next, timestamp)
    }
    return next
  }

  async function refresh(useCache = false, append = false) {
    cancelRequest()
    const requestGeneration = generation
    hasError.value = false
    if (!visible.value || !enabled.value || !store.getters.getRememberHistory) {
      clearFeed()
      return
    }
    if (!presented.value) return
    if (!append) initialized = false
    if (!store.getters.getRecommendationEpoch) {
      try { await store.dispatch('loadRecommendations') } catch { hasError.value = true }
      if (requestGeneration !== generation || !store.getters.getRecommendationEpoch) return
    }
    if (!hasSeeds.value) {
      if (!append) clearFeed()
      return
    }
    // Restore the completed feed before showing a loader. Reopening Home must
    // not rebuild the learning profile or rank the same candidates again.
    const cache = useCache && !append && cachedCandidates && Date.now() - cachedCandidates.at < CACHE_LIFETIME &&
      cachedCandidates.context === context.value
      ? cachedCandidates
      : null
    if (cache) {
      candidates = cache.videos; feedId = cache.feedId; round = cache.round; limit = cache.limit
      if (cache.rankingContext === rankingContext.value && Date.now() < cache.nextVisibilityChange) {
        ranked.value = cache.ranked
        initialized = true
        return
      }
    }
    restoringCachedFeed = Boolean(cache)
    isLoading.value = true
    // Vue's nextTick alone only flushes the DOM; let Chromium paint it before
    // preparing the learning inputs and starting the cooperative batches.
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
    if (requestGeneration !== generation) return
    const requestContext = context.value
    const requestRankingContext = rankingContext.value
    if (cache) {
      // Candidate-only preference changes need a new ranking, not new requests.
      const visibilityChange = nextVisibilityChange()
      await rerank()
      if (requestGeneration !== generation) return
      cachedCandidates = { ...cache, ranked: ranked.value, rankingContext: requestRankingContext, nextVisibilityChange: visibilityChange }
      restoringCachedFeed = false
      isLoading.value = false
      initialized = true
      return
    }
    if (!append) {
      limit = 24
      candidates = []; ranked.value = []; feedId = crypto.randomUUID(); feedVersion.value++
    } else limit = Math.min(96, limit + 24)
    if (!useCache) round++
    cachedCandidates = null
    const learned = await makeProfile(() => generation !== requestGeneration)
    if (!learned || generation !== requestGeneration) return
    if (!learned.channels.length) learned.channels = subscriptions.value.slice(0, 3)
    const subscriptionIds = new Set(subscriptions.value)
    let subscriptionCandidates
    if (process.env.IS_ELECTRON) {
      const channels = [...subscriptionIds].toSorted((a, b) => (learned.channelWeights.get(b) ?? 0) - (learned.channelWeights.get(a) ?? 0)).slice(0, 12)
      subscriptionCandidates = await DBLibraryHandlers.query('recommendationSubscriptionCandidates', { channelIds: channels })
      if (requestGeneration !== generation) return
    } else {
      subscriptionCandidates = Object.entries(store.getters.getVideoCache)
        .filter(([id]) => subscriptionIds.has(id))
        .toSorted(([a], [b]) => (learned.channelWeights.get(b) ?? 0) - (learned.channelWeights.get(a) ?? 0))
        .slice(0, 12).flatMap(([id, entry]) => (entry.videos ?? []).slice(0, 30)
          .map(video => ({ ...video, recommendationSources: [{ type: 'subscription', id }] })))
    }
    candidates = mergeRecommendationCandidates([...candidates, ...subscriptionCandidates])
    requestController = new AbortController()
    const signal = requestController.signal
    const backend = process.env.SUPPORTS_LOCAL_API ? store.getters.getBackendPreference : 'invidious'
    const fallback = store.getters.getBackendFallback && process.env.SUPPORTS_LOCAL_API
    const familyFriendly = store.getters.getShowFamilyFriendlyOnly
    const searchSettings = { type: 'video', time: '', duration: '', features: [], prioritize: 'relevance' }
    const result = await collectRecommendationCandidates(learned, {
      fetchRelated: (id, signal) => withFallback(() => getLocalRelatedVideos(id, familyFriendly, signal), () => getInvidiousRelatedVideos(id, signal), signal),
      fetchChannel: async (id, signal) => (await withFallback(
        () => getLocalChannelVideos(id, familyFriendly, signal),
        () => getInvidiousChannelVideos(id, 'newest', undefined, { signal, enrichPublicationDates: false }), signal
      ))?.videos ?? [],
      search: (query, signal) => withFallback(
        async () => (await getLocalSearchResults(query, searchSettings, familyFriendly, signal)).results,
        () => getInvidiousSearchResults(query, 1, searchSettings, signal), signal
      ),
      isCancelled: () => generation !== requestGeneration,
      signal,
    })
    if (generation !== requestGeneration) return
    // Publish one completed ranking so each source response cannot reshuffle
    // cards while the user is choosing a video.
    candidates = mergeRecommendationCandidates([...candidates, ...result.videos]).slice(0, 1600)
    const visibilityChange = nextVisibilityChange()
    await rerank(learned)
    if (generation !== requestGeneration) return
    initialized = true
    hasError.value = result.failedSources > 0
    isLoading.value = false
    if (!hasError.value) {
      cachedCandidates = {
        context: requestContext,
        rankingContext: requestRankingContext,
        videos: candidates,
        ranked: ranked.value,
        feedId,
        round,
        limit,
        at: Date.now(),
        nextVisibilityChange: visibilityChange,
      }
    }
    function withFallback(local, invidious, signal) {
      return fetchRecommendationSource(backend === 'local' ? local : invidious,
        fallback ? (backend === 'local' ? invidious : local) : null, signal)
    }
  }
  async function feedback(video, type) {
    try {
      await store.dispatch('recordRecommendationEvent', { video, type })
    } catch { hasError.value = true }
  }
  function recordImpression(video, visible, entry) {
    if (!visible || !presented.value || !enabled.value || entry?.target.closest('[aria-hidden="true"]')) return
    store.dispatch('recordRecommendationEvent', { type: 'impression', video, feedId }).catch(() => { hasError.value = true })
  }
  function cancelRequest() {
    generation++
    rankingGeneration++
    requestController?.abort()
    requestController = null
    restoringCachedFeed = false
    isLoading.value = false
  }
  function clearFeed() {
    initialized = false
    candidates = []; ranked.value = []; cachedCandidates = null
  }
  // Load persisted feedback before deciding whether there are any seeds.
  const available = computed(() => visible.value && enabled.value && store.getters.getRememberHistory &&
    (hasHistory.value || !store.getters.getRecommendationEpoch))
  watch([available, presented], () => {
    if (!available.value) {
      cancelRequest()
      clearFeed()
    } else if (!presented.value) {
      cancelRequest()
    } else if (!initialized) {
      refresh(true)
    }
  }, { immediate: true })
  // Revoking learning or changing the backend cancels obsolete requests.
  // A completed feed stays put; the next explicit refresh uses the new context.
  watch([
    () => store.getters.getRecommendationEpoch,
    () => store.getters.getBackendPreference,
    () => store.getters.getBackendFallback,
    () => store.getters.getCurrentInvidiousInstanceUrl,
    () => store.getters.getCurrentInvidiousInstanceAuthorization,
    () => store.getters.getShowFamilyFriendlyOnly,
  ], () => {
    cachedCandidates = null
    if (isLoading.value) {
      cancelRequest()
      if (!initialized) refresh(true)
    }
  })
  watch([() => history.value.length === 0, () => store.getters.getRecommendationEpoch],
    ([empty, epoch], [wasEmpty, previousEpoch]) => {
      if (!empty || (wasEmpty && (!previousEpoch || epoch === previousEpoch))) return
      // Clearing history also discards its visible suggestions when favorites
      // or subscriptions still supply seeds. Only Refresh should replace them.
      cancelRequest()
      clearFeed()
      initialized = available.value
    })
  function updateRanking() {
    // Supersede the entire cached restore so a cancelled ranking cannot publish
    // an empty feed while the replacement ranking is still running.
    if (restoringCachedFeed) refresh(true)
    else rerank()
  }
  watch(exploration, updateRanking)
  watch(() => store.getters.getEnableBlockLists, updateRanking)
  onBeforeUnmount(cancelRequest)
  return {
    enabled,
    hasHistory,
    hasSeeds,
    isLoading,
    hasError,
    recommendations,
    exploration,
    feedVersion,
    refresh: () => refresh(),
    loadMore: () => refresh(false, true),
    feedback,
    recordImpression,
    setExploration: value => store.dispatch('updateRecommendationExploration', Number(value)),
    reset: async () => { await store.dispatch('resetRecommendations'); await refresh() },
    setEnabled: value => store.dispatch('updateEnableHomeRecommendations', value),
  }
}
