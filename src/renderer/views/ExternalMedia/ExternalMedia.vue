<template>
  <main class="externalMedia">
    <div
      v-if="loading"
      class="externalMediaLoading"
      data-tab-loading-indicator
    >
      <FtLoader />
      <span>{{ t('Video.Fetching Streams') }}</span>
    </div>

    <div
      v-else-if="errorMessage"
      class="externalMediaError"
      role="alert"
    >
      {{ errorMessage }}
    </div>

    <template v-else-if="source && info">
      <FtShakaVideoPlayer
        class="externalMediaPlayer"
        :manifest-src="source.manifestSrc"
        :manifest-mime-type="source.manifestMimeType"
        :legacy-formats="source.legacyFormats"
        :format="source.manifestSrc ? 'dash' : 'legacy'"
        :captions="source.captions"
        :caption-translations="source.captionTranslations"
        :title="info.title ?? ''"
        :thumbnail="thumbnail"
        :is-live="source.isLive"
        :external-url="mediaUrl"
        playback-engine="yt-dlp"
        @error="handlePlayerError"
      />

      <section class="externalMediaDetails">
        <h1>{{ info.title || mediaUrl }}</h1>
        <div class="externalMediaByline">
          <span v-if="info.uploader">{{ info.uploader }}</span>
          <span v-if="info.viewCount !== null">{{ formattedViewCount }} {{ t('Video.Views') }}</span>
          <time
            v-if="uploadDate"
            :datetime="uploadDate"
          >{{ formattedUploadDate }}</time>
          <a
            :href="mediaUrl"
            target="_blank"
            rel="noopener noreferrer"
          >{{ hostname }}</a>
        </div>
        <p
          v-if="info.description"
          class="externalMediaDescription"
        >
          {{ info.description }}
        </p>
      </section>
    </template>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'

import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtShakaVideoPlayer from '../../components/ft-shaka-video-player/ft-shaka-video-player.vue'
import { getExternalYtDlpPlaybackSource } from '../../helpers/player/ytDlpPlayback'
import { isExternalMediaUrl } from '../../helpers/externalMediaUrl'
import { useTabTitle } from '../../tabs/TabContext'
import store from '../../store/index'

const route = useRoute()
const { t, locale } = useI18n()
const setTabTitle = useTabTitle()

const loading = ref(true)
const errorMessage = ref('')
const info = shallowRef(null)
const source = shallowRef(null)
const mediaUrl = ref('')
let loadGeneration = 0

const hostname = computed(() => mediaUrl.value ? new URL(mediaUrl.value).hostname : '')
const thumbnail = computed(() => {
  try {
    return new URL(info.value?.thumbnail).protocol === 'https:' ? info.value.thumbnail : ''
  } catch {
    return ''
  }
})
const formattedViewCount = computed(() => new Intl.NumberFormat(locale.value).format(info.value?.viewCount ?? 0))
const uploadDate = computed(() => {
  const value = info.value?.uploadDate
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return ''
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
})
const formattedUploadDate = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(`${uploadDate.value}T00:00:00Z`)))

function handlePlayerError(error) {
  errorMessage.value = error?.message ?? String(error)
}

async function loadMedia(url) {
  const generation = ++loadGeneration
  mediaUrl.value = typeof url === 'string' ? url : ''
  loading.value = true
  errorMessage.value = ''
  info.value = null
  source.value = null
  setTabTitle('Watch')

  if (!isExternalMediaUrl(url)) {
    errorMessage.value = 'Invalid media URL'
    loading.value = false
    return
  }

  try {
    const result = await getExternalYtDlpPlaybackSource(
      url,
      store.getters.getYtDlpPlaybackAlwaysUseCookies
    )
    if (generation !== loadGeneration) return
    info.value = result.info
    source.value = result.source
    setTabTitle(result.info.title || hostname.value)
  } catch (error) {
    if (generation !== loadGeneration) return
    errorMessage.value = error.message
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

watch(() => route.query.url, loadMedia, { immediate: true })
onBeforeUnmount(() => { loadGeneration++ })
</script>

<style scoped>
.externalMedia {
  margin-inline: auto;
  max-inline-size: 1100px;
  padding: 24px;
}

.externalMediaPlayer {
  inline-size: 100%;
}

.externalMediaLoading,
.externalMediaError {
  align-items: center;
  display: flex;
  gap: 12px;
  min-block-size: 300px;
  justify-content: center;
}

.externalMediaDetails {
  padding-block: 20px;
}

.externalMediaDetails h1 {
  font-size: 1.5rem;
  margin: 0 0 12px;
}

.externalMediaByline {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
}

.externalMediaDescription {
  margin-block: 20px;
  white-space: pre-wrap;
}
</style>
