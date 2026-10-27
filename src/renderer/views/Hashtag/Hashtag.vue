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
      <h2 :id="headingId">
        <ft-icon
          :icon="['fas', 'hashtag']"
          aria-hidden="false"
          class="headingIcon"
        />
        <bdi>{{ hashtag }}</bdi>
      </h2>
      <p
        v-if="statsText"
        class="hashtagStats"
      >
        {{ statsText }}
      </p>
      <FtTabs
        v-if="hasShortsTab"
        class="hashtagTabs"
        :aria-labelledby="headingId"
      >
        <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
        <div
          ref="videosTab"
          class="tab"
          role="tab"
          :aria-selected="currentTab === 'videos'"
          :aria-controls="panelId"
          :tabindex="currentTab === 'videos' ? 0 : -1"
          @click="changeTab('videos')"
          @keydown.space.enter.prevent="changeTab('videos')"
          @keydown.left.right="focusTab(shortsTab, $event)"
        >
          {{ $t('Global.Videos') }}
        </div>
        <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
        <div
          ref="shortsTab"
          class="tab"
          role="tab"
          :aria-selected="currentTab === 'shorts'"
          :aria-controls="panelId"
          :tabindex="currentTab === 'shorts' ? 0 : -1"
          @click="changeTab('shorts')"
          @keydown.space.enter.prevent="changeTab('shorts')"
          @keydown.left.right="focusTab(videosTab, $event)"
        >
          {{ $t('Global.Shorts') }}
        </div>
      </FtTabs>
      <div
        :id="panelId"
        :role="hasShortsTab ? 'tabpanel' : undefined"
      >
        <FtLoader v-if="currentTab === 'shorts' && isLoadingShorts" />
        <FtElementList
          v-else-if="shownItems.length > 0"
          :key="currentTab"
          :data="shownItems"
        />
        <FtFlexBox
          v-else
        >
          <p
            class="message"
          >
            {{
              unsupported
                ? $t('Yattee Server.Unsupported page', { fallbackSetting: $t('Settings.General Settings.Fallback to Non-Preferred Backend on Failure') })
                : $t("Hashtag.This hashtag does not currently have any videos")
            }}
          </p>
        </FtFlexBox>

        <FtAutoLoadNextPageWrapper
          v-if="hasMoreResults"
          :key="currentTab"
          :loading="isLoadingMore"
          @load-next-page="handleFetchMore"
        >
          <div
            class="getNextPage"
            role="button"
            tabindex="0"
            @click="handleFetchMore"
            @keydown.enter.space.prevent="handleFetchMore"
          >
            <FtIcon :icon="['fas', 'search']" /> {{ $t("Search Filters.Fetch more results") }}
          </div>
        </FtAutoLoadNextPageWrapper>
        <p
          v-else-if="shownItems.length > 0"
          class="message paginationStatus"
          role="status"
        >
          {{ $t("Search Filters.There are no more results for this search") }}
        </p>
      </div>
    </FtCard>
  </div>
