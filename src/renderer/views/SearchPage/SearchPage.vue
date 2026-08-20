<template>
  <div>
    <FtLoader
      v-if="isLoading"
      :fullscreen="true"
    />
    <FtCard
      v-else
      class="card"
    >
      <h2>
        <FtIcon
          :icon="['fas', 'search']"
          class="headingIcon"
        />
        {{ t("Search Filters.Search Results") }}
      </h2>
      <FtElementList
        :data="shownResults"
      />
      <FtAutoLoadNextPageWrapper
        v-if="hasMoreResults"
        :loading="isLoadingMore"
        @load-next-page="nextPage"
      >
        <div
          class="getNextPage"
          role="button"
          tabindex="0"
          @click="nextPage"
          @keydown.enter.space.prevent="nextPage"
        >
          <FtIcon :icon="['fas', 'search']" /> {{ t("Search Filters.Fetch more results") }}
        </div>
      </FtAutoLoadNextPageWrapper>
      <p
        v-else
        class="searchStatus"
        role="status"
      >
        {{ exhaustedSearchMessage }}
      </p>
    </FtCard>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'

import store from '../../store'

import {
  searchFiltersMatch,
  showApiErrorToast,
  showToast,
} from '../../helpers/utils'
import {
  extractLocalCacheableSearchContinuation,
  getLocalSearchContinuation,
  getLocalSearchResults
} from '../../helpers/api/local'
import { getInvidiousSearchResults } from '../../helpers/api/invidious'
import { SEARCH_CHAR_LIMIT } from '../../../constants'
import { useTabContext, useTabTitle } from '../../tabs/TabContext'

const { t } = useI18n()
const route = useRoute()
const { tabId: injectedTabId } = useTabContext()
const tabId = injectedTabId ?? 'web'
const setTabTitle = useTabTitle()

const isLoading = ref(false)
const isLoadingMore = ref(false)
const hasMoreResults = ref(true)
const apiUsed = ref('local')
const searchSettings = ref({})
const searchPage = ref(1)
/** @type {import('vue').ShallowRef<import('youtubei.js').YT.Search | string | null>} */
const nextPageRef = shallowRef(null)
const shownResults = shallowRef([])
let requestGeneration = 0

const query = ref('')
const processedQuery = computed(() => query.value.trim())
const exhaustedSearchMessage = computed(() => shownResults.value.length === 0
  ? t('Channel.Your search results have returned 0 results')
  : t('Search Filters.There are no more results for this search'))

/** @type {import('vue').ComputedRef<any[]>} */
const sessionSearchHistory = computed(() => store.getters.getSessionSearchHistory)

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

/** @type {import('vue').ComputedRef<boolean>} */
const showFamilyFriendlyOnly = computed(() => store.getters.getShowFamilyFriendlyOnly)

/** @type {import('vue').ComputedRef<boolean>} */
const rememberSearchHistory = computed(() => store.getters.getRememberSearchHistory)

function restoreActiveSearchFilters(settings) {
  store.commit('setSearchPrioritize', { tabId, value: settings.prioritize })
  store.commit('setSearchTime', { tabId, value: settings.time })
  store.commit('setSearchType', { tabId, value: settings.type })
  store.commit('setSearchDuration', { tabId, value: settings.duration })
  store.commit('setSearchFeatures', { tabId, value: [...settings.features] })
  store.commit('setSearchFilterValueChanged', {
    tabId,
    value: settings.prioritize !== 'relevance' ||
    settings.time !== '' ||
    settings.type !== 'all' ||
    settings.duration !== '' ||
    settings.features.length > 0
  })
}

function getRouteSearchSettings() {
  let features = route.query.features
  // if page gets refreshed and there's only one feature then it will be a string
  if (typeof features === 'string') {
    features = [features]
  }

  return {
    prioritize: route.query.prioritize ?? 'relevance',
    time: route.query.time ?? '',
    type: route.query.type ?? 'all',
    duration: route.query.duration ?? '',
    features: features ?? [],
  }
}

watch(route, startSearch, { deep: true })
onMounted(startSearch)
onBeforeUnmount(() => { requestGeneration++ })

function isCurrentRequest(generation) {
  return generation === requestGeneration
}

function resetSearchState(settings) {
  isLoading.value = false
  isLoadingMore.value = false
  hasMoreResults.value = false
  apiUsed.value = backendPreference.value
  searchSettings.value = settings
  searchPage.value = 1
  nextPageRef.value = null
  shownResults.value = []
}

