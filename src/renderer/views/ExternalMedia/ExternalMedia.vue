<template>
  <main class="externalMedia">
    <div
      v-if="loading"
      class="externalMediaState externalMediaLoading"
      data-tab-loading-indicator
      role="status"
    >
      <div class="externalMediaStateContent">
        <FtLoader
          class="externalMediaSpinner"
          :tab-loading-indicator="false"
        />
        <p>{{ t('Video.Fetching Streams') }}</p>
        <span
          v-if="hostname"
          class="externalMediaOrigin"
        >{{ hostname }}</span>
      </div>
    </div>

    <div
      v-else-if="errorMessage"
      class="externalMediaState externalMediaError"
      role="alert"
    >
      <div class="externalMediaStateContent">
        <FtIcon
          :icon="['fas', 'exclamation-circle']"
          class="externalMediaErrorIcon"
          aria-hidden="true"
        />
        <h1>{{ info?.title || hostname || mediaUrl || t('Change Format.Stream Source') }}</h1>
        <span
          v-if="info?.title && hostname"
          class="externalMediaOrigin"
        >{{ hostname }}</span>
        <p class="externalMediaDiagnostic">
          {{ errorMessage }}
        </p>
        <FtButton
          v-if="isExternalMediaUrl(mediaUrl)"
          class="externalMediaRetry"
          :label="t('User Playlists.SinglePlaylistView.Retry')"
          :icon="['fas', 'sync']"
          @click="loadMedia(route.query.url)"
        />
      </div>
    </div>

    <template v-else-if="source && info">
      <FtShakaVideoPlayer
        :key="loadGeneration"
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
        @error="playerErrorHandler"
      />

      <FtCard class="externalMediaDetails">
        <div class="externalMediaHeading">
          <h1
            class="videoTitle"
            dir="auto"
          >
            {{ info.title || mediaUrl }}
          </h1>
          <FtShareButton
            v-if="!hideSharingActions"
            id=""
            :external-url="mediaUrl"
          />
        </div>
        <FtInlineMetadata class="externalMediaMetrics">
          <span v-if="info.viewCount !== null">{{ formattedViewCount }} {{ t('Video.Views') }}</span>
          <time
            v-if="uploadDate"
            :datetime="uploadDate"
          >{{ formattedUploadDate }}</time>
        </FtInlineMetadata>
        <div class="externalMediaCreator">
          <component
            :is="creatorUrl ? 'a' : 'span'"
            v-if="creatorName"
            class="externalMediaCreatorProfile"
            :href="creatorUrl || undefined"
            :target="creatorUrl ? '_blank' : undefined"
            :rel="creatorUrl ? 'noopener noreferrer' : undefined"
          >
            <FtRetryImage
              v-if="creatorAvatarUrl"
              :src="creatorAvatarUrl"
              class="externalMediaCreatorAvatar"
              alt=""
            />
            <span dir="auto">{{ creatorName }}</span>
          </component>
          <a
            class="externalMediaSiteLink"
            :href="mediaUrl"
            target="_blank"
            rel="noopener noreferrer"
          >{{ hostname }}</a>
        </div>
      </FtCard>
      <WatchVideoDescription
        v-if="info.description"
        class="externalMediaDescription"
        :description="info.description"
      />
    </template>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtButton from '../../components/FtButton/FtButton.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtInlineMetadata from '../../components/FtInlineMetadata/FtInlineMetadata.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtRetryImage from '../../components/FtRetryImage.vue'
import FtShareButton from '../../components/FtShareButton/FtShareButton.vue'
import FtShakaVideoPlayer from '../../components/ft-shaka-video-player/ft-shaka-video-player.vue'
import WatchVideoDescription from '../../components/WatchVideoDescription/WatchVideoDescription.vue'
import { getExternalYtDlpPlaybackSource } from '../../helpers/player/ytDlpPlayback'
import { isExternalMediaUrl } from '../../helpers/externalMediaUrl'
import { useTabAvatar, useTabTitle } from '../../tabs/TabContext'
import store from '../../store/index'

const route = useRoute()
const { t, locale } = useI18n()
const setTabTitle = useTabTitle()
const setTabAvatar = useTabAvatar()

const loading = ref(true)
const errorMessage = ref('')
const info = shallowRef(null)
const source = shallowRef(null)
const mediaUrl = ref('')
let loadGeneration = 0

