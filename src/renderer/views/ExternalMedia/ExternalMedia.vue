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
        <FtButton
          v-if="canRetryWithCookies"
          class="externalMediaRetry"
          :label="t('Video.Try With Configured Cookies')"
          :icon="['fas', 'cookie']"
          @click="loadMedia(mediaUrl, true)"
        />
      </div>
    </div>

    <template v-else-if="info">
      <FtShakaVideoPlayer
        v-if="source"
        ref="player"
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
        :storyboard-src="source.storyboardSrc"
        :chapters="chapters"
        :current-chapter-index="currentChapterIndex"
        :chapters-src="chaptersSrc"
        :sidebar-chapters-open="showChapters"
        :external-url="mediaUrl"
        playback-engine="yt-dlp"
        @error="playerErrorHandler"
        @timeupdate="updateCurrentTime"
        @chapters-overlay-change="showChapters = $event"
      />
      <div
        v-else
        class="externalMediaState"
        role="status"
      >
        {{ t('Video.Upcoming') }}
      </div>

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
        <div
          v-if="statusBadges.length"
          class="externalMediaBadges"
        >
          <span
            v-for="badge in statusBadges"
            :key="badge"
            class="externalMediaBadge"
          >{{ badge }}</span>
        </div>
        <FtInlineMetadata class="externalMediaMetrics">
          <span v-if="info.viewCount !== null">{{ formattedViewCount }} {{ t('Video.Views') }}</span>
          <span v-if="metadata.concurrentViewCount !== null">{{ t('Global.Counts.Watching Count', { count: formattedConcurrentViewCount }, metadata.concurrentViewCount) }}</span>
          <time
            v-if="publishedDate"
            :datetime="publishedDate"
          >{{ publishedDateLabel }} {{ formattedPublishedDate }}</time>
          <bdi v-if="metadata.categories.length"><strong>{{ t('Description.Video Category') }}</strong> {{ metadata.categories.join(', ') }}</bdi>
        </FtInlineMetadata>
        <FtInlineMetadata
          v-if="engagement.length"
          class="externalMediaMetrics"
        >
          <span
            v-for="item in engagement"
            :key="item.label"
          >{{ item.text }}</span>
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
      <FtCard
        v-if="metadataRows.length"
        class="externalMediaExtra"
      >
        <h2>{{ t('Video.Metadata') }}</h2>
        <dl>
          <div
            v-for="item in metadataRows"
            :key="item.label"
          >
            <dt>{{ item.label }}</dt>
            <dd dir="auto">
              {{ item.value }}
            </dd>
          </div>
        </dl>
      </FtCard>
      <WatchVideoDescription
        v-if="info.description || metadata.tags.length || metadata.license"
        class="externalMediaDescription"
        :description="info.description"
        :tags="metadata.tags"
        :license="metadata.license"
        @timestamp-event="seekTo"
      />
      <FtCard
        v-if="source && chapters.length && showChapters"
        class="externalMediaChapters"
      >
        <div class="chaptersPanelHeader">
          <h2>{{ t('Chapters.Chapters') }}</h2>
          <button
            type="button"
            class="chaptersPanelClose"
            :aria-label="t('Chapters.Close Chapters')"
            :title="t('Chapters.Close Chapters')"
            @click="showChapters = false"
          >
            <FtIcon :icon="['fas', 'xmark']" />
          </button>
        </div>
        <WatchVideoChapters
          :chapters="chapters"
          :current-chapter-index="currentChapterIndex"
          :fallback-thumbnail="thumbnail"
          @timestamp-event="seekTo"
          @copy-timestamp="copyChapterTimestamp"
        />
      </FtCard>
    </template>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue'
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
import WatchVideoChapters from '../../components/WatchVideoChapters/WatchVideoChapters.vue'
import { getExternalYtDlpPlaybackSource } from '../../helpers/player/ytDlpPlayback'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'
import { buildChaptersVttFile, formatDurationAsTimestamp } from '../../helpers/utils'
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
const player = useTemplateRef('player')
const mediaUrl = ref('')
const currentTime = ref(0)
const showChapters = ref(false)
const attemptUsedCookies = ref(false)
let loadGeneration = 0
const canRetryWithCookies = computed(() => errorMessage.value && isExternalMediaUrl(mediaUrl.value) && !attemptUsedCookies.value &&
  hasConfiguredRestrictedPlaybackAuthentication(store.getters))

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
const metadata = computed(() => info.value?.externalMetadata ?? {})
const chapters = computed(() => (metadata.value.chapters ?? []).map(chapter => ({
  ...chapter,
  timestamp: formatDurationAsTimestamp(Math.floor(chapter.startSeconds))
})))
const currentChapterIndex = computed(() => chapters.value.findLastIndex(chapter => currentTime.value >= chapter.startSeconds))
const chaptersSrc = computed(() => chapters.value.some(chapter => chapter.endSeconds !== null)
  ? `data:text/vtt,${encodeURIComponent(buildChaptersVttFile(chapters.value.filter(chapter => chapter.endSeconds !== null)))}`
  : '')
