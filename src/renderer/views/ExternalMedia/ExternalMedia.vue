<template>
  <main class="externalMedia">
    <div
      v-if="loading || errorMessage"
      class="videoLayout"
      :class="{ useTheatreMode, noSidebar: !hasSidebar }"
    >
      <div class="videoArea">
        <div class="videoAreaMargin">
          <div
            v-if="loading"
            class="externalMediaState externalMediaLoading"
            data-tab-loading-indicator
            role="status"
          >
            <div class="externalMediaStateContent">
              <FtLoader
                class="externalMediaSpinner"
                inline
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
            v-else
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
        </div>
      </div>
      <div
        v-if="loading"
        class="infoArea"
      >
        <WatchVideoInfoSkeleton class="watchVideo" />
      </div>
    </div>

    <template v-else-if="info">
      <div
        ref="videoLayout"
        class="videoLayout"
        :class="{ ambientModeActive, useTheatreMode, noSidebar: !hasSidebar && !sidebarPanelLeaving }"
      >
        <div class="videoArea">
          <div class="videoAreaMargin">
            <template v-if="source">
              <FtShakaVideoPlayer
                ref="player"
                :key="loadGeneration"
                class="videoPlayer"
                :manifest-src="source.manifestSrc"
                :manifest-mime-type="source.manifestMimeType"
                :twitch-sub-only-vod="source.twitchSubOnlyVod === true"
                :legacy-formats="source.legacyFormats"
                :format="source.manifestSrc ? (source.audioOnly ? 'audio' : 'dash') : 'legacy'"
                :captions="source.captions"
                :caption-translations="source.captionTranslations"
                :title="info.title ?? ''"
                :artist="musicPlayerArtist"
                :channel-name="creatorName"
                :channel-thumbnail="creatorAvatarUrl"
                :thumbnail="thumbnail"
                :is-live="source.isLive"
                :start-time="source.separateAudioUrl ? null : startTime"
                :current-playback-rate="currentPlaybackRate"
                :storyboard-src="source.storyboardSrc"
                :chapters="chapters"
                :current-chapter-index="currentChapterIndex"
                :chapters-src="chaptersSrc"
                :auto-open-chapters="autoOpenChapters"
                :sidebar-chapters-open="showChapters"
                :transcript-open="transcriptShown"
                :transcript-available="transcriptAvailable"
                :download-available="downloadAvailable"
                :external-url="mediaUrl"
                :live-chat-available="chatAvailable"
                :theatre-possible="theatreTogglePossible"
                :use-theatre-mode="useTheatreMode"
                playback-engine="yt-dlp"
                @error="playerErrorHandler"
                @loaded="handleMediaLoaded"
                @legacy-format-selected="setCompanionFormat"
                @play="handlePlay"
                @playing="playCompanionAudio"
                @pause="handlePlaybackStopped"
                @waiting="handleBuffering"
                @ended="handleMediaEnded"
                @volume-updated="setCompanionVolume"
                @playback-rate-updated="updatePlaybackRate"
                @timeupdate="updateCurrentTime"
                @seeking="handleSeeking"
                @seeked="handleSeeked"
                @dock-panel-change="handleDockPanelChange"
                @toggle-theatre-mode="toggleTheatreMode"
                @chapters-overlay-change="handleChaptersOverlayChange"
                @chapter-thumbnails-change="chapterThumbnails = $event"
                @looped-chapter-change="loopedChapterIndex = $event"
                @toggle-transcript="toggleTranscript"
                @open-download="showDownloadPrompt = true"
              />
              <!-- eslint-disable-next-line vuejs-accessibility/media-has-caption -->
              <audio
                v-if="source.separateAudioUrl"
                ref="companionAudio"
                class="externalMediaCompanionAudio"
                :src="source.separateAudioUrl"
                preload="auto"
                hidden
                aria-hidden="true"
                @loadedmetadata="handleMediaLoaded"
                @ended="handleCompanionAudioEnded"
              />
            </template>
            <div
              v-else
              class="externalMediaState"
              role="status"
            >
              {{ t('Video.Upcoming') }}
            </div>
          </div>
        </div>
        <div class="infoArea">
          <FtCard class="watchVideo externalMediaDetails">
            <div class="externalMediaHeading">
              <h1
                class="videoTitle"
                dir="auto"
              >
                {{ info.title || mediaUrl }}
              </h1>
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
            <div class="externalMediaMetricsRow">
              <FtInlineMetadata
                class="externalMediaMetrics"
                icon-labels
              >
                <time
                  v-if="publishedDate"
                  class="publishedDate"
                  :datetime="publishedDate"
                  :title="`${publishedDateLabel} ${formattedPublishedDate}`"
                ><FtIcon
                  :icon="['fas', 'calendar-days']"
                  class="statIcon"
                  role="img"
                  :aria-label="publishedDateLabel"
                />{{ formattedPublishedDate }}</time>
                <span
                  v-if="publishedTimeAgo"
                  class="publishedTimeAgo"
                ><FtIcon
                  :icon="['fas', 'clock']"
                  class="statIcon"
                  aria-hidden="true"
                />{{ publishedTimeAgo }}</span>
                <span
                  v-if="formattedViewCount"
                  class="videoViews"
                ><FtIcon
                  :icon="['fas', 'eye']"
                  class="statIcon"
                  aria-hidden="true"
                />{{ formattedViewCount }}</span>
                <span v-if="metadata.concurrentViewCount !== null"><FtIcon
                  :icon="['fas', 'users']"
                  class="statIcon"
                  aria-hidden="true"
                />{{ t('Global.Counts.Watching Count', { count: formattedConcurrentViewCount }, metadata.concurrentViewCount) }}</span>
                <bdi
                  v-if="metadata.categories.length"
                  :title="`${t('Description.Video Category')} ${metadata.categories.join(', ')}`"
                ><FtIcon
                  :icon="['fas', 'icons']"
                  class="statIcon"
                  role="img"
                  :aria-label="t('Description.Video Category')"
                />{{ metadata.categories.join(', ') }}</bdi>
              </FtInlineMetadata>
              <WatchVideoLikes
                :like-count="metadata.likeCount"
                :dislike-count="metadata.dislikeCount"
              />
            </div>
            <FtInlineMetadata
              v-if="engagement.length"
              class="externalMediaMetrics"
              icon-labels
            >
              <span
                v-for="item in engagement"
                :key="item.label"
              ><FtIcon
                :icon="item.icon"
                class="statIcon"
                aria-hidden="true"
              />{{ item.text }}</span>
            </FtInlineMetadata>
            <div class="externalMediaCreator">
              <!-- Channels of supported platforms open in the app -->
              <component
                :is="creatorChannel ? 'router-link' : creatorUrl ? 'a' : 'span'"
                v-if="creatorName"
                class="externalMediaCreatorProfile"
                v-bind="creatorLinkAttributes"
              >
                <FtRetryImage
                  v-if="creatorAvatarUrl"
                  :fallback-icon="['fas', 'circle-user']"
                  :src="creatorAvatarUrl"
                  class="externalMediaCreatorAvatar"
                  alt=""
                />
                <span dir="auto">{{ creatorName }}</span>
              </component>
              <PlatformFollowButton
                v-if="creatorChannel"
                :platform="creatorChannel.platform"
                :channel-id="creatorChannel.id"
              />
              <a
                class="externalMediaSiteLink"
                :href="mediaUrl"
                target="_blank"
                rel="noopener noreferrer"
              >{{ hostname }}</a>
              <WatchVideoToolbar
                :actions="toolbarActions"
                :overflow-order="TOOLBAR_OVERFLOW_ORDER"
              >
                <template #primary="{ inToolbar }">
                  <FtIconButton
                    v-if="inToolbar('liveChat')"
                    :title="toolbarActions.liveChat.label"
                    :icon="['fas', 'message']"
                    :class="{ toolbarActive: toolbarActions.liveChat.active }"
                    theme="base-no-default"
                    :aria-pressed="toolbarActions.liveChat.active"
                    @click="toggleChat"
                  />
                  <FtIconButton
                    v-if="inToolbar('transcript')"
                    :title="toolbarActions.transcript.label"
                    :icon="['fas', 'file-lines']"
                    :class="{ toolbarActive: toolbarActions.transcript.active }"
                    theme="base-no-default"
                    :aria-pressed="toolbarActions.transcript.active"
                    @click="toggleTranscript"
                  />
                </template>
                <template #secondary>
                  <FtShareButton
                    v-if="!hideSharingActions"
                    id=""
                    :external-url="mediaUrl"
                    theme="base-no-default"
                  />
                </template>
                <template #trailing>
                  <FtButton
                    v-if="downloadAvailable"
                    class="downloadButton"
                    :title="t('Downloads.Download Video')"
                    :aria-label="t('Downloads.Download Video')"
                    :icon="['fas', 'download']"
                    theme="secondary"
                    shape="square"
                    @click="showDownloadPrompt = true"
                  >
                    <template #label>
                      <span class="downloadLabel">{{ t('Downloads.Download') }}</span>
                    </template>
                  </FtButton>
                </template>
              </WatchVideoToolbar>
            </div>
          </FtCard>
          <FtCard
            v-if="metadataRows.length"
            class="watchVideo externalMediaExtra"
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
          <PhoneDescriptionButton
            v-if="phonePanelsEnabled && hasDescription"
            :description="info.description"
            :tags="metadata.tags"
            :license="metadata.license"
            :panel-open="mobilePanel === 'description'"
            class="watchVideo phoneDescriptionPreview"
            @open="mobilePanel = 'description'"
          />
          <FtPhonePanel
            :enabled="phonePanelsEnabled"
            :open="mobilePanel === 'description'"
            class="phoneDescriptionPanel"
            :title="t('Description.Title')"
            @close="mobilePanel = null"
          >
            <WatchVideoDescription
              v-if="hasDescription"
              class="watchVideo externalMediaDescription"
              :description="info.description"
              :tags="metadata.tags"
              :license="metadata.license"
              :always-expanded="phonePanelsEnabled"
              @timestamp-event="seekTo"
            />
          </FtPhonePanel>
        </div>
        <aside class="sidebarArea">
          <WatchSidebarPanel
            :phone-enabled="phonePanelsEnabled"
            :phone-open="chaptersPanelOpen"
            :title="t('Chapters.Chapters')"
            transition="chapters-panel"
            @close="showChapters = false"
            @leaving="setSidebarPanelLeaving"
          >
            <WatchVideoChaptersPanel
              v-if="chaptersPanelOpen"
              class="watchVideoSideBar"
              :title="t('Chapters.Chapters')"
              :chapters="chapters"
              :chapter-thumbnails="chapterThumbnails"
              :current-chapter-index="currentChapterIndex"
              :fallback-thumbnail="thumbnail"
              :looped-chapter-index="loopedChapterIndex"
              @close="showChapters = false"
              @timestamp-event="seekTo"
              @copy-timestamp="copyChapterTimestamp"
              @loop-chapter="player?.toggleChapterLoop($event)"
            />
          </WatchSidebarPanel>
          <WatchSidebarPanel
            :dock-target="fullscreenTranscriptOpen ? fullscreenTranscriptTarget : null"
            :phone-enabled="phonePanelsEnabled"
            :phone-open="mobilePanel === 'transcript'"
            :title="t('Video.Transcript.Title')"
            custom-header
            @close="reason => closeSidebarPanel(reason, fullscreenTranscriptOpen, closeTranscript)"
            @leaving="setSidebarPanelLeaving"
          >
            <WatchVideoTranscript
              v-if="transcriptPanelOpen"
              :captions="transcriptCaptions"
              :current-time="currentTime"
              :preferred-caption-index="preferredTranscriptCaptionIndex"
              :video-title="info.title ?? ''"
              :fullscreen-overlay="fullscreenTranscriptOpen"
              class="watchVideoSideBar watchVideoTranscript"
              @close="closeTranscript"
              @timestamp-event="playTranscriptSegment"
            />
          </WatchSidebarPanel>
          <WatchSidebarPanel
            :dock-target="fullscreenLiveChatOpen ? fullscreenLiveChatTarget : null"
            :phone-enabled="phonePanelsEnabled"
            :phone-open="mobilePanel === 'chat'"
            :title="twitchChatTarget?.type === 'replay' ? t('Video.Live Chat Replay') : t('Video.Live Chat')"
            custom-header
            @close="reason => closeSidebarPanel(reason, fullscreenLiveChatOpen, closeChat)"
            @leaving="setSidebarPanelLeaving"
          >
            <TwitchChat
              v-if="chatAvailable && chatOpen"
              :key="`${twitchChatTarget.type}:${twitchChatTarget.id}`"
              class="watchVideoSideBar phoneLiveChat"
              :target="twitchChatTarget"
              :current-time="currentTime"
              :seek-count="seekCount"
              :seeking="seeking"
              :fullscreen-overlay="fullscreenLiveChatOpen"
              @close="closeChat"
            />
          </WatchSidebarPanel>
        </aside>
      </div>
    </template>
    <WatchVideoDownloadPrompt
      v-if="enableDownloads && showDownloadPrompt"
      :key="mediaUrl"
      :external-url="mediaUrl"
      :title="info?.title || mediaUrl"
      :thumbnail="thumbnail"
      @close="showDownloadPrompt = false"
    />
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtButton from '../../components/FtButton/FtButton.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtInlineMetadata from '../../components/FtInlineMetadata/FtInlineMetadata.vue'
import FtIconButton from '../../components/FtIconButton/FtIconButton.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import FtRetryImage from '../../components/FtRetryImage.vue'
import FtShareButton from '../../components/FtShareButton/FtShareButton.vue'
import FtShakaVideoPlayer from '../../components/ft-shaka-video-player/ft-shaka-video-player.vue'
import WatchVideoDescription from '../../components/WatchVideoDescription/WatchVideoDescription.vue'
import PhoneDescriptionButton from '../../components/PhoneDescriptionButton/PhoneDescriptionButton.vue'
import WatchVideoChaptersPanel from '../../components/WatchVideoChaptersPanel/WatchVideoChaptersPanel.vue'
import WatchVideoDownloadPrompt from '../../components/WatchVideoDownloadPrompt/WatchVideoDownloadPrompt.vue'
import WatchVideoLikes from '../../components/WatchVideoLikes/WatchVideoLikes.vue'
import WatchVideoTranscript from '../../components/WatchVideoTranscript/WatchVideoTranscript.vue'
import WatchSidebarPanel from '../../components/WatchSidebarPanel/WatchSidebarPanel.vue'
import WatchVideoToolbar from '../../components/WatchVideoToolbar/WatchVideoToolbar.vue'
import WatchVideoInfoSkeleton from '../../components/WatchVideoInfoSkeleton/WatchVideoInfoSkeleton.vue'
import FtPhonePanel from '../../components/FtPhonePanel/FtPhonePanel.vue'
import TwitchChat from './TwitchChat.vue'
import PlatformFollowButton from '../../components/PlatformFollowButton/PlatformFollowButton.vue'
import { getTwitchChatTarget } from './twitchChat'
import { getExternalYtDlpPlaybackSource, releaseTwitchVodRegistration } from '../../helpers/player/ytDlpPlayback'
import { createTheatreModeAnimator, isTheatreLayoutAvailable } from '../../helpers/watchLayout'
import { useRootClass } from '../../helpers/rootClasses'
import { getPreferredCaption } from '../../../captionLanguages'
import { usePhoneLayout } from '../../composables/usePhoneLayout'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'
import { buildChaptersVttFile, formatDurationAsTimestamp, formatViewCount, getRelativeTimeFromDate } from '../../helpers/utils'
import { formatDate } from '../../helpers/dateFormat'
import { useMediaSessionMetadata } from '../../composables/useMediaSessionMetadata'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { isExternalMediaUrl } from '../../helpers/externalMediaUrl'
import { getExternalMediaAuthorId, getExternalMediaHistoryId } from '../../helpers/externalMediaHistory'
import { hasReachedWatchedThreshold, isHistoryEntryWatched } from '../../helpers/history'
import { findPlatformChannel, getPlatformChannelRoute } from '../../../platforms/index'
import { createWatchTimeTracker } from '../../helpers/watchTimeTracker'
import { useTabAvatar, useTabContext, useTabLifecycle, useTabTitle } from '../../tabs/TabContext'
import store from '../../store/index'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const relativeTimeNow = useRelativeTimeClock()
const setTabTitle = useTabTitle()
const setTabAvatar = useTabAvatar()
const { isTabPresented } = useTabContext()