</template>
<script setup>
import { computed, onMounted, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { FtIcon } from '@opentubex/icons'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtTabs from '../../components/FtTabs/FtTabs.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'
import store from '../../store/index'
import { usesInvidiousApi } from '../../../apiBackends'
import { useRoute } from 'vue-router'
import { getHashtagLocal, getHashtagShortsLocal, hasHashtagShortsTab, parseLocalHashtagHeader, parseLocalListVideo, parseShort } from '../../helpers/api/local'
import { formatNumber, getInvidiousApiErrorMessage, showInvidiousFallbackToast, showApiErrorToast, showToast } from '../../helpers/utils'
import { getHashtagInvidious } from '../../helpers/api/invidious'
import { YatteeUnsupportedError } from '../../helpers/api/yattee'
import { isRoundedNumber } from '../../helpers/viewCounts'
import { useI18n } from 'vue-i18n'
import { useTabTitle } from '../../tabs/TabContext'
const { t } = useI18n()

const route = useRoute()
const setTabTitle = useTabTitle()

const headingId = useId()
const panelId = useId()
const videosTab = useTemplateRef('videosTab')
const shortsTab = useTemplateRef('shortsTab')

const hashtag = ref('')
const hashtagFeed = shallowRef(null)
const hashtagContinuationData = shallowRef(null)
/** @type {import('vue').ShallowRef<{ videoCount: number | null, channelCount: number | null }>} */
const counts = shallowRef({ videoCount: null, channelCount: null })
const videos = shallowRef([])
/** @type {import('vue').Ref<'videos' | 'shorts'>} */
const currentTab = ref('videos')
const shorts = shallowRef([])
const shortsContinuationData = shallowRef(null)
const shortsLoaded = ref(false)
const isLoadingShorts = ref(false)
/** @type {import('vue').Ref<'local' | 'invidious'>} */
const apiUsed = ref('local')
const pageNumber = ref(1)
const isLoading = ref(true)
const isLoadingMore = ref(false)
const hasMoreVideos = ref(false)
const unsupported = ref(false)

const hasShortsTab = computed(() => hashtagFeed.value !== null && hasHashtagShortsTab(hashtagFeed.value))
const shownItems = computed(() => currentTab.value === 'shorts' ? shorts.value : videos.value)
const hasMoreResults = computed(() => currentTab.value === 'shorts' ? shortsContinuationData.value !== null : hasMoreVideos.value)

/**
 * YouTube only provides rounded counts (e.g. 47M), so keep them compact
 * @param {number} count
 */
function formatCount(count) {
  return formatNumber(count, isRoundedNumber(count) ? { notation: 'compact' } : undefined)
}

/** @type {import('vue').ComputedRef<string>} */
const statsText = computed(() => {
  const { videoCount, channelCount } = counts.value
  return [
    videoCount !== null && t('Global.Counts.Video Count', { count: formatCount(videoCount) }, videoCount),
    channelCount !== null && t('Global.Counts.Channel Count', { count: formatCount(channelCount) }, channelCount)
  ].filter(Boolean).join(' • ')
})

/** @type {import('vue').ComputedRef<'local' | 'invidious' | 'yattee'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => {
  return store.getters.getBackendFallback
})

onMounted(() => {
  getHashtag()
})

watch(() => route.params.hashtag, () => {
  resetData()
  getHashtag()
})

function resetData() {
  isLoading.value = true
  unsupported.value = false
  hashtag.value = ''
  hashtagFeed.value = null
  hashtagContinuationData.value = null
  currentTab.value = 'videos'
  shorts.value = []
  shortsContinuationData.value = null
  shortsLoaded.value = false
  isLoadingShorts.value = false
  counts.value = { videoCount: null, channelCount: null }
  videos.value = []
  apiUsed.value = 'local'
  pageNumber.value = 1
  isLoadingMore.value = false
  hasMoreVideos.value = false
}

async function getHashtag() {
  // Hashtag pages only exist in lowercase, querying them with the casing used in
  // a video description (e.g. `#ShiorinSketch`) returns no videos at all
  hashtag.value = decodeURIComponent(route.params.hashtag).toLowerCase()
  if (process.env.SUPPORTS_LOCAL_API && backendPreference.value === 'local') {
    await getLocalHashtag()
  } else {
    await getInvidiousHashtag()
  }
  setTabTitle(`#${hashtag.value}`)
}

/**
 * @param {number} page
 */
async function getInvidiousHashtag(page = 1) {
  try {
    const fetchedVideos = await getHashtagInvidious(hashtag.value, page)
    isLoading.value = false
    apiUsed.value = 'invidious'
    videos.value = videos.value.concat(fetchedVideos)
    hasMoreVideos.value = fetchedVideos.length > 0
    pageNumber.value += 1
  } catch (error) {
    console.error(error)
    const isUnsupported = error instanceof YatteeUnsupportedError
    if (!isUnsupported) {
      showApiErrorToast(getInvidiousApiErrorMessage(backendPreference.value), error)
    }
    if (process.env.SUPPORTS_LOCAL_API && usesInvidiousApi(backendPreference.value) && backendFallback.value) {
      showInvidiousFallbackToast(backendPreference.value)
      resetData()
      getLocalHashtag()
    } else {
      unsupported.value = isUnsupported
      isLoading.value = false
    }
  }
}

async function getLocalHashtag() {
  try {
    const hashtagData = await getHashtagLocal(hashtag.value)
    counts.value = parseLocalHashtagHeader(hashtagData.header)
    videos.value = hashtagData.videos.map((video) => parseLocalListVideo(video)).filter(_ => _)
    apiUsed.value = 'local'
    hashtagFeed.value = hashtagData
    hashtagContinuationData.value = hashtagData.has_continuation ? hashtagData : null
    hasMoreVideos.value = hashtagContinuationData.value !== null
    isLoading.value = false
  } catch (error) {
    console.error(error)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, error)
    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      resetData()
      getInvidiousHashtag()
    } else {
      isLoading.value = false
    }
  }
}

