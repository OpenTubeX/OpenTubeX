<template>
  <div :aria-busy="loading">
    <FtLoader v-if="loading && videos.length === 0" />
    <div
      v-else-if="videos.length === 0"
      class="youtubeRecommendationStatus"
      role="status"
    >
      <p>
        {{ failed ? t('YouTube Account.Recommendations Failed') : t('Home Page.No recommendations') }}
      </p>
      <FtButton
        v-if="failed"
        :label="t('Settings.Sync Settings.Try Again')"
        :icon="['fas', 'sync']"
        @click="load()"
      />
    </div>
    <template v-else>
      <FtAutoGrid
        :grid="listType !== 'list'"
        :item-count="videos.length"
      >
        <FtBlockedItem
          v-for="video in videos"
          :key="video.videoId"
          :blocked="isBlurred(video)"
          :reveal-key="video.videoId"
        >
          <FtListVideo
            :data="video"
            appearance="result"
          />
        </FtBlockedItem>
      </FtAutoGrid>
      <FtLoader
        v-if="loading"
        :label="t('Global.Loading More')"
        compact
        :tab-loading-indicator="false"
      />
      <FtButton
        v-else-if="continuation"
        class="youtubeRecommendationLoadMore"
        :label="t('Subscriptions.Load More Videos')"
        :icon="['fas', 'angle-down']"
        @click="load(continuation)"
      />
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtAutoGrid from '../../components/FtAutoGrid/FtAutoGrid.vue'
import FtBlockedItem from '../../components/FtBlockedItem/FtBlockedItem.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtListVideo from '../../components/FtListVideo/FtListVideo.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'

import store from '../../store/index'
import { getYouTubeAccountRecommendations } from '../../helpers/api/youtube-account'
import { isVideoHiddenByPreferences } from '../../helpers/subscriptions'
import { isBlurredByBlockLists } from '../../helpers/blockedItems'

const { t } = useI18n()

const listType = computed(() => store.getters.getListType)
/** @type {import('vue').ShallowRef<object[]>} */
const allVideos = shallowRef([])
/** @type {import('vue').Ref<string | null>} */
const continuation = ref(null)
const loading = ref(false)
const failed = ref(false)

// TV tiles name the channel but carry no channel ID, so blocked channels
// also match by the name saved with them.
const blockedChannelNames = computed(() => new Set(store.getters.getActiveChannelsHidden
  .map(channel => channel.preferredName)
  .filter(Boolean)))

const blurBlockedItems = computed(() => store.getters.getBlurBlockedItemsActive)

/** Blocked items stay in the list, blurred, when that is turned on. */
function isBlurred(video) {
  return blurBlockedItems.value && (blockedChannelNames.value.has(video.author) || isBlurredByBlockLists(video))
}

// Shorts have their own feeds; this grid keeps to regular videos.
const videos = computed(() => allVideos.value.filter(video => !video.isShort &&
  (blurBlockedItems.value || !blockedChannelNames.value.has(video.author)) &&
  !isVideoHiddenByPreferences(video, {
    hideLiveStreams: store.getters.getHideLiveStreams,
    hideUpcomingPremieres: store.getters.getHideUpcomingPremieres,
    // Lists keep blocked items and blur them when that is turned on.
    hiddenChannelNames: store.getters.getChannelsHiddenNamesToRemove,
    aiSlopChannels: store.getters.getAiSlopBlockedChannels,
    forbiddenTitles: store.getters.getForbiddenTitlesToRemove,
  })))

let generation = 0
// Pages that only add hidden videos load the next one, up to this many.
const MAX_HIDDEN_PAGES = 3

/** @param {string | null} [token] the next page */
async function load(token = null) {
  const current = ++generation
  loading.value = true
  failed.value = false
  try {
    let nextToken = token
    for (let page = 0; page < MAX_HIDDEN_PAGES; page++) {
      const visibleBefore = nextToken ? videos.value.length : 0
      const result = await getYouTubeAccountRecommendations(nextToken)
      // A channel switch started a newer load.
      if (current !== generation) return
      const seen = new Set(nextToken ? allVideos.value.map(video => video.videoId) : [])
      const added = result.videos.filter(video => !seen.has(video.videoId) && seen.add(video.videoId))
      allVideos.value = nextToken ? [...allVideos.value, ...added] : added
      continuation.value = result.continuation
      if (videos.value.length > visibleBefore || !result.continuation) break
      nextToken = result.continuation
    }
  } catch (error) {
    if (current !== generation) return
    console.error(error)
    failed.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}

onMounted(() => load())
// Another channel has its own recommendations.
watch(() => store.getters.getYouTubeAccount?.pageId, () => {
  allVideos.value = []
  continuation.value = null
  load()
})
</script>

<style scoped>
.youtubeRecommendationStatus {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.youtubeRecommendationLoadMore {
  margin-inline: auto;
}
</style>