const loading = ref(true)
const errorMessage = ref('')
const info = shallowRef(null)
const source = shallowRef(null)
const player = useTemplateRef('player')
const companionAudio = useTemplateRef('companionAudio')
const companionAudioNeeded = ref(false)
const videoLayout = useTemplateRef('videoLayout')
const phoneLayout = usePhoneLayout()
provide('phonePanelPlayer', () => player.value?.$refs.container)
provide('phonePanelInlinePlayer', () => player.value?.scrollMiniPlayerActive
  ? player.value.$refs.scrollMiniPlaceholder
  : player.value?.$refs.container)
const mediaUrl = ref('')
const currentTime = ref(0)
const startTime = ref(null)
/** @type {number | null} where a timestamp link starts the media, instead of the saved position */
let startTimestamp = null
let lastPositionSave = 0
let lastSavedPosition = 0
let hasBeenPresented = isTabPresented?.value ?? true
watch(() => isTabPresented?.value, presented => {
  if (!presented) return
  hasBeenPresented = true
  addToHistoryOnce()
})
// Like on the watch page, media joins the history once it plays.
let historyAdded = false
let watchedMarkPending = false
const historyId = computed(() => getExternalMediaHistoryId(mediaUrl.value))
const historyEntry = computed(() => historyId.value ? store.getters.getHistoryCacheById[historyId.value] : undefined)
const showChapters = ref(false)
const showDownloadPrompt = ref(false)
const enableDownloads = computed(() => store.getters.getEnableDownloads)
const defaultPlaybackRate = computed(() => store.getters.getDefaultPlayback)
const currentPlaybackRate = ref(defaultPlaybackRate.value)
const ambientModeActive = computed(() => store.getters.getAmbientMode && source.value && !source.value.audioOnly)
// Ambient light extends past the layout, so the app clips its overflow.
useRootClass('appAmbientMode', () => Boolean(ambientModeActive.value))
const attemptUsedCookies = ref(false)
const drmError = ref(false)
const seekCount = ref(0)
const seeking = ref(false)
const chatOpen = ref(true)
const useTheatreMode = ref(false)
let theatreModeToggledManually = false
const theatreModeAnimator = createTheatreModeAnimator()
const theatreLayoutAvailable = ref(isTheatreLayoutAvailable())
const showTranscript = ref(false)
const fullscreenLiveChatOpen = ref(false)
const fullscreenLiveChatTarget = shallowRef(null)
const fullscreenTranscriptOpen = ref(false)
const fullscreenTranscriptTarget = shallowRef(null)
const sidebarPanelLeaving = ref(false)
// Like on the watch page, phones show the panels as sheets over the page.
const phonePanelsEnabled = computed(() => phoneLayout.value && !fullscreenLiveChatOpen.value && !fullscreenTranscriptOpen.value)
let loadGeneration = 0
const canRetryWithCookies = computed(() => errorMessage.value && !drmError.value && isExternalMediaUrl(mediaUrl.value) && !attemptUsedCookies.value &&
  hasConfiguredRestrictedPlaybackAuthentication(store.getters))