async function getLocalHashtagMore() {
  try {
    const continuation = await hashtagContinuationData.value.getContinuation()
    const newVideos = continuation.videos.map((video) => parseLocalListVideo(video)).filter(_ => _)
    hashtagContinuationData.value = continuation.has_continuation ? continuation : null
    hasMoreVideos.value = hashtagContinuationData.value !== null
    videos.value = videos.value.concat(newVideos)
  } catch (error) {
    console.error(error)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, error)
    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      resetData()
      getInvidiousHashtag()
    } else {
      isLoading.value = false
    }
  }
}

/**
 * @param {HTMLElement | null} tab
 * @param {KeyboardEvent} event
 */
function focusTab(tab, event) {
  if (event.altKey) return

  event.preventDefault()
  store.dispatch('showOutlines')
  tab?.focus()
}

/**
 * @param {'videos' | 'shorts'} tab
 */
async function changeTab(tab) {
  currentTab.value = tab
  if (tab !== 'shorts' || shortsLoaded.value || isLoadingShorts.value) {
    return
  }

  const feed = hashtagFeed.value
  isLoadingShorts.value = true
  try {
    const shortsData = await getHashtagShortsLocal(feed)
    // Ignore responses for a hashtag the page has since left.
    if (feed !== hashtagFeed.value) return
    shorts.value = shortsData.videos.map(short => parseShort(short))
    shortsContinuationData.value = shortsData.has_continuation ? shortsData : null
    shortsLoaded.value = true
  } catch (error) {
    console.error(error)
    showApiErrorToast(t('Local API Error (Click to copy)'), error)
  } finally {
    if (feed === hashtagFeed.value) {
      isLoadingShorts.value = false
    }
  }
}

async function getLocalHashtagShortsMore() {
  try {
    const continuation = await shortsContinuationData.value.getContinuation()
    shortsContinuationData.value = continuation.has_continuation ? continuation : null
    shorts.value = shorts.value.concat(continuation.videos.map(short => parseShort(short)))
  } catch (error) {
    console.error(error)
    showApiErrorToast(t('Local API Error (Click to copy)'), error)
  }
}

async function handleFetchMore() {
  if (isLoadingMore.value) {
    return
  }

  isLoadingMore.value = true
  try {
    if (currentTab.value === 'shorts') {
      await getLocalHashtagShortsMore()
    } else if (process.env.SUPPORTS_LOCAL_API && apiUsed.value === 'local') {
      await getLocalHashtagMore()
    } else if (apiUsed.value === 'invidious') {
      await getInvidiousHashtag(pageNumber.value)
    }
  } finally {
    isLoadingMore.value = false
  }
}
</script>
<style scoped src="./Hashtag.css" />