const hostname = computed(() => {
  try {
    return new URL(mediaUrl.value).hostname
  } catch {
    return ''
  }
})
function safeWebUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : ''
  } catch {
    return ''
  }
}
const thumbnail = computed(() => safeWebUrl(info.value?.thumbnail))
const creatorName = computed(() => info.value?.channel || info.value?.uploader || '')
const creatorUrl = computed(() => safeWebUrl(info.value?.channel ? info.value.channelUrl : info.value?.uploaderUrl))
const creatorAvatarUrl = computed(() => safeWebUrl(info.value?.channel ? info.value.channelThumbnail : info.value?.uploaderThumbnail))
const hideSharingActions = computed(() => store.getters.getHideSharingActions)
const formattedViewCount = computed(() => new Intl.NumberFormat(locale.value).format(info.value?.viewCount ?? 0))
const uploadDate = computed(() => {
  const value = info.value?.uploadDate
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return ''
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
})
const formattedUploadDate = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${uploadDate.value}T00:00:00Z`)))
const playerErrorHandler = ref(() => {})

function handlePlayerError(error) {
  if (loading.value || !source.value) return
  errorMessage.value = error?.code === 6001
    ? t('Video.External DRM Protected')
    : error?.message ?? String(error)
}

async function loadMedia(url) {
  const generation = ++loadGeneration
  playerErrorHandler.value = error => {
    if (generation === loadGeneration) handlePlayerError(error)
  }
  mediaUrl.value = typeof url === 'string' ? url : ''
  loading.value = true
  errorMessage.value = ''
  info.value = null
  source.value = null
  setTabTitle('Watch')

  if (!isExternalMediaUrl(url)) {
    errorMessage.value = t('Video.Invalid Media URL')
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
    if (creatorAvatarUrl.value) setTabAvatar(creatorAvatarUrl.value)
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
  padding: 24px;
}

.externalMediaPlayer {
  inline-size: 100%;
}

.externalMediaState {
  aspect-ratio: 16 / 9;
  background-color: var(--card-bg-color);
  border: 1px solid var(--divider-color);
  border-radius: calc(8px * var(--ui-roundness));
  box-sizing: border-box;
  display: grid;
  min-block-size: 320px;
  padding: 32px;
  place-items: center;
}

.externalMediaStateContent {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 16px;
  inline-size: 100%;
  max-inline-size: 640px;
  min-inline-size: 0;
  text-align: center;
}

.externalMediaSpinner {
  block-size: 40px;
  inline-size: 40px;
}

.externalMediaSpinner :deep(.spinner) {
  margin: 0;
}

.externalMediaLoading .externalMediaStateContent {
  background-color: var(--bg-color);
  border: 1px solid var(--divider-color);
  border-radius: calc(8px * var(--ui-roundness));
  box-sizing: border-box;
  max-inline-size: 440px;
  padding: 24px;
}

.externalMediaLoading .externalMediaStateContent > p {
  font-size: 1.125rem;
  font-weight: 600;
}

.externalMediaStateContent > p,
.externalMediaStateContent > h1 {
  margin: 0;
}

.externalMediaStateContent > h1 {
  font-size: 1.5rem;
}

.externalMediaOrigin {
  color: var(--secondary-text-color);
  overflow-wrap: anywhere;
}

.externalMediaErrorIcon {
  color: var(--primary-color);
  font-size: 48px;
}

.externalMediaDiagnostic {
  background-color: var(--bg-color);
  border-radius: calc(4px * var(--ui-roundness));
  box-sizing: border-box;
  color: var(--secondary-text-color);
  inline-size: 100%;
  line-height: 1.5;
  overflow-wrap: anywhere;
  padding: 16px;
  text-align: start;
}

.externalMediaRetry {
  min-block-size: 44px;
}

@media only screen and (width <= 680px) {
  .externalMediaState {
    padding: 20px;
  }
}

.externalMediaDetails {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-block-start: 16px;
  padding: 16px;
}

.externalMediaDetails .videoTitle {
  font-size: 22px;
  font-weight: normal;
  line-height: 1.3;
  margin: 0;
  overflow-wrap: anywhere;
}

.externalMediaHeading {
  align-items: flex-start;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.externalMediaMetrics {
  color: var(--tertiary-text-color);
  font-size: 14px;
}

.externalMediaCreator {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}

.externalMediaCreatorProfile {
  align-items: center;
  color: inherit;
  display: inline-flex;
  font-weight: 600;
  gap: 10px;
  text-decoration: none;
}

.externalMediaCreatorProfile[href]:hover {
  text-decoration: underline;
}

.externalMediaCreatorAvatar {
  block-size: 40px;
  border-radius: 50%;
  inline-size: 40px;
  object-fit: cover;
}

.externalMediaSiteLink {
  color: var(--secondary-text-color);
  overflow-wrap: anywhere;
}

.externalMediaDescription {
  margin-block-start: 16px;
}
</style>