let seekTimer = null
// Digital wellbeing limits count playback even when watch statistics are off.
const watchTimeTracker = createWatchTimeTracker(
  () => !loading.value && player.value?.isPaused() === false,
  (date, seconds, retry) => store.dispatch('recordPlaybackTime', { date, seconds, isShort: false, retry })
)
watch(() => store.getters.getWatchStatsResetVersion, () => watchTimeTracker.clear())
// Buffered time follows the recording policy it was watched under.
watch(() => [store.getters.getRememberHistory, store.getters.getEnableWatchStats], () => watchTimeTracker.clear())
watch(() => store.getters.getWellbeingPauseRequest, request => {
  if (request && !request.shortsOnly && player.value?.isPaused() === false) player.value.pause()
})

const hostname = computed(() => {
  try {
    return new URL(mediaUrl.value).hostname
  } catch {
    return ''
  }
})
const isCoub = computed(() => hostname.value === 'coub.com' || hostname.value.endsWith('.coub.com'))
const twitchChatTarget = computed(() => {
  if (loading.value || (errorMessage.value && !info.value)) return getTwitchChatTarget(mediaUrl.value, true)
  if (!info.value || !source.value) return null
  return getTwitchChatTarget(info.value.webpageUrl, source.value.isLive) ?? getTwitchChatTarget(mediaUrl.value, source.value.isLive)
})
const chatAvailable = computed(() => twitchChatTarget.value && !(twitchChatTarget.value.type === 'replay'
  ? store.getters.getHideLiveChatReplay
  : store.getters.getHideLiveChat))