function startSearch() {
  if (typeof route.params.query !== 'string') {
    requestGeneration++
    return
  }

  const routeSearchSettings = getRouteSearchSettings()
  const payload = {
    query: route.params.query.trim(),
    options: {},
    searchSettings: routeSearchSettings
  }
  const generation = ++requestGeneration

  resetSearchState(routeSearchSettings)
  query.value = payload.query
  restoreActiveSearchFilters(routeSearchSettings)

  if (!isCurrentRequest(generation)) {
    return
  }
  setTabTitle(payload.query)
  checkSearchCache(payload, generation)
}

function updateSearchHistoryEntry(payload, generation) {
  if (!isCurrentRequest(generation)) {
    return
  }

  const persistentSearchHistoryPayload = {
    _id: payload.query,
    lastUpdatedAt: Date.now(),
    searchSettings: {
      prioritize: payload.searchSettings.prioritize,
      time: payload.searchSettings.time,
      type: payload.searchSettings.type,
      duration: payload.searchSettings.duration,
      features: [...payload.searchSettings.features]
    }
  }

  store.dispatch('updateSearchHistoryEntry', persistentSearchHistoryPayload)
}

function checkSearchCache(payload, generation) {
  if (!isCurrentRequest(generation)) {
    return
  }

  if (payload.query.length > SEARCH_CHAR_LIMIT) {
    console.warn(`Search character limit is: ${SEARCH_CHAR_LIMIT}`)
    showToast({
      message: t('Search character limit', { searchCharacterLimit: SEARCH_CHAR_LIMIT }),
      icon: ['fas', 'circle-exclamation'],
    })
    return
  }

  const sameSearch = sessionSearchHistory.value.filter((search) => {
    return search.query === payload.query && searchFiltersMatch(payload.searchSettings, search.searchSettings)
  })

  if (sameSearch.length > 0) {
    // No loading effect needed here, only rendered result update
    replaceShownResults(sameSearch[0], generation)
  } else {
    // Show loading effect coz there will be network request(s)
    isLoading.value = true
    hasMoreResults.value = true
    searchSettings.value = payload.searchSettings

    switch (backendPreference.value) {
      case 'local':
        performSearchLocal(payload, generation)
        break
      case 'invidious':
        performSearchInvidious(payload, generation, { resetSearchPage: true })
        break
    }
  }

  if (rememberSearchHistory.value) {
    updateSearchHistoryEntry(payload, generation)
  }
}

async function performSearchLocal(payload, generation) {
  if (!isCurrentRequest(generation)) {
    return
  }
  isLoading.value = true

  try {
    const { results, continuationData } = await getLocalSearchResults(
      payload.query,
      payload.searchSettings,
      showFamilyFriendlyOnly.value
    )
    if (!isCurrentRequest(generation)) {
      return
    }

    apiUsed.value = 'local'

    shownResults.value = results
    nextPageRef.value = continuationData
    hasMoreResults.value = results.length > 0 && continuationData != null

    const historyPayload = {
      query: payload.query,
      data: shownResults.value,
      searchSettings: payload.searchSettings,
      nextPageRef: nextPageRef.value ? extractLocalCacheableSearchContinuation(nextPageRef.value) : null,
      hasMoreResults: hasMoreResults.value,
      apiUsed: apiUsed.value
    }

    store.commit('addToSessionSearchHistory', historyPayload)

    updateSubscriptionDetails(results)
  } catch (err) {
    if (!isCurrentRequest(generation)) {
      return
    }
    console.error(err)

    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      resetSearchState(payload.searchSettings)
      await performSearchInvidious(payload, generation, { resetSearchPage: true })
    }
  } finally {
    if (isCurrentRequest(generation)) {
      isLoading.value = false
    }
  }
}

async function getNextpageLocal(payload, generation) {
  try {
    const { results, continuationData } = await getLocalSearchContinuation(payload.options.nextPageRef)
    if (!isCurrentRequest(generation)) {
      return
    }

    nextPageRef.value = continuationData
    hasMoreResults.value = results.length > 0 && continuationData != null

    apiUsed.value = 'local'

    shownResults.value = shownResults.value.concat(results)
    const historyPayload = {
      query: payload.query,
      data: shownResults.value,
      searchSettings: payload.searchSettings,
      nextPageRef: nextPageRef.value ? extractLocalCacheableSearchContinuation(nextPageRef.value) : null,
      hasMoreResults: hasMoreResults.value,
      apiUsed: apiUsed.value
    }

    store.commit('addToSessionSearchHistory', historyPayload)

    updateSubscriptionDetails(results)
  } catch (err) {
    if (!isCurrentRequest(generation)) {
      return
    }
    console.error(err)

    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      resetSearchState(payload.searchSettings)
      await performSearchInvidious(payload, generation, { resetSearchPage: true })
    }
  }
}

