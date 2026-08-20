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
        <ft-icon
          :icon="['fas', 'hashtag']"
          aria-hidden="false"
          class="headingIcon"
        />
        <bdi>{{ hashtag }}</bdi>
      </h2>
      <FtElementList
        v-if="videos.length > 0"
        :data="videos"
      />
      <FtFlexBox
        v-else
      >
        <p
          class="message"
        >
          {{ $t("Hashtag.This hashtag does not currently have any videos") }}
        </p>
      </FtFlexBox>

      <FtAutoLoadNextPageWrapper
        v-if="hasMoreResults"
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
        v-else-if="videos.length > 0"
        class="message paginationStatus"
        role="status"
      >
        {{ $t("Search Filters.There are no more results for this search") }}
      </p>
    </FtCard>
  </div>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { FtIcon } from '@opentubex/icons'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'
import store from '../../store/index'
import { useRoute } from 'vue-router'
import { getHashtagLocal, parseLocalListVideo } from '../../helpers/api/local'
import { showApiErrorToast, showToast } from '../../helpers/utils'
import { getHashtagInvidious } from '../../helpers/api/invidious'
import { useI18n } from 'vue-i18n'
import { useTabTitle } from '../../tabs/TabContext'
const { t } = useI18n()

const route = useRoute()
const setTabTitle = useTabTitle()

const hashtag = ref('')
const hashtagContinuationData = shallowRef(null)
const videos = shallowRef([])
/** @type {import('vue').Ref<'local' | 'invidious'>} */
const apiUsed = ref('local')
const pageNumber = ref(1)
const isLoading = ref(true)
const isLoadingMore = ref(false)
const hasMoreResults = ref(false)
let requestGeneration = 0

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => {
  return store.getters.getBackendFallback
})

onMounted(startHashtagRequest)
watch(() => route.params.hashtag, startHashtagRequest)
onBeforeUnmount(() => { requestGeneration++ })

function isCurrentRequest(request) {
  return request.generation === requestGeneration
}

function resetData(hashtagValue) {
  isLoading.value = true
  hashtag.value = hashtagValue
  hashtagContinuationData.value = null
  videos.value = []
  apiUsed.value = 'local'
  pageNumber.value = 1
  isLoadingMore.value = false
  hasMoreResults.value = false
}

function startHashtagRequest() {
  // Hashtag pages only exist in lowercase, querying them with the casing used in
  // a video description (e.g. `#ShiorinSketch`) returns no videos at all
  const request = {
    generation: ++requestGeneration,
    hashtag: decodeURIComponent(route.params.hashtag).toLowerCase()
  }
  resetData(request.hashtag)
  getHashtag(request)
}

async function getHashtag(request) {
  if (process.env.SUPPORTS_LOCAL_API && backendPreference.value === 'local') {
    await getLocalHashtag(request)
  } else {
    await getInvidiousHashtag(request)
  }
  if (isCurrentRequest(request)) {
    setTabTitle(`#${request.hashtag}`)
  }
}

/**
 * @param {{generation: number, hashtag: string}} request
 * @param {number} page
 */
async function getInvidiousHashtag(request, page = 1) {
  if (!isCurrentRequest(request)) {
    return
  }

  try {
    const fetchedVideos = await getHashtagInvidious(request.hashtag, page)
    if (!isCurrentRequest(request)) {
      return
    }
    apiUsed.value = 'invidious'
    videos.value = videos.value.concat(fetchedVideos)
    hasMoreResults.value = fetchedVideos.length > 0
    pageNumber.value = page + 1
  } catch (error) {
    if (!isCurrentRequest(request)) {
      return
    }
    console.error(error)
    const errorMessage = t('Invidious API Error (Click to copy)')
    showApiErrorToast(errorMessage, error)
    if (process.env.SUPPORTS_LOCAL_API && backendPreference.value === 'invidious' && backendFallback.value) {
      showToast({ message: t('Falling back to Local API'), icon: ['fas', 'exchange-alt'] })
      resetData(request.hashtag)
      await getLocalHashtag(request)
    }
  } finally {
    if (isCurrentRequest(request) && page === 1) {
      isLoading.value = false
    }
  }
}

async function getLocalHashtag(request) {
  if (!isCurrentRequest(request)) {
    return
  }

  try {
    const hashtagData = await getHashtagLocal(request.hashtag)
    if (!isCurrentRequest(request)) {
      return
    }
    videos.value = hashtagData.videos.map((video) => parseLocalListVideo(video)).filter(_ => _)
    apiUsed.value = 'local'
    hashtagContinuationData.value = hashtagData.has_continuation ? hashtagData : null
    hasMoreResults.value = hashtagContinuationData.value !== null
  } catch (error) {
    if (!isCurrentRequest(request)) {
      return
    }
    console.error(error)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, error)
    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      resetData(request.hashtag)
      await getInvidiousHashtag(request)
    }
  } finally {
    if (isCurrentRequest(request)) {
      isLoading.value = false
    }
  }
}

async function getLocalHashtagMore(request) {
  if (!isCurrentRequest(request)) {
    return
  }

  const continuationData = hashtagContinuationData.value
  if (continuationData === null) {
    return
  }

  try {
    const continuation = await continuationData.getContinuation()
    if (!isCurrentRequest(request)) {
      return
    }
    const newVideos = continuation.videos.map((video) => parseLocalListVideo(video)).filter(_ => _)
    hashtagContinuationData.value = continuation.has_continuation ? continuation : null
    hasMoreResults.value = hashtagContinuationData.value !== null
    videos.value = videos.value.concat(newVideos)
  } catch (error) {
    if (!isCurrentRequest(request)) {
      return
    }
    console.error(error)
    const errorMessage = t('Local API Error (Click to copy)')
    showApiErrorToast(errorMessage, error)
    if (backendPreference.value === 'local' && backendFallback.value) {
      showToast({ message: t('Falling back to Invidious API'), icon: ['fas', 'exchange-alt'] })
      resetData(request.hashtag)
      await getInvidiousHashtag(request)
    }
  }
}

async function handleFetchMore() {
  if (isLoadingMore.value) {
    return
  }
  const request = {
    generation: requestGeneration,
    hashtag: hashtag.value
  }
  if (!isCurrentRequest(request)) {
    return
  }

  isLoadingMore.value = true
  try {
    if (process.env.SUPPORTS_LOCAL_API && apiUsed.value === 'local') {
      await getLocalHashtagMore(request)
    } else if (apiUsed.value === 'invidious') {
      await getInvidiousHashtag(request, pageNumber.value)
    }
  } finally {
    if (isCurrentRequest(request)) {
      isLoadingMore.value = false
    }
  }
}
</script>
<style scoped src="./Hashtag.css" />