const chaptersPanelOpen = computed(() => Boolean(source.value && chapters.value.length && showChapters.value))
// The transcript reads WebVTT and SRT, while other sites may only offer TTML.
const transcriptCaptions = computed(() => source.value?.captions.filter(caption => caption.mimeType !== 'application/ttml+xml') ?? [])
const transcriptAvailable = computed(() => transcriptCaptions.value.length > 0 && !source.value.isLive)
const transcriptPanelOpen = computed(() => transcriptAvailable.value && showTranscript.value)
const preferredTranscriptCaptionIndex = computed(() => {
  const captions = transcriptCaptions.value
  const caption = getPreferredCaption(captions, store.getters.getPreferredCaptionLocale || locale.value, store.getters.getEnableCaptionTranslations)
  return caption ? captions.indexOf(caption) : 0
})
const sidebarPanelsOpen = computed(() => Boolean(chatAvailable.value && chatOpen.value) || chaptersPanelOpen.value || transcriptPanelOpen.value)
// Phones show the panels as sheets instead.
const hasSidebar = computed(() => !phonePanelsEnabled.value && sidebarPanelsOpen.value)
// Keep the sidebar column while its last panel animates out. This has to run
// before the render that removes the panel, which is too late for its
// before-leave hook.
watch(sidebarPanelsOpen, (open, wasOpen) => {
  if (wasOpen && !open && !phonePanelsEnabled.value) sidebarPanelLeaving.value = true
}, { flush: 'sync' })
/** @param {boolean} leaving */
function setSidebarPanelLeaving(leaving) {
  sidebarPanelLeaving.value = leaving && !phonePanelsEnabled.value
}
const theatreTogglePossible = computed(() => theatreLayoutAvailable.value && hasSidebar.value)
// Like on the watch page, with theatre as the default, the first panel opened
// on media without a sidebar appears below the video instead of beside it,
// unless the user has chosen a layout.
watch(hasSidebar, (has, had) => {
  if (has && !had && !loading.value && theatreTogglePossible.value && !theatreModeToggledManually &&
    store.getters.getDefaultViewingMode === 'theatre') useTheatreMode.value = true
})

function handleChaptersOverlayChange(open) {
  showChapters.value = open
}

function toggleTheatreMode() {
  theatreModeToggledManually = true
  return theatreModeAnimator.animate(videoLayout.value, () => {
    useTheatreMode.value = !useTheatreMode.value
  })
}