const creatorName = computed(() => info.value?.channel || info.value?.uploader || '')
const creatorUrl = computed(() => safeWebUrl(info.value?.channel ? info.value.channelUrl : info.value?.uploaderUrl))
const creatorAvatarUrl = computed(() => safeWebUrl(info.value?.channel ? info.value.channelThumbnail : info.value?.uploaderThumbnail))
const hideSharingActions = computed(() => store.getters.getHideSharingActions)
const formattedViewCount = computed(() => new Intl.NumberFormat(locale.value).format(info.value?.viewCount ?? 0))
const formattedConcurrentViewCount = computed(() => new Intl.NumberFormat(locale.value).format(metadata.value.concurrentViewCount ?? 0))
function parseYtDlpDate(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return ''
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}
const publishedTimestamp = computed(() => {
  const value = metadata.value.timestamp
  return Number.isFinite(value) && Number.isFinite(new Date(value * 1000).getTime()) ? value : null
})
const publishedDate = computed(() => {
  if (publishedTimestamp.value !== null) return new Date(publishedTimestamp.value * 1000).toISOString()
  return parseYtDlpDate(info.value?.uploadDate)
})
const formattedPublishedDate = computed(() => new Intl.DateTimeFormat(locale.value, {
  dateStyle: 'medium',
  ...(publishedTimestamp.value === null ? { timeZone: 'UTC' } : { timeStyle: 'short' })
}).format(new Date(publishedDate.value)))
const publishedDateLabel = computed(() => ['was_live', 'post_live'].includes(info.value?.liveStatus)
  ? t('Video.Streamed on')
  : t('Video.Published on'))
const statusBadges = computed(() => {
  const badges = []
  if (info.value?.liveStatus === 'is_live') badges.push(t('Video.Live Now'))
  if (info.value?.liveStatus === 'is_upcoming') badges.push(t('Video.Upcoming'))
  if (metadata.value.availability === 'unlisted') badges.push(t('Video.Unlisted'))
  if (metadata.value.ageLimit > 0) badges.push(t('Video.Age Restricted Badge'))
  return badges
})
const numberFormat = computed(() => new Intl.NumberFormat(locale.value))
function engagementCount(value, label) {
  return `${numberFormat.value.format(value)} ${label}`
}
const engagement = computed(() => {
  const counts = [
    ['likeCount', value => t('Global.Counts.Like Count', { count: numberFormat.value.format(value) }, value)],
    ['dislikeCount', value => engagementCount(value, t('Video.External Media.Dislikes', {}, value))],
    ['commentCount', value => t('Global.Counts.Comment Count', { count: numberFormat.value.format(value) }, value)],
    ['repostCount', value => engagementCount(value, t('Video.External Media.Reposts', {}, value))],
    ['saveCount', value => engagementCount(value, t('Video.External Media.Saves', {}, value))]
  ]
  return counts.flatMap(([key, format]) => metadata.value[key] === null
    ? []
    : [{ label: key, text: format(metadata.value[key]) }])
})
const metadataRows = computed(() => {
  const values = [
    ['series', t('Video.External Media.Series')],
    ['season', t('Video.External Media.Season')],
    ['seasonNumber', t('Video.External Media.Season Number')],
    ['episode', t('Video.External Media.Episode')],
    ['episodeNumber', t('Video.External Media.Episode Number')],
    ['track', t('Video.External Media.Track')],
    ['trackNumber', t('Video.External Media.Track Number')],
    ['artists', t('Video.External Media.Artists')],
    ['album', t('Video.External Media.Album')],
    ['genres', t('Video.External Media.Genres')],
    ['mediaType', t('Video.External Media.Media Type')],
    ['availability', t('Video.External Media.Availability')],
    ['ageLimit', t('Video.External Media.Age Limit')]
  ]
  const availabilityLabels = {
    public: t('Video.External Media.Availability Values.public'),
    private: t('Video.External Media.Availability Values.private'),
    premium_only: t('Video.External Media.Availability Values.premium_only'),
    subscriber_only: t('Video.External Media.Availability Values.subscriber_only'),
    needs_auth: t('Video.External Media.Availability Values.needs_auth'),
    unlisted: t('Video.External Media.Availability Values.unlisted')
  }
  const rows = values.flatMap(([key, label]) => {
    const value = metadata.value[key]
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0) || (key === 'ageLimit' && value === 0)) return []
    const displayValue = key === 'availability' && availabilityLabels[value]
      ? availabilityLabels[value]
      : Array.isArray(value) ? value.join(', ') : value
    return [{ label, value: displayValue }]
  })
  const releaseDate = metadata.value.releaseTimestamp !== null && metadata.value.releaseTimestamp !== undefined
    ? new Date(metadata.value.releaseTimestamp * 1000)
    : metadata.value.releaseDate ? new Date(`${parseYtDlpDate(metadata.value.releaseDate)}T00:00:00Z`) : null
  if (releaseDate && !Number.isNaN(releaseDate.getTime())) {
    const options = {
      dateStyle: 'medium',
      ...(metadata.value.releaseTimestamp !== null && metadata.value.releaseTimestamp !== undefined
        ? { timeStyle: 'short' }
        : { timeZone: 'UTC' })
    }
    rows.push({
      label: t('Video.External Media.Release Date'),
      value: new Intl.DateTimeFormat(locale.value, options).format(releaseDate)
    })
  }
  return rows
})
const playerErrorHandler = ref(() => {})

