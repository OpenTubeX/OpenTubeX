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
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { FtIcon } from '@opentubex/icons'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'
import store from '../../store/index'
import { useRoute } from 'vue-router'
import { contentApi } from '../../helpers/api/contentApi'
import { showApiErrorToast, showToast } from '../../helpers/utils'
import { useI18n } from 'vue-i18n'
import { useTabTitle } from '../../tabs/TabContext'
const { t } = useI18n()

const route = useRoute()
const setTabTitle = useTabTitle()

const hashtag = ref('')
const cursor = shallowRef(null)
const videos = shallowRef([])
const isLoading = ref(true)
const isLoadingMore = ref(false)
const hasMoreResults = ref(false)

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
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
  hashtag.value = ''
  cursor.value = null
  videos.value = []
  isLoadingMore.value = false
  hasMoreResults.value = false
}

async function getHashtag() {
  // Hashtag pages only exist in lowercase, querying them with the casing used in
  // a video description (e.g. `#ShiorinSketch`) returns no videos at all
  hashtag.value = decodeURIComponent(route.params.hashtag).toLowerCase()
  await loadHashtagPage()
  setTabTitle(`#${hashtag.value}`)
}

async function loadHashtagPage() {
  try {
    const page = await contentApi.getHashtagPage({
      hashtag: hashtag.value,
      preference: backendPreference.value,
      fallback: backendFallback.value,
      cursor: cursor.value,
      onError: showProviderError,
      onFallback: showProviderFallback,
    })
    videos.value = videos.value.concat(page.videos)
    cursor.value = page.cursor
    hasMoreResults.value = page.hasMore
  } catch {
    // The service reports each attempted provider error before rejecting.
  } finally {
    isLoading.value = false
  }
}

function showProviderError(provider, error) {
  console.error(error)
  const message = provider === 'local'
    ? t('Local API Error (Click to copy)')
    : t('Invidious API Error (Click to copy)')
  showApiErrorToast(message, error)
}

function showProviderFallback(_from, to) {
  const message = to === 'local'
    ? t('Falling back to Local API')
    : t('Falling back to Invidious API')
  showToast({ message, icon: ['fas', 'exchange-alt'] })
  videos.value = []
  cursor.value = null
  hasMoreResults.value = false
  isLoading.value = true
}

async function handleFetchMore() {
  if (isLoadingMore.value) {
    return
  }

  isLoadingMore.value = true
  try {
    await loadHashtagPage()
  } finally {
    isLoadingMore.value = false
  }
}
</script>
<style scoped src="./Hashtag.css" />