async function performSearchInvidious(payload, generation, { resetSearchPage = false } = {}) {
  if (!isCurrentRequest(generation)) {
    return
  }

  const requestedPage = resetSearchPage ? 1 : searchPage.value
  if (resetSearchPage) {
    searchPage.value = requestedPage
  }

  if (requestedPage === 1) {
    isLoading.value = true
  }

  try {
    const results = await getInvidiousSearchResults(payload.query, requestedPage, payload.searchSettings)
    if (!isCurrentRequest(generation)) {
      return
    }
    if (!results) {
      hasMoreResults.value = false
      return
    }

    hasMoreResults.value = results.length > 0

    apiUsed.value = 'invidious'

    if (requestedPage !== 1) {
      shownResults.value = shownResults.value.concat(results)
    } else {
      shownResults.value = results
    }

    searchPage.value = requestedPage + 1

    const historyPayload = {
      query: payload.query,
      data: shownResults.value,
      searchSettings: payload.searchSettings,
      searchPage: searchPage.value,
      hasMoreResults: hasMoreResults.value,
      apiUsed: apiUsed.value
    }

    store.commit('addToSessionSearchHistory', historyPayload)

    updateSubscriptionDetails(results)
  } catch (err) {
    if (!isCurrentRequest(generation)) {
      return
    }
    console.error(err)

    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (process.env.SUPPORTS_LOCAL_API && backendPreference.value === 'invidious' && backendFallback.value) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      resetSearchState(payload.searchSettings)
      await performSearchLocal(payload, generation)
    }
  } finally {
    if (isCurrentRequest(generation) && requestedPage === 1) {
      isLoading.value = false
    }
  }
}

async function nextPage() {
  if (isLoadingMore.value) {
    return
  }
  const generation = requestGeneration
  if (!isCurrentRequest(generation)) {
    return
  }

  const payload = {
    query: processedQuery.value,
    searchSettings: searchSettings.value,
    options: {
      nextPageRef: nextPageRef.value
    }
  }

  if (apiUsed.value === 'local') {
    if (nextPageRef.value !== null) {
      isLoadingMore.value = true
      try {
        await getNextpageLocal(payload, generation)
      } finally {
        if (isCurrentRequest(generation)) {
          isLoadingMore.value = false
        }
      }
    } else {
      showToast({ message: t('Search Filters.There are no more results for this search'), icon: ['fas', 'search'] })
    }
  } else {
    isLoadingMore.value = true
    try {
      await performSearchInvidious(payload, generation)
    } finally {
      if (isCurrentRequest(generation)) {
        isLoadingMore.value = false
      }
    }
  }
}

function replaceShownResults(history, generation) {
  if (!isCurrentRequest(generation)) {
    return
  }
  query.value = history.query
  shownResults.value = history.data
  searchSettings.value = history.searchSettings
  apiUsed.value = history.apiUsed
  nextPageRef.value = history.nextPageRef ?? null
  hasMoreResults.value = history.hasMoreResults ?? (
    history.apiUsed === 'local' ? nextPageRef.value !== null : true
  )

  searchPage.value = history.searchPage ?? 1

  isLoading.value = false
  isLoadingMore.value = false
}

/**
 * @param {any[]} results
 */
function updateSubscriptionDetails(results) {
  /** @type {Set<string>} */
  const subscribedChannelIds = store.getters.getSubscribedChannelIdSet

  const channels = []

  for (const result of results) {
    if (result.type !== 'channel' || !subscribedChannelIds.has(result.id ?? result.authorId)) {
      continue
    }

    if (result.dataSource === 'local') {
      channels.push({
        channelId: result.id,
        channelName: result.name,
        channelThumbnailUrl: result.thumbnail.replace(/^\/\//, 'https://')
      })
    } else {
      channels.push({
        channelId: result.authorId,
        channelName: result.author,
        channelThumbnailUrl: result.authorThumbnails[0].url.replace(/^\/\//, 'https://')
      })
    }
  }

  if (channels.length === 1) {
    store.dispatch('updateSubscriptionDetails', channels[0])
  } else if (channels.length > 1) {
    store.dispatch('batchUpdateSubscriptionDetails', channels)
  }
}
</script>

<style scoped src="./SearchPage.css" />
