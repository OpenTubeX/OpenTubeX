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
        <FtListVideo
          v-for="video in videos"
          :key="video.videoId"
          :data="video"
          appearance="result"
        />
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
import FtButton from '../../components/FtButton/FtButton.vue'
import FtListVideo from '../../components/FtListVideo/FtListVideo.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'

import store from '../../store/index'
import { getYouTubeAccountRecommendations } from '../../helpers/api/youtube-account'
import { isVideoHiddenByPreferences } from '../../helpers/subscriptions'

const { t } = useI18n()

const listType = computed(() => store.getters.getListType)
/** @type {import('vue').ShallowRef<object[]>} */
const allVideos = shallowRef([])
/** @type {import('vue').Ref<string | null>} */
const continuation = ref(null)
const loading = ref(false)
const failed = ref(false)

// Shorts have their own feeds; this grid keeps to regular videos.
const videos = computed(() => allVideos.value.filter(video => !video.isShort &&
  !isVideoHiddenByPreferences(video, {
    hideLiveStreams: store.getters.getHideLiveStreams,
    hideUpcomingPremieres: store.getters.getHideUpcomingPremieres,
    hiddenChannelNames: store.getters.getActiveChannelsHiddenNames,
    aiSlopChannels: store.getters.getAiSlopBlockedChannels,
    forbiddenTitles: store.getters.getActiveForbiddenTitles,
  })))

let generation = 0

/** @param {string | null} [token] the next page */
async function load(token = null) {
  const current = ++generation
  loading.value = true
  failed.value = false
  try {
    const page = await getYouTubeAccountRecommendations(token)
    // A channel switch started a newer load.
    if (current !== generation) return
    const seen = new Set(token ? allVideos.value.map(video => video.videoId) : [])
    const added = page.videos.filter(video => !seen.has(video.videoId) && seen.add(video.videoId))
    allVideos.value = token ? [...allVideos.value, ...added] : added
    continuation.value = page.continuation
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
