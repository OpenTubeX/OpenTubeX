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
      <div
        v-if="searchNotice"
        class="searchNotice"
        role="status"
      >
        <h3>{{ searchNotice.title }}</h3>
        <p>{{ searchNotice.body }}</p>
        <template v-if="searchNotice.requiresAuthentication && supportsCookieSearch && !showFamilyFriendlyOnly">
          <p v-if="!cookiesConfigured">
            {{ t('Video.Configure Restricted Playback Cookies Hint') }}
          </p>
          <FtButton
            v-else
            class="searchRetryButton"
            :label="t('Video.Try With Configured Cookies')"
            :icon="['fas', 'cookie']"
            :disabled="isRetryingWithCookies"
            @click="retrySearchWithCookies"
          />
          <p v-if="isRetryingWithCookies">
            {{ t('Search Filters["Fetching results. Please wait"]') }}
          </p>
        </template>
      </div>
      <p
        v-if="cookieSearchFailed"
        class="searchStatus"
        role="alert"
      >
        {{ t('Search Filters.Cookie Search Failed') }}
      </p>
      <FtButton
        v-if="cookieSearchFailed && !searchNotice && cookiesConfigured && !showFamilyFriendlyOnly"
        class="searchRetryButton"
        :label="t('Video.Try With Configured Cookies')"
        :icon="['fas', 'cookie']"
        :disabled="isRetryingWithCookies"
        @click="retrySearchWithCookies"
      />
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
        v-else-if="!searchNotice && !cookieSearchFailed"
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
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
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
import { ytDlp } from '../../helpers/ytDlp'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'

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
const searchNotice = shallowRef(null)
const searchParams = ref('')
const isRetryingWithCookies = ref(false)
const cookieSearchFailed = ref(false)
const supportsCookieSearch = !!process.env.IS_ELECTRON
const cookiesConfigured = computed(() => hasConfiguredRestrictedPlaybackAuthentication(store.getters, supportsCookieSearch))
let searchRequestId = 0

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

watch(route, () => {
  const query_ = route.params.query.trim()
  const searchSettings = getRouteSearchSettings()

  const payload = {
    query: query_,
    options: {},
    searchSettings: searchSettings
  }

  query.value = query_
  restoreActiveSearchFilters(searchSettings)

  setTabTitle(processedQuery.value)
  checkSearchCache(payload)
}, { deep: true })

onMounted(() => {
  query.value = route.params.query
  setTabTitle(processedQuery.value)

  searchSettings.value = getRouteSearchSettings()
  restoreActiveSearchFilters(searchSettings.value)

  const payload = {
    query: processedQuery.value,
    options: {},
    searchSettings: searchSettings.value
  }

  checkSearchCache(payload)
})

function updateSearchHistoryEntry(searchSettings) {
  const persistentSearchHistoryPayload = {
    query: processedQuery.value,
    lastUpdatedAt: Date.now(),
    searchSettings: {
      prioritize: searchSettings.prioritize,
      time: searchSettings.time,
      type: searchSettings.type,
      duration: searchSettings.duration,
      features: [...searchSettings.features]
    }
  }

  store.dispatch('updateSearchHistoryEntry', persistentSearchHistoryPayload)
}

function checkSearchCache(payload) {
  if (payload.query.length > SEARCH_CHAR_LIMIT) {
    console.warn(`Search character limit is: ${SEARCH_CHAR_LIMIT}`)
    showToast({
      message: t('Search character limit', { searchCharacterLimit: SEARCH_CHAR_LIMIT }),
      icon: ['fas', 'circle-exclamation'],
    })
    return
  }

  searchRequestId++
  searchNotice.value = null
  searchParams.value = ''
  cookieSearchFailed.value = false
  isRetryingWithCookies.value = false
  isLoadingMore.value = false

  const sameSearch = sessionSearchHistory.value.filter((search) => {
    return search.query === payload.query && searchFiltersMatch(payload.searchSettings, search.searchSettings)
  })

  if (sameSearch.length > 0) {
    // No loading effect needed here, only rendered result update
    replaceShownResults(sameSearch[0])
  } else {
    // Show loading effect coz there will be network request(s)
    isLoading.value = true
    hasMoreResults.value = true
    searchSettings.value = payload.searchSettings

    switch (backendPreference.value) {
      case 'local':
        performSearchLocal(payload)
        break
      case 'invidious':
        performSearchInvidious(payload, { resetSearchPage: true })
        break
    }
  }

  if (rememberSearchHistory.value) {
    updateSearchHistoryEntry(payload.searchSettings)
  }
}

async function performSearchLocal(payload) {
  isLoading.value = true
  const requestId = searchRequestId

  try {
    const response = await getLocalSearchResults(
      payload.query,
      payload.searchSettings,
      showFamilyFriendlyOnly.value
    )
    if (requestId !== searchRequestId) return
    const { results, continuationData } = response
    searchNotice.value = response.searchNotice
    searchParams.value = response.searchParams

    apiUsed.value = 'local'

    shownResults.value = results
    nextPageRef.value = continuationData
    hasMoreResults.value = results.length > 0 && continuationData != null

    isLoading.value = false

    const historyPayload = {
      query: payload.query,
      data: shownResults.value,
      searchSettings: searchSettings.value,
      nextPageRef: nextPageRef.value ? extractLocalCacheableSearchContinuation(nextPageRef.value) : null,
      hasMoreResults: hasMoreResults.value,
      searchNotice: searchNotice.value,
      searchParams: searchParams.value,
      apiUsed: apiUsed.value
    }

    store.commit('addToSessionSearchHistory', historyPayload)

    updateSubscriptionDetails(results)
  } catch (err) {
    if (requestId !== searchRequestId) return
    console.error(err)

    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      await performSearchInvidious(payload)
    } else {
      isLoading.value = false
    }
  }
}