function updateCurrentTime(seconds) { currentTime.value = seconds }
function seekTo(seconds) { player.value?.setCurrentTime(seconds) }
function copyChapterTimestamp(seconds) { player.value?.copyChapterTimestamp(seconds) }

function handlePlayerError(error) {
  if (loading.value || !source.value) return
  errorMessage.value = error?.code === 6001
    ? t('Video.External DRM Protected')
    : error?.message ?? String(error)
}

async function loadMedia(url, useCookies = store.getters.getYtDlpPlaybackAlwaysUseCookies) {
  const generation = ++loadGeneration
  playerErrorHandler.value = error => {
    if (generation === loadGeneration) handlePlayerError(error)
  }
  mediaUrl.value = typeof url === 'string' ? url : ''
  attemptUsedCookies.value = useCookies
  loading.value = true
  errorMessage.value = ''
  info.value = null
  source.value = null
  currentTime.value = 0
  showChapters.value = false
  setTabTitle('Watch')

  if (!isExternalMediaUrl(url)) {
    errorMessage.value = t('Video.Invalid Media URL')
    loading.value = false
    return
  }

  try {
    const result = await getExternalYtDlpPlaybackSource(url, useCookies)
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

watch(() => route.query.url, url => loadMedia(url), { immediate: true })
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

.externalMediaBadges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.externalMediaBadge {
  background-color: var(--secondary-card-bg-color);
  border-radius: calc(5px * var(--ui-roundness));
  font-size: 13px;
  font-weight: 500;
  padding-block: 2px;
  padding-inline: 5px;
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

.externalMediaExtra,
.externalMediaChapters {
  margin-block-start: 16px;
  padding: 16px;
}

.externalMediaExtra h2 {
  font-size: 1.1rem;
  margin-block: 0 12px;
}

.externalMediaExtra dl {
  display: grid;
  gap: 8px 24px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  margin: 0;
}

.externalMediaExtra dl > div {
  min-inline-size: 0;
}

.externalMediaExtra dt {
  color: var(--secondary-text-color);
  font-size: 14px;
}

.externalMediaExtra dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.externalMediaChapters {
  display: flex;
  flex-direction: column;
}

.chaptersPanelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-block-end: 12px;
}

.chaptersPanelHeader h2 {
  font-size: 1.1rem;
  margin: 0;
}

.chaptersPanelClose {
  display: grid;
  place-items: center;
  inline-size: 36px;
  block-size: 36px;
  border: 0;
  border-radius: 50%;
  background-color: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 18px;
}

.chaptersPanelClose:hover,
.chaptersPanelClose:focus-visible {
  background-color: var(--side-nav-hover-color);
}

.externalMediaChapters :deep(.chaptersWrapper) {
  max-block-size: 360px;
}
</style>