function toggleTranscript() {
  if (transcriptShown.value) {
    closeTranscript()
    return
  }
  showTranscript.value = true
  if (phonePanelsEnabled.value) mobilePanel.value = 'transcript'
}

function closeTranscript() {
  if (mobilePanel.value === 'transcript') mobilePanel.value = null
  showTranscript.value = false
  player.value?.dismissFullscreenTranscript()
}

function playTranscriptSegment(seconds) {
  if (!player.value?.hasLoaded) return
  seekTo(seconds)
  if (player.value.isPaused()) player.value.play()
}

// Like on the watch page, phone sheets only open on request, not when the
// layout switches to phone with a panel open.
/** @type {import('vue').Ref<'chat' | 'transcript' | 'description' | null>} */
const mobilePanel = ref(null)
const chatShown = computed(() => phonePanelsEnabled.value ? mobilePanel.value === 'chat' : chatOpen.value)
const transcriptShown = computed(() => phonePanelsEnabled.value ? mobilePanel.value === 'transcript' : showTranscript.value)
const hasDescription = computed(() => Boolean(info.value?.description || metadata.value.tags?.length || metadata.value.license))

// The order in which actions move to the More menu
const TOOLBAR_OVERFLOW_ORDER = ['transcript', 'liveChat']
const toolbarActions = computed(() => ({
  liveChat: {
    visible: Boolean(chatAvailable.value),
    label: twitchChatTarget.value?.type === 'replay'
      ? chatShown.value ? t('Video.Close Live Chat Replay') : t('Video.Show Live Chat Replay')
      : chatShown.value ? t('Video.Close Live Chat') : t('Video.Show Live Chat'),
    icon: ['fas', 'message'],
    active: chatShown.value,
    run: toggleChat
  },
  transcript: {
    visible: transcriptAvailable.value,
    label: transcriptShown.value ? t('Video.Transcript.Hide') : t('Video.Transcript.Show'),
    icon: ['fas', 'file-lines'],
    active: transcriptShown.value,
    run: toggleTranscript
  }
}))

/**
 * Docking a panel disables its phone sheet, which reports that as a
 * presentation close. That only moves the panel into the dock, unlike
 * closing the sheet or pressing Escape in the dock.
 * @param {string | undefined} reason
 * @param {boolean} docked
 * @param {() => void} close
 */
function closeSidebarPanel(reason, docked, close) {
  if (reason === 'presentation' && docked) mobilePanel.value = null
  else close()
}

function closeChat() {
  if (mobilePanel.value === 'chat') mobilePanel.value = null
  chatOpen.value = false
  player.value?.closeFullscreenLiveChat()
}

function toggleChat() {
  if (chatShown.value) {
    closeChat()
    return
  }
  chatOpen.value = true
  if (phonePanelsEnabled.value) mobilePanel.value = 'chat'
}

/** The player only offers the live chat and transcript docks for external media. */
function handleDockPanelChange({ panel, open, target }) {
  if (panel === 'transcript') {
    fullscreenTranscriptTarget.value = open ? target : null
    fullscreenTranscriptOpen.value = open && target !== null
  } else if (panel === 'liveChat') {
    fullscreenLiveChatTarget.value = open ? target : null
    fullscreenLiveChatOpen.value = open && target !== null
    if (fullscreenLiveChatOpen.value) chatOpen.value = true
  }
}

function updateTheatreLayoutAvailability() {
  theatreLayoutAvailable.value = isTheatreLayoutAvailable()
}

function handleSeeking(time) {
  // A seek takes precedence over a restore still waiting for companion metadata.
  startTime.value = null
  if (seekTimer !== null) clearTimeout(seekTimer)
  seekTimer = null
  seeking.value = true
  currentTime.value = time
  syncCompanionAudio(time, 0)
}

function handleSeeked(time) {
  currentTime.value = time
  syncCompanionAudio(time, 0)
  if (store.getters.getWatchedProgressSavingMode === 'auto' || player.value?.isPaused()) savePosition()
  if (seekTimer !== null) clearTimeout(seekTimer)
  seekTimer = setTimeout(() => {
    seekTimer = null
    seeking.value = false
    seekCount.value++
  }, 150)
}