async function retrySearchWithCookies() {
  if (!cookiesConfigured.value || isRetryingWithCookies.value || showFamilyFriendlyOnly.value) return
  if (apiUsed.value !== 'yt-dlp') searchPage.value = 1
  await performSearchWithCookies()
}

async function performSearchWithCookies() {
  const requestId = searchRequestId
  const page = searchPage.value
  isRetryingWithCookies.value = true
  cookieSearchFailed.value = false
  try {
    const response = await ytDlp.ytDlpSearch(processedQuery.value, searchParams.value, page)
    if (requestId !== searchRequestId) return
    if (!response || response.error || (page === 1 && response.results.length === 0)) {
      throw new Error('Authenticated search failed')
    }
    searchNotice.value = null
    shownResults.value = page === 1 ? response.results : shownResults.value.concat(response.results)
    apiUsed.value = 'yt-dlp'
    hasMoreResults.value = response.hasMoreResults
    nextPageRef.value = null
    searchPage.value++
    // Account-derived results stay in this tab and do not enter the shared cache.
    updateSubscriptionDetails(response.results)
  } catch {
    if (requestId === searchRequestId) {
      cookieSearchFailed.value = true
      if (page > 1) hasMoreResults.value = false
    }
  } finally {
    if (requestId === searchRequestId) isRetryingWithCookies.value = false
  }
}

async function getNextpageLocal(payload) {
  try {
    const { results, continuationData } = await getLocalSearchContinuation(payload.options.nextPageRef)

    nextPageRef.value = continuationData
    hasMoreResults.value = results.length > 0 && continuationData != null

    apiUsed.value = 'local'

    shownResults.value = shownResults.value.concat(results)
    const historyPayload = {
      query: payload.query,
      data: shownResults.value,
      searchSettings: searchSettings.value,
      nextPageRef: nextPageRef.value ? extractLocalCacheableSearchContinuation(nextPageRef.value) : null,
      hasMoreResults: hasMoreResults.value,
      apiUsed: apiUsed.value
    }

    store.commit('addToSessionSearchHistory', historyPayload)

    updateSubscriptionDetails(results)
  } catch (err) {
    console.error(err)

    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      await performSearchInvidious(payload)
    } else {
      isLoading.value = false
    }
  }
}

async function performSearchInvidious(payload, options = { resetSearchPage: false }) {
  if (options.resetSearchPage) {
    searchPage.value = 1
  }

  if (searchPage.value === 1) {
    isLoading.value = true
  }

  try {
    const results = await getInvidiousSearchResults(payload.query, searchPage.value, payload.searchSettings)
    if (!results) {
      return
    }

    hasMoreResults.value = results.length > 0

    apiUsed.value = 'invidious'

    if (searchPage.value !== 1) {
      shownResults.value = shownResults.value.concat(results)
    } else {
      shownResults.value = results
    }

    isLoading.value = false

    searchPage.value++

    const historyPayload = {
      query: payload.query,
      data: shownResults.value,
      searchSettings: searchSettings.value,
      searchPage: searchPage.value,
      hasMoreResults: hasMoreResults.value,
      apiUsed: apiUsed.value
    }

    store.commit('addToSessionSearchHistory', historyPayload)

    updateSubscriptionDetails(results)
  } catch (err) {
    console.error(err)

    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, err)

    if (process.env.SUPPORTS_LOCAL_API && backendPreference.value === 'invidious' && backendFallback.value) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      await performSearchLocal(payload)
    } else {
      isLoading.value = false
      // TODO: Show toast with error message
    }
  }
}

async function nextPage() {
  if (isLoadingMore.value) {
    return
  }

  const payload = {
    query: processedQuery.value,
    searchSettings: searchSettings.value,
    options: {
      nextPageRef: nextPageRef.value
    }
  }

  if (apiUsed.value === 'yt-dlp') {
    isLoadingMore.value = true
    await performSearchWithCookies()
    isLoadingMore.value = false
  } else if (apiUsed.value === 'local') {
    if (nextPageRef.value !== null) {
      isLoadingMore.value = true
      try {
        await getNextpageLocal(payload)
      } finally {
        isLoadingMore.value = false
      }
    } else {
      showToast({ message: t('Search Filters.There are no more results for this search'), icon: ['fas', 'search'] })
    }
  } else {
    isLoadingMore.value = true
    try {
      await performSearchInvidious(payload)
    } finally {
      isLoadingMore.value = false
    }
  }
}

function replaceShownResults(history) {
  query.value = history.query
  shownResults.value = history.data
  searchSettings.value = history.searchSettings
  apiUsed.value = history.apiUsed
  searchNotice.value = history.searchNotice ?? null
  searchParams.value = history.searchParams ?? ''
  nextPageRef.value = history.nextPageRef ?? null
  hasMoreResults.value = history.hasMoreResults ?? (
    history.apiUsed === 'local' ? nextPageRef.value !== null : true
  )

  if (typeof (history.searchPage) !== 'undefined') {
    searchPage.value = history.searchPage
  }

  // This is kept in case there is some race condition
  isLoading.value = false
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