onMounted(() => {
  window.addEventListener('resize', updateTheatreLayoutAvailability)
  window.addEventListener('beforeunload', savePositionOnExit)
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
/** @type {import('vue').Ref<number | null>} */
const loopedChapterIndex = ref(null)
const chapterThumbnails = shallowRef([])
const autoOpenChapters = computed(() => !process.env.IS_CAPACITOR && store.getters.getAutoOpenChapters)
const downloadAvailable = computed(() => enableDownloads.value && Boolean(source.value) && !source.value.twitchSubOnlyVod)
const currentChapterIndex = computed(() => chapters.value.findLastIndex(chapter => currentTime.value >= chapter.startSeconds))
const chaptersSrc = computed(() => chapters.value.some(chapter => chapter.endSeconds !== null)
  ? `data:text/vtt,${encodeURIComponent(buildChaptersVttFile(chapters.value.filter(chapter => chapter.endSeconds !== null)))}`
  : '')
const creatorName = computed(() => info.value?.channel || info.value?.uploader || '')
const musicPlayerArtist = computed(() => metadata.value.artists?.join(', ') || creatorName.value)
useMediaSessionMetadata(() => source.value && !errorMessage.value
  ? { title: info.value.title ?? '', artist: musicPlayerArtist.value, artworkSrc: thumbnail.value }
  : null)
const creatorUrl = computed(() => safeWebUrl(info.value?.channel ? info.value.channelUrl : info.value?.uploaderUrl))
const creatorAvatarUrl = computed(() => safeWebUrl(info.value?.channel ? info.value.channelThumbnail : info.value?.uploaderThumbnail))
// Only the creator's profile names the channel; the media URL can be a clip or VOD
const creatorChannel = computed(() => findPlatformChannel(creatorUrl.value))
// A fallthrough href, even an undefined one, would replace the router link's own
const creatorLinkAttributes = computed(() => {
  if (creatorChannel.value) return { to: getPlatformChannelRoute(creatorChannel.value.platform, creatorChannel.value.id) }
  return creatorUrl.value ? { href: creatorUrl.value, target: '_blank', rel: 'noopener noreferrer' } : {}
})
const hideSharingActions = computed(() => store.getters.getHideSharingActions)
const formattedViewCount = computed(() => {
  const count = info.value?.viewCount
  if (store.getters.getHideVideoViews || count == null) return ''
  return t('Global.Counts.View Count', { count: formatViewCount(count, store.getters.getShortenViewCounts) }, count)
})
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
const formattedPublishedDate = computed(() => formatDate(
  new Date(publishedDate.value),
  locale.value,
  store.getters.getDateFormat,
  { dateStyle: 'medium', ...(publishedTimestamp.value === null ? { timeZone: 'UTC' } : {}) }
).replaceAll(' ', '\u00A0'))
const publishedTimeAgo = computed(() => {
  const date = new Date(publishedDate.value).getTime()
  if (!locale.value || !Number.isFinite(date) || date <= 0 || date > relativeTimeNow.value) return ''
  return getRelativeTimeFromDate(date, false, true, relativeTimeNow.value)
})
const publishedDateLabel = computed(() => {
  if (info.value?.liveStatus === 'is_live') return t('Video.Started streaming on')
  return ['was_live', 'post_live'].includes(info.value?.liveStatus)
    ? t('Video.Streamed on')
    : t('Video.Published on')
})
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
    ['commentCount', 'comment', value => t('Global.Counts.Comment Count', { count: numberFormat.value.format(value) }, value)],
    ['repostCount', 'retweet', value => engagementCount(value, t('Video.External Media.Reposts', {}, value))],
    ['saveCount', 'bookmark', value => engagementCount(value, t('Video.External Media.Saves', {}, value))]
  ]
  return counts.flatMap(([key, icon, format]) => metadata.value[key] === null
    ? []
    : [{ label: key, icon: ['fas', icon], text: format(metadata.value[key]) }])
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

// Playback may drift slightly between the tracks, but a seek has to land exactly.
function syncCompanionAudio(time, tolerance = 0.5) {
  const audio = companionAudio.value
  // A looping Coub video has its own timeline; seeking it must not restart the soundtrack.
  if (audio && companionAudioNeeded.value && !getCompanionVideo()?.loop && Number.isFinite(time) && Math.abs(audio.currentTime - time) > tolerance) {
    audio.currentTime = time
  }
}

function getCompanionVideo() {
  return videoLayout.value?.querySelector('.videoPlayer video')
}

function getPositionMedia() {
  const video = getCompanionVideo()
  return companionAudioNeeded.value && video?.loop ? companionAudio.value : video
}

function restoreCompanionPosition() {
  if (!source.value?.separateAudioUrl || startTime.value === null || !player.value?.hasLoaded) return
  if (!hasCompanionMetadata()) return
  const video = getCompanionVideo()
  const audio = companionAudio.value
  // Separate tracks can have different lengths. Wait for metadata before
  // deciding whether the soundtrack or the video supplies the resume timeline.
  const media = getPositionMedia()
  const position = getStartPosition(media.duration)
  lastSavedPosition = position ?? 0
  startTime.value = null
  if (position === null) return
  if (media === audio) {
    audio.currentTime = position
    player.value.setCurrentTime(position % video.duration)
  } else {
    player.value.setCurrentTime(position)
    syncCompanionAudio(position, 0)
  }
}

/**
 * Like on the watch page, a timestamp link starts there instead of at the saved position.
 * @param {number | null} duration
 */
function getStartPosition(duration) {
  if (startTimestamp !== null && (!Number.isFinite(duration) || startTimestamp < duration)) return startTimestamp
  if (!store.getters.getRememberHistory || store.getters.getWatchedProgressSavingMode === 'never') return null
  const position = historyEntry.value?.watchProgress
  // Like on the watch page, media within two seconds of its end restarts.
  if (!(position > 0) || (Number.isFinite(duration) && position >= duration - 2)) return null
  return position
}

/** @returns {number | null} */
function getQueryTimestamp() {
  const seconds = parseFloat(route.query.timestamp)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

/** Like on the watch page, restoring or reloading the tab later resumes instead of returning to the timestamp. */
function consumeTimestamp() {
  if (!('timestamp' in route.query)) return
  const query = { ...route.query }
  delete query.timestamp
  router.replace({
    path: route.path,
    query,
    hash: route.hash,
    state: { skipTabRouteLoading: true, preserveScroll: true, tabTitle: info.value?.title || hostname.value }
  })
}

function handleMediaLoaded() {
  updateCompanionLoop()
  restoreCompanionPosition()
  addToHistoryOnce()
  applyQueryTimestamp()
}

function getMediaDuration() {
  const media = getPositionMedia()
  return Number.isFinite(media?.duration) ? media.duration : info.value?.duration
}

/**
 * @param {number} watchProgress
 * @param {boolean} [isWatched]
 */
function addToHistory(watchProgress, isWatched = isHistoryEntryWatched(historyEntry.value)) {
  const entry = historyEntry.value
  const duration = getMediaDuration()
  const published = publishedDate.value ? new Date(publishedDate.value).getTime() : NaN
  return store.dispatch('updateHistory', {
    ...entry,
    videoId: historyId.value,
    title: info.value.title || entry?.title || historyId.value,
    // A later extraction can lack the creator
    author: creatorName.value || entry?.author || '',
    authorId: creatorChannel.value
      ? getExternalMediaAuthorId(creatorChannel.value.platform, creatorChannel.value.id)
      : (entry?.authorId ?? ''),
    ...(creatorAvatarUrl.value ? { authorThumbnail: creatorAvatarUrl.value } : {}),
    thumbnail: thumbnail.value,
    published: Number.isFinite(published) && published > 0 ? published : (entry?.published ?? 0),
    description: info.value.description ?? '',
    ...(Number.isFinite(info.value.viewCount) ? { viewCount: info.value.viewCount } : {}),
    lengthSeconds: Number.isFinite(duration) && duration > 0 ? duration : (entry?.lengthSeconds ?? 0),
    watchProgress,
    isWatched,
    timeWatched: Date.now(),
    isLive: source.value.isLive === true,
    isUpcoming: false,
    type: 'video',
  })
}

function addToHistoryOnce() {
  if (historyAdded || !hasBeenPresented || !store.getters.getRememberHistory || historyId.value === null ||
    loading.value || !info.value || !source.value || !player.value?.hasLoaded ||
    // Only both tracks' lengths tell how long the media is.
    (source.value.separateAudioUrl && !hasCompanionMetadata())) return
  historyAdded = true
  addToHistory(startTimestamp ?? historyEntry.value?.watchProgress ?? 0)
}

/**
 * @param {number} seconds
 * @param {boolean} [isFinished]
 */
function markAsWatchedIfFinished(seconds, isFinished = false) {
  if (!hasBeenPresented || !store.getters.getRememberHistory || source.value?.isLive ||
    isHistoryEntryWatched(historyEntry.value) || watchedMarkPending) return
  if (!isFinished && player.value?.isPaused()) return
  if (!isFinished && !hasReachedWatchedThreshold(seconds, getMediaDuration(), store.getters.getWatchedPercentageThreshold)) return
  const watchProgress = store.getters.getWatchedProgressSavingMode === 'never' ? (historyEntry.value?.watchProgress ?? 0) : seconds
  watchedMarkPending = true
  addToHistory(watchProgress, true).finally(() => { watchedMarkPending = false })
}

function hasCompanionMetadata() {
  return Number.isFinite(getCompanionVideo()?.duration) &&
    (!companionAudioNeeded.value || Number.isFinite(companionAudio.value?.duration))
}

function applyQueryTimestamp() {
  const seconds = getQueryTimestamp()
  if (seconds === null || loading.value || !player.value?.hasLoaded) return
  if (source.value?.separateAudioUrl && !hasCompanionMetadata()) {
    // Only both tracks' lengths tell which one supplies the timeline, so the
    // companion restore applies the link once the soundtrack's metadata arrives.
    startTimestamp = seconds
    startTime.value = seconds
  } else {
    // The link wins over a restore still waiting for companion metadata.
    startTime.value = null
    seekTo(seconds)
  }
  consumeTimestamp()
}

function updateCompanionLoop() {
  const video = getCompanionVideo()
  const audio = companionAudio.value
  if (!video || !audio) return
  video.loop = companionAudioNeeded.value && (isCoub.value ||
    (Number.isFinite(video.duration) && Number.isFinite(audio.duration) && audio.duration > video.duration + 0.5))
  audio.loop = companionAudioNeeded.value && isCoub.value
}

function setCompanionFormat(format) {
  companionAudioNeeded.value = Boolean(source.value?.separateAudioUrl && format.requiresSeparateAudio)
  if (!companionAudioNeeded.value) pauseCompanionAudio()
  updateCompanionLoop()
  restoreCompanionPosition()
}

function handleCompanionAudioEnded() {
  if (!companionAudioNeeded.value) return
  // A longer soundtrack ends the media while the video loops.
  if (getPositionMedia() === companionAudio.value && !isCoub.value) markAsWatchedIfFinished(companionAudio.value.currentTime, true)
  savePosition()
  if (!isCoub.value) {
    pauseCompanionVideo()
    return
  }
  const audio = companionAudio.value
  if (audio && !getCompanionVideo()?.paused) {
    audio.currentTime = 0
    playCompanionAudio()
  }
}

function handlePlay() {
  const wellbeingBlock = store.getters.getWellbeingPlaybackBlock(false)
  if (wellbeingBlock) {
    player.value?.pause()
    store.commit('showWellbeingPrompt', wellbeingBlock)
    return
  }
  store.commit('markWellbeingPlay', Date.now())
  playCompanionAudio()
}

function playCompanionAudio() {
  const audio = companionAudio.value
  if (!audio || !companionAudioNeeded.value) return
  const video = getCompanionVideo()
  if (video) {
    audio.volume = video.muted ? 0 : video.volume
    audio.playbackRate = video.playbackRate
  }
  updateCompanionLoop()
  syncCompanionAudio(currentTime.value)
  audio.play().catch(error => {
    if (error?.name !== 'AbortError' && companionAudio.value === audio && audio.paused) pauseCompanionVideo()
  })
}

function pauseCompanionAudio() { companionAudio.value?.pause() }
function handleBuffering() {
  pauseCompanionAudio()
  // Buffering keeps the media unpaused, so restart the watch time baseline when playback resumes.
  watchTimeTracker.flush()
}
function pauseCompanionVideo() { getCompanionVideo()?.pause() }
function setCompanionVolume(volume) {
  if (companionAudio.value) companionAudio.value.volume = volume
}
function updatePlaybackRate(rate) {
  // Retrying remounts the player, which must keep the chosen speed.
  currentPlaybackRate.value = rate
  if (companionAudio.value) companionAudio.value.playbackRate = rate
}
function updateCurrentTime(seconds) {
  currentTime.value = seconds
  syncCompanionAudio(seconds)
  watchTimeTracker.track()
  markAsWatchedIfFinished(getPositionMedia()?.currentTime ?? seconds)
  if (store.getters.getWatchedProgressSavingMode === 'auto' && Date.now() - lastPositionSave >= 2000) savePosition()
}

function savePosition() {
  if (!store.getters.getRememberHistory || store.getters.getWatchedProgressSavingMode === 'never' ||
    loading.value || !source.value || source.value.isLive || !player.value?.hasPlaybackPosition ||
    !hasBeenPresented || (source.value.separateAudioUrl && startTime.value !== null)) return
  const seconds = getPositionMedia()?.currentTime ?? player.value.getCurrentTime()
  // Pausing or disposing an unchanged tab must not overwrite another tab's progress.
  if (seconds === lastSavedPosition) return
  const duration = getMediaDuration()
  // Choosing another format can change which track sets the length.
  if (historyEntry.value && !(duration > 0 && Math.abs(duration - historyEntry.value.lengthSeconds) > 1)) {
    store.dispatch('updateWatchProgress', { videoId: historyId.value, watchProgress: seconds })
  } else {
    addToHistory(seconds)
  }
  lastSavedPosition = seconds
  lastPositionSave = Date.now()
}

function savePositionOnExit() {
  watchTimeTracker.flush()
  if (store.getters.getWatchedProgressSavingMode === 'auto') savePosition()
}

function handleMediaEnded() {
  markAsWatchedIfFinished(getPositionMedia()?.currentTime ?? currentTime.value, true)
  handlePlaybackStopped()
}

function handlePlaybackStopped() {
  pauseCompanionAudio()
  watchTimeTracker.flush()
  savePosition()
}
function seekTo(seconds) {
  // A looping video over a longer soundtrack follows the soundtrack's timeline.
  const audio = companionAudio.value
  const video = getCompanionVideo()
  if (audio && getPositionMedia() === audio && Number.isFinite(video?.duration)) {
    audio.currentTime = seconds
    player.value?.setCurrentTime(seconds % video.duration, true)
  } else {
    player.value?.setCurrentTime(seconds, true)
  }
}
function copyChapterTimestamp(seconds) { player.value?.copyChapterTimestamp(seconds) }

function handlePlayerError(error) {
  if (loading.value || !source.value) return
  savePosition()
  drmError.value = error?.code === 6001
  errorMessage.value = drmError.value
    ? t('Video.External DRM Protected')
    : error?.message ?? String(error)
}

async function loadMedia(url, useCookies = store.getters.getYtDlpPlaybackAlwaysUseCookies) {
  savePositionOnExit()
  releaseTwitchVodRegistration(source.value)
  showDownloadPrompt.value = false
  if (seekTimer !== null) clearTimeout(seekTimer)
  seekTimer = null
  if (url !== mediaUrl.value) currentPlaybackRate.value = defaultPlaybackRate.value
  const generation = ++loadGeneration
  companionAudioNeeded.value = false
  playerErrorHandler.value = error => {
    if (generation === loadGeneration) handlePlayerError(error)
  }
  mediaUrl.value = typeof url === 'string' ? url : ''
  attemptUsedCookies.value = useCookies
  drmError.value = false
  loading.value = true
  errorMessage.value = ''
  info.value = null
  source.value = null
  currentTime.value = 0
  startTime.value = null
  startTimestamp = null
  lastPositionSave = 0
  lastSavedPosition = 0
  hasBeenPresented = isTabPresented?.value ?? true
  historyAdded = false
  watchedMarkPending = false
  showChapters.value = false
  showTranscript.value = false
  mobilePanel.value = null
  chapterThumbnails.value = []
  seekCount.value = 0
  seeking.value = false
  chatOpen.value = true
  useTheatreMode.value = store.getters.getDefaultViewingMode === 'theatre'
  theatreModeToggledManually = false
  fullscreenLiveChatOpen.value = false
  fullscreenLiveChatTarget.value = null
  fullscreenTranscriptOpen.value = false
  fullscreenTranscriptTarget.value = null
  // The panels unmount with the layout, without a leave transition.
  sidebarPanelLeaving.value = false
  setTabTitle(hostname.value || 'Watch')

  if (!isExternalMediaUrl(url)) {
    errorMessage.value = t('Video.Invalid Media URL')
    loading.value = false
    return
  }

  try {
    const result = await getExternalYtDlpPlaybackSource(url, useCookies)
    if (generation !== loadGeneration) {
      releaseTwitchVodRegistration(result.source)
      return
    }
    info.value = result.info
    if (!result.source?.isLive) {
      startTimestamp = getQueryTimestamp()
      // Separate tracks wait for their metadata before choosing the position.
      startTime.value = getStartPosition(result.source?.separateAudioUrl ? null : result.info.duration)
      lastSavedPosition = startTime.value ?? 0
    }
    source.value = result.source
    setTabTitle(result.info.title || hostname.value)
    consumeTimestamp()
    if (creatorAvatarUrl.value) setTabAvatar(creatorAvatarUrl.value)
  } catch (error) {
    if (generation !== loadGeneration) return
    errorMessage.value = error.message
  } finally {
    if (generation === loadGeneration) {
      loading.value = false
      // Like on the watch page, the theatre default only applies to media that
      // loads with a sidebar until a panel opens.
      useTheatreMode.value &&= theatreTogglePossible.value
    }
  }
}

watch(() => route.query.url, url => loadMedia(url), { immediate: true })
// A timestamp link for the loaded media seeks instead of reloading it. While
// it loads, the start position reads the link once extraction finishes, and
// afterwards the player applies it once it has loaded.
watch(() => route.query.timestamp, applyQueryTimestamp)
watch(downloadAvailable, available => { if (!available) showDownloadPrompt.value = false })
useTabLifecycle({
  beforeNavigate: savePositionOnExit,
  deactivate: savePositionOnExit,
  beforeDispose: savePositionOnExit,
})
onBeforeUnmount(() => {
  savePositionOnExit()
  releaseTwitchVodRegistration(source.value)
  theatreModeAnimator.cancel()
  loadGeneration++
  if (seekTimer !== null) clearTimeout(seekTimer)
  window.removeEventListener('resize', updateTheatreLayoutAvailability)
  window.removeEventListener('beforeunload', savePositionOnExit)
})
</script>

<style scoped src="./ExternalMedia.scss" lang="scss" />
