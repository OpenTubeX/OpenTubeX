<template>
  <FtCard class="watchVideoInfo">
    <div>
      <!-- rendered as HTML so that the hashtags and handles in the title are clickable -->
      <h1
        v-safer-html="titleHtml"
        class="videoTitle"
        dir="auto"
      />
      <div
        v-if="isUnlisted || isAgeRestricted || hasAiGeneratedContent || sponsorBlockFullVideoCategory"
        class="videoBadges"
      >
        <div
          v-if="isUnlisted"
          class="videoBadge unlistedBadge"
        >
          <FtIcon
            :icon="['fas', 'eye-slash']"
            aria-hidden="true"
          />
          {{ t('Video.Unlisted') }}
        </div>
        <div
          v-if="isAgeRestricted"
          class="videoBadge ageRestrictedBadge"
        >
          <FtIcon
            :icon="['fas', 'user-lock']"
            aria-hidden="true"
          />
          {{ t('Video.Age Restricted Badge') }}
        </div>
        <div
          v-if="hasAiGeneratedContent"
          :aria-label="t('Video.AI-generated content')"
          :title="t('Video.AI-generated content')"
          class="videoBadge"
        >
          <FtIcon :icon="['fas', 'info-circle']" />
          {{ t('Video.AI') }}
        </div>
        <div
          v-if="sponsorBlockFullVideoCategory"
          class="videoBadge"
        >
          <FtIcon :icon="['fas', 'shield-halved']" />
          {{ t('Video.Player.SponsorBlock.FullVideoLabel', {
            segmentCategory: translateSponsorBlockCategory(sponsorBlockFullVideoCategory)
          }) }}
        </div>
      </div>
    </div>
    <div class="videoMetrics">
      <FtInlineMetadata class="datePublishedAndViewCount">
        <span
          v-if="publishedDateText"
          class="publishedDate"
        >{{ publishedDateText }}</span>
        <span
          v-if="publishedTimeAgo && !isPremiereInProgress"
          class="publishedTimeAgo"
        >{{ publishedTimeAgo }}</span>
        <span
          v-if="parsedViewCount"
          class="videoViews"
        >{{ parsedViewCount }}</span>
        <bdi
          v-if="category"
          class="videoCategory"
        >
          <strong>{{ t('Description.Video Category') }}</strong> {{ category }}
        </bdi>
      </FtInlineMetadata>
      <WatchVideoLikes
        :like-count="likeCount"
        :dislike-count="useReturnYoutubeDislikes ? dislikeCount : null"
      />
    </div>
    <div
      ref="videoButtons"
      class="videoButtons"
    >
      <div
        class="profileRow"
      >
        <button
          v-if="!hideUploader && hasMultipleCollaborators"
          type="button"
          class="collaboratorSummary"
          @click="showCollaboratorsPrompt = true"
        >
          <span class="collaboratorSummaryThumbnails">
            <span
              v-for="collaborator in channelCollaborators"
              :key="collaborator.id"
              class="channelThumbnail collaboratorThumbnail"
            >
              <FtRetryImage
                :fallback-icon="['fas', 'circle-user']"
                :src="collaborator.thumbnail"
                class="collaboratorThumbnailImage"
                alt=""
              />
            </span>
          </span>
          <span
            class="channelName collaboratorSummaryName"
            dir="auto"
          >
            {{ collaboratorSummaryName }}
          </span>
        </button>
        <template v-else>
          <div
            v-if="!hideUploader"
          >
            <component
              :is="enableChannelLinks ? 'RouterLink' : 'div'"
              :to="`/channel/${channelId}`"
              class="channelThumbnailLink"
              :aria-label="enableChannelLinks ? channelName : null"
              @click="handleChannelLinkClick"
              @auxclick="handleChannelLinkClick"
            >
              <FtRetryImage
                :fallback-icon="['fas', 'circle-user']"
                :src="channelThumbnail"
                :class="enableChannelLinks ? '' : 'initialCursor'"
                class="channelThumbnail"
                alt=""
              />
            </component>
          </div>
          <div>
            <div
              v-if="!hideUploader"
            >
              <component
                :is="enableChannelLinks ? 'RouterLink' : 'span'"
                :to="`/channel/${channelId}`"
                :class="enableChannelLinks ? '' : 'initialCursor'"
                class="channelName"
                dir="auto"
                @click="handleChannelLinkClick"
                @auxclick="handleChannelLinkClick"
              >
                {{ channelName }}
              </component>
            </div>
            <FtSubscribeButton
              v-if="channelId && !hideUnsubscribeButton"
              :channel-id="channelId"
              :channel-name="channelName"
              :channel-thumbnail="channelThumbnail"
              :subscription-count-text="subscriptionCountText"
            />
          </div>
        </template>
        <FtCollaboratorsPrompt
          v-if="showCollaboratorsPrompt"
          :collaborators="channelCollaborators"
          @close="showCollaboratorsPrompt = false"
        />
      </div>
      <div
        ref="videoOptions"
        class="videoOptions"
        :class="{ compact: optionsCompact }"
      >
        <span class="videoOptionsMobileRow">
          <slot name="cast-action" />
          <FtIconButton
            v-if="showPlaylists && !isUpcoming && !hidePlaylistActions"
            :title="t('User Playlists.Add to Playlist')"
            :icon="isInAnyPlaylist ? ['fac', 'playlist-check'] : ['fac', 'playlist-add']"
            theme="base-no-default"
            :use-shadow="false"
            force-dropdown
            mobile-sheet
          >
            <FtAddToPlaylistDropdown :video-data="addToPlaylistVideoData" />
          </FtIconButton>
          <FtIconButton
            v-if="isQuickBookmarkEnabled && !hidePlaylistActions"
            :title="quickBookmarkIconText"
            :icon="quickBookmarkIcon"
            class="quickBookmarkVideoIcon"
            :class="{
              bookmarked: isInQuickBookmarkPlaylist,
            }"
            :theme="quickBookmarkIconTheme"
            :use-shadow="false"
            @click="toggleQuickBookmarked"
          />
          <FtIconButton
            v-if="canSaveWatchedProgress && watchedProgressSavingInSemiAutoMode"
            :title="t('Video.Save Watched Progress')"
            :icon="['fas', 'bars-progress']"
            theme="base-no-default"
            :use-shadow="false"
            @click="saveWatchedProgressManually"
          />
          <FtIconButton
            v-if="channelSettingSaveActions.length > 0"
            ref="channelSettingsButton"
            :title="t('Video.Save Channel Setting')"
            :icon="['fas', 'floppy-disk']"
            :overlay-icon="channelSettingSaveActions.some(action => action.saved) ? ['fas', 'check'] : null"
            theme="base-no-default"
            :use-shadow="false"
            :dropdown-portal="channelSettingDropdownPortal"
            dropdown-class="channelSettingsDropdown"
            dropdown-position-x="left"
            force-dropdown
          >
            <div
              v-for="action in channelSettingSaveActions"
              :key="action.value"
              class="channelSettingRow"
            >
              <button
                type="button"
                class="channelSettingSave"
                :disabled="action.disabled"
                @click="saveChannelSetting(action.value)"
              >
                <FtIcon
                  :icon="action.icon"
                  aria-hidden="true"
                />
                <span>{{ action.label }}</span>
              </button>
              <FtIconButton
                :disabled="!action.saved"
                :size="14"
                :use-shadow="false"
                theme="base-no-default"
                :title="t('Settings.Channel Settings.Forget Value')"
                :icon="['fas', 'trash']"
                @click="removeChannelSetting(action.value)"
              />
            </div>
          </FtIconButton>
          <FtIconButton
            v-if="useSponsorBlock && !isUpcoming && !hideFullscreenDockActions"
            :title="sponsorBlockInfoTitle"
            :icon="['fas', 'shield-halved']"
            :class="{ toolbarActive: sponsorBlockPanelOpen }"
            theme="base-no-default"
            :use-shadow="false"
            @click="emit('toggle-sponsorblock-info')"
          />
          <FtIconButton
            v-if="liveChatAvailable && !hideFullscreenDockActions"
            :title="liveChatToggleTitle"
            :icon="['fas', 'message']"
            :class="{ toolbarActive: liveChatOpen }"
            theme="base-no-default"
            :use-shadow="false"
            :aria-pressed="liveChatOpen"
            @click="emit('toggle-live-chat')"
          />
          <FtIconButton
            v-if="transcriptAvailable && !isLive && !isUpcoming && !hideFullscreenDockActions"
            :title="transcriptOpen ? t('Video.Transcript.Hide') : t('Video.Transcript.Show')"
            :icon="['fas', 'file-lines']"
            :class="{ toolbarActive: transcriptOpen }"
            theme="base-no-default"
            :use-shadow="false"
            @click="emit('toggle-transcript')"
          />
          <FtIconButton
            v-if="metadataHistory"
            :title="t('Settings.Privacy Settings.Cache Video Metadata')"
            :icon="['fas', 'clock-rotate-left']"
            theme="base-no-default"
            :use-shadow="false"
            @click="showMetadataHistory = true"
          />
        </span>
        <span class="videoOptionsMobileRow">
          <FtIconButton
            v-if="!offline && USING_ELECTRON && externalPlayer !== ''"
            :title="t('Video.External Player.OpenInTemplate', { externalPlayer })"
            :icon="['fas', 'external-link-alt']"
            theme="base-no-default"
            :use-shadow="false"
            @click="handleExternalPlayer"
          />
          <FtIconButton
            v-if="!isUpcoming && (!offline || localPlaybackDownloads.length > 0)"
            :title="t('Change Format.Change Media Formats')"
            :icon="['fas', 'file-video']"
            theme="base-no-default"
            :use-shadow="false"
            @click="openFormatPrompt"
          />
          <FtShareButton
            v-if="!hideSharingActions && !hideShareButton"
            :id="id"
            :get-timestamp="getTimestamp"
            :playlist-id="playlistId"
            theme="base-no-default"
            :use-shadow="false"
          />
          <FtButton
            v-if="!offline && supportsYtDlp && enableDownloads && !isUpcoming"
            class="downloadButton"
            :title="t('Downloads.Download Video')"
            :aria-label="t('Downloads.Download Video')"
            :icon="['fas', 'download']"
            theme="secondary"
            variant="filled"
            shape="square"
            @click="emit('open-download')"
          >
            <template #label>
              <span class="downloadLabel">{{ t('Downloads.Download') }}</span>
            </template>
          </FtButton>
        </span>
      </div>
    </div>
    <WatchVideoFormatPrompt
      v-if="showFormatPrompt"
      :active-format="activeFormat"
      :playback-engine="playbackEngine"
      :playback-engine-version="playbackEngineVersion"
      :playback-engine-selection="playbackEngineSelection"
      :stream-type="streamType"
      :dash-available="dashAvailable"
      :legacy-available="legacyAvailable"
      :audio-available="audioAvailable"
      :local-file-playback="localFilePlayback"
      :local-playback-downloads="localPlaybackDownloads"
      :can-change-playback-engine="supportsYtDlp"
      :offline="offline"
      @change-format="changeFormat"
      @change-playback-engine="changePlaybackEngine"
      @use-local-source="emit('use-local-source', $event)"
      @use-online-source="emit('use-online-source')"
      @close="showFormatPrompt = false"
    />
    <WatchVideoMetadataHistory
      v-if="metadataHistory && showMetadataHistory"
      :history="metadataHistory"
      @close="showMetadataHistory = false"
    />
  </FtCard>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { ytDlp } from '../../helpers/ytDlp'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtAddToPlaylistDropdown from '../FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtInlineMetadata from '../FtInlineMetadata/FtInlineMetadata.vue'
import FtCard from '../ft-card/ft-card.vue'
import FtCollaboratorsPrompt from '../FtCollaboratorsPrompt/FtCollaboratorsPrompt.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtShareButton from '../FtShareButton/FtShareButton.vue'
import FtSubscribeButton from '../FtSubscribeButton/FtSubscribeButton.vue'
import WatchVideoFormatPrompt from '../WatchVideoFormatPrompt/WatchVideoFormatPrompt.vue'
import WatchVideoMetadataHistory from '../WatchVideoMetadataHistory/WatchVideoMetadataHistory.vue'
import WatchVideoLikes from '../WatchVideoLikes/WatchVideoLikes.vue'

import store from '../../store'

import { vSaferHtml } from '../../directives/vSaferHtml'

import { linkifyHashtagsAndHandles } from '../../helpers/descriptionLinks'
import { escapeHTML, formatViewCount, getRelativeTimeFromDate, getVideoThumbnailUrl, isUnloadedBackgroundTabClick, openInternalPath, showToast } from '../../helpers/utils'
import { translateSponsorBlockCategory } from '../../helpers/player/utils'
import { parseChannelPreferences, removeChannelPreference } from '../../helpers/channel-preferences'
import { useMediaSessionMetadata } from '../../composables/useMediaSessionMetadata'
import { useRelativeTimeClock } from '../../composables/useRelativeTimeClock'
import { formatDate } from '../../helpers/dateFormat'

const dateFormat = computed(() => store.getters.getDateFormat)

const props = defineProps({
  offline: {
    type: Boolean,
    default: false
  },
  id: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  channelId: {
    type: String,
    required: true
  },
  currentPlaybackRate: {
    type: Number,
    default: null
  },
  currentVideoQuality: {
    type: String,
    default: null
  },
  currentSubtitlesState: {
    type: Boolean,
    default: null
  },
  currentVolume: {
    type: Number,
    default: null
  },
  channelName: {
    type: String,
    required: true
  },
  channelThumbnail: {
    type: String,
    required: true
  },
  channelCollaborators: {
    type: Array,
    default: () => []
  },
  published: {
    type: Number,
    required: true
  },
  premiereDate: {
    type: Date,
    default: undefined
  },
  viewCount: {
    type: Number,
    default: null
  },
  subscriptionCountText: {
    type: String,
    required: true
  },
  likeCount: {
    type: Number,
    default: 0
  },
  dislikeCount: {
    type: Number,
    default: 0
  },
  category: {
    type: String,
    default: ''
  },
  getTimestamp: {
    type: Function,
    required: true
  },
  isLive: {
    type: Boolean,
    required: false
  },
  isLiveContent: {
    type: Boolean,
    required: true
  },
  isUpcoming: {
    type: Boolean,
    required: true
  },
  playlistId: {
    type: String,
    default: null
  },
  /** @type {import('vue').PropType<() => { index: number, reverse: boolean, shuffle: boolean, loop: boolean }>} */
  getPlaylistState: {
    type: Function,
    required: true
  },
  lengthSeconds: {
    type: Number,
    required: true
  },
  videoThumbnail: {
    type: String,
    required: true
  },
  metadataHistory: {
    type: Object,
    default: null
  },
  inUserPlaylist: {
    type: Boolean,
    required: true
  },
  isUnlisted: {
    type: Boolean,
    required: false
  },
  isAgeRestricted: {
    type: Boolean,
    default: false
  },
  hasAiGeneratedContent: {
    type: Boolean,
    default: false
  },
  sponsorBlockFullVideoCategory: {
    type: String,
    default: null
  },
  /** @type {import('vue').PropType<'dash' | 'legacy' | 'audio'>} */
  activeFormat: {
    type: String,
    default: 'dash'
  },
  /** @type {import('vue').PropType<'built-in' | 'yt-dlp'>} */
  playbackEngine: {
    type: String,
    default: 'built-in'
  },
  playbackEngineVersion: {
    type: String,
    default: null
  },
  /** @type {import('vue').PropType<'built-in' | 'yt-dlp'>} */
  playbackEngineSelection: {
    type: String,
    default: 'built-in'
  },
  /** @type {import('vue').PropType<'sabr' | 'dash' | 'hls' | 'none'>} */
  streamType: {
    type: String,
    default: 'none'
  },
  dashAvailable: {
    type: Boolean,
    default: false
  },
  legacyAvailable: {
    type: Boolean,
    default: false
  },
  audioAvailable: {
    type: Boolean,
    default: false
  },
  localFilePlayback: {
    type: Boolean,
    default: false
  },
  localPlaybackDownloads: {
    type: Array,
    default: () => []
  },
  canSaveWatchedProgress: {
    type: Boolean,
    required: true
  },
  sponsorBlockPanelOpen: {
    type: Boolean,
    default: false
  },
  sponsorBlockAvailable: {
    type: Boolean,
    default: false
  },
  transcriptOpen: {
    type: Boolean,
    default: false
  },
  transcriptAvailable: {
    type: Boolean,
    default: false
  },
  liveChatAvailable: {
    type: Boolean,
    default: false
  },
  liveChatOpen: {
    type: Boolean,
    default: false
  },
  liveChatReplay: {
    type: Boolean,
    default: false
  },
  hideShareButton: {
    type: Boolean,
    default: false
  },
  hidePlaylistActions: {
    type: Boolean,
    default: false
  },
  hideFullscreenDockActions: {
    type: Boolean,
    default: false
  },
  channelSettingDropdownPortal: {
    type: Boolean,
    default: false
  },
})

const emit = defineEmits([
  'open-download',
  'change-format',
  'change-playback-engine',
  'use-local-source',
  'use-online-source',
  'pause-player',
  'save-watched-progress',
  'save-channel-playback-speed',
  'save-channel-video-quality',
  'save-channel-subtitles-state',
  'save-channel-volume',
  'toggle-sponsorblock-info',
  'toggle-transcript',
  'toggle-live-chat',
])

const USING_ELECTRON = process.env.IS_ELECTRON

const { locale, t } = useI18n()
const relativeTimeNow = useRelativeTimeClock()

const showCollaboratorsPrompt = ref(false)
const showFormatPrompt = ref(false)
const showMetadataHistory = ref(false)

const videoButtons = useTemplateRef('videoButtons')
const videoOptions = useTemplateRef('videoOptions')
const optionsCompact = ref(false)
let labeledDownloadWidth = 0
let optionsLayoutFrame = null

/**
 * Width of an action group on one line, including its divider. Compact
 * toolbars let groups wrap, so their rendered width no longer reflects this.
 * @param {HTMLElement} group
 */
function getUnwrappedGroupWidth(group) {
  const gap = parseFloat(getComputedStyle(group).columnGap)
  const items = [...group.children].filter(item => item.getClientRects().length > 0)
  const divider = getComputedStyle(group, '::before')
  const dividerWidth = divider.content === 'none'
    ? 0
    : parseFloat(divider.inlineSize) + parseFloat(divider.marginInlineStart) + parseFloat(divider.marginInlineEnd) + gap

  return items.reduce((width, item) => width + item.getBoundingClientRect().width, 0) +
    gap * Math.max(items.length - 1, 0) + dividerWidth
}

/**
 * Hides the Download label when the toolbar with the label would be wider than
 * the card. CSS cannot measure how wide the toolbar would be with the label
 * shown once it is hidden.
 */
function updateOptionsLayout() {
  const row = videoButtons.value
  const toolbar = videoOptions.value
  if (!row || !toolbar || row.clientWidth === 0) { return }

  const download = toolbar.querySelector('.downloadButton')
  const downloadWidth = download?.getBoundingClientRect().width ?? 0
  if (!optionsCompact.value) {
    labeledDownloadWidth = downloadWidth
  }

  const style = getComputedStyle(toolbar)
  const groups = [...toolbar.children].filter(group => group.getClientRects().length > 0)
  const contentWidth = groups.reduce((width, group) => width + getUnwrappedGroupWidth(group), 0) +
    parseFloat(style.columnGap) * Math.max(groups.length - 1, 0) +
    parseFloat(style.paddingInlineStart) + parseFloat(style.paddingInlineEnd)

  optionsCompact.value = contentWidth - downloadWidth + labeledDownloadWidth > row.clientWidth + 0.5
}

function scheduleOptionsLayout() {
  cancelAnimationFrame(optionsLayoutFrame)
  optionsLayoutFrame = requestAnimationFrame(updateOptionsLayout)
}

const optionsResizeObserver = new ResizeObserver(scheduleOptionsLayout)

onMounted(() => {
  optionsResizeObserver.observe(videoButtons.value)
  for (const group of videoOptions.value.children) {
    optionsResizeObserver.observe(group)
  }
  updateOptionsLayout()
})

onBeforeUnmount(() => {
  optionsResizeObserver.disconnect()
  cancelAnimationFrame(optionsLayoutFrame)
})
const enableDownloads = computed(() => store.getters.getEnableDownloads)

const liveChatToggleTitle = computed(() => {
  if (props.liveChatReplay) {
    return props.liveChatOpen ? t('Video.Close Live Chat Replay') : t('Video.Show Live Chat Replay')
  }

  return props.liveChatOpen ? t('Video.Close Live Chat') : t('Video.Show Live Chat')
})

watch(() => props.offline, offline => {
  if (offline) {
    if (props.localPlaybackDownloads.length === 0) showFormatPrompt.value = false
  }
})

watch(() => props.metadataHistory, history => {
  if (!history) showMetadataHistory.value = false
})

// the title is plain text, so it has to be escaped before the hashtags and handles are linked
/** @type {import('vue').ComputedRef<string>} */
const titleHtml = computed(() => linkifyHashtagsAndHandles(escapeHTML(props.title)))

/** @type {import('vue').ComputedRef<boolean>} */
const hideSharingActions = computed(() => store.getters.getHideSharingActions)

/** @type {import('vue').ComputedRef<boolean>} */
const hideUnsubscribeButton = computed(() => store.getters.getHideUnsubscribeButton)

/** @type {import('vue').ComputedRef<boolean>} */
const hideUploader = computed(() => store.getters.getHideUploader)

const hasMultipleCollaborators = computed(() => props.channelCollaborators.length > 1)

const collaboratorSummaryName = computed(() => {
  const names = props.channelCollaborators.map(collaborator => collaborator.name).filter(Boolean)

  if (names.length === 0) {
    return props.channelName
  }

  return new Intl.ListFormat(locale.value, {
    style: 'long',
    type: 'conjunction'
  }).formatToParts(names).map((part, index, parts) => {
    return names.length > 2 && index === parts.length - 2
      ? part.value.replace(',', '')
      : part.value
  }).join('')
})

/** @type {import('vue').ComputedRef<boolean>} */
const useReturnYoutubeDislikes = computed(() => store.getters.getUseReturnYouTubeDislikes)

/** @type {import('vue').ComputedRef<boolean>} */
const hideVideoViews = computed(() => store.getters.getHideVideoViews)

/** @type {import('vue').ComputedRef<boolean>} */
const shortenViewCounts = computed(() => store.getters.getShortenViewCounts)

const parsedViewCount = computed(() => {
  if (hideVideoViews.value || props.viewCount == null) {
    return null
  }

  return t('Global.Counts.View Count', { count: formatViewCount(props.viewCount, shortenViewCounts.value) }, props.viewCount)
})

const validPublishedDate = computed(() => {
  if (!Number.isFinite(props.published) || props.published <= 0) return null

  const date = new Date(props.published)
  return Number.isNaN(date.getTime()) ? null : date
})

const dateString = computed(() => {
  if (!validPublishedDate.value) return ''

  const localeDateString = formatDate(
    validPublishedDate.value,
    locale.value,
    dateFormat.value,
    { dateStyle: 'medium' }
  )
  // replace spaces with no break spaces to make the date act as a single entity while wrapping
  return localeDateString.replaceAll(' ', '\u00A0')
})

const publishedTimeAgo = computed(() => {
  if (!locale.value || !validPublishedDate.value || props.published > relativeTimeNow.value) {
    return ''
  }

  return getRelativeTimeFromDate(props.published, false, true, relativeTimeNow.value)
})

const isPremiereInProgress = computed(() => {
  return props.isLive && !props.isLiveContent
})

const publishedString = computed(() => {
  if (props.isLive && props.isLiveContent) {
    return t('Video.Started streaming on')
  } else if (props.isLiveContent && !props.isLive) {
    return t('Video.Streamed on')
  } else {
    return t('Video.Published on')
  }
})

const publishedDateText = computed(() => {
  if (isPremiereInProgress.value) {
    return t('Video.Premiere started', { timeAgo: publishedTimeAgo.value })
  }

  if (!dateString.value) {
    return ''
  }

  return `${publishedString.value} ${dateString.value}`
})

/**
 * @param {'dash' | 'legacy' | 'audio'} value
 */
function changeFormat(value) {
  emit('change-format', value)
}

async function openFormatPrompt() {
  if (supportsYtDlp) {
    try {
      const downloads = await ytDlp.ytDlpListDownloads()
      downloads.forEach(download => store.commit('upsertYtDlpDownload', download))
    } catch (error) {
      console.warn('Could not refresh downloads for the media format selector', error)
    }
  }
  showFormatPrompt.value = true
}

/**
 * @param {'built-in' | 'yt-dlp'} value
 */
function changePlaybackEngine(value) {
  emit('change-playback-engine', value)
}

const watchedProgressSavingInSemiAutoMode = computed(() => {
  return store.getters.getWatchedProgressSavingMode === 'semi-auto'
})

function saveWatchedProgressManually() {
  emit('save-watched-progress')
}

/** @type {import('vue').ComputedRef<boolean>} */
const autoUpdateChannelPlaybackSpeeds = computed(() => store.getters.getAutoUpdateChannelPlaybackSpeeds)

/** @type {import('vue').ComputedRef<boolean>} */
const useQuickPlaybackSpeedBar = computed(() => store.getters.getUseQuickPlaybackSpeedBar)

const showSaveChannelPlaybackSpeedButton = computed(() => {
  return !props.isUpcoming &&
    !autoUpdateChannelPlaybackSpeeds.value &&
    !useQuickPlaybackSpeedBar.value
})

/** @type {import('vue').ComputedRef<boolean>} */
const autoUpdateChannelVideoQualities = computed(() => store.getters.getAutoUpdateChannelVideoQualities)

const showSaveChannelVideoQualityButton = computed(() => {
  return !props.isUpcoming && !autoUpdateChannelVideoQualities.value
})

const showSaveChannelSubtitlesStateButton = computed(() => {
  return !props.isUpcoming && !store.getters.getAutoUpdateChannelSubtitlesStates
})

const showSaveChannelVolumeButton = computed(() => {
  return !process.env.IS_CAPACITOR &&
    !props.isUpcoming &&
    !store.getters.getAutoUpdateChannelVolumes
})

const channelSettingsButton = useTemplateRef('channelSettingsButton')

const savedChannelSettings = computed(() => ({
  playbackSpeed: parseChannelPreferences(
    store.getters.getChannelPlaybackSpeeds,
    'channelPlaybackSpeeds'
  )[props.channelId],
  videoQuality: parseChannelPreferences(
    store.getters.getChannelVideoQualities,
    'channelVideoQualities'
  )[props.channelId],
  subtitlesState: parseChannelPreferences(
    store.getters.getChannelSubtitlesStates,
    'channelSubtitlesStates'
  )[props.channelId],
  volume: parseChannelPreferences(
    store.getters.getChannelVolumes,
    'channelVolumes'
  )[props.channelId]
}))

const currentChannelSettings = computed(() => ({
  playbackSpeed: props.currentPlaybackRate,
  videoQuality: props.currentVideoQuality,
  subtitlesState: props.currentSubtitlesState,
  volume: props.currentVolume
}))

function formatChannelSettingValue(type, value) {
  if (type === 'playbackSpeed') {
    return `${value}×`
  }
  if (type === 'videoQuality') {
    return `${value}p`
  }
  if (type === 'subtitlesState') {
    return value ? '✓' : '✕'
  }
  return `${Math.round(value * 100)}%`
}

function createChannelSettingSaveAction(type, visible, label, settingLabel, icon) {
  const savedValue = savedChannelSettings.value[type]
  const currentValue = currentChannelSettings.value[type]
  const hasSavedValue = savedValue !== undefined
  // Player-driven values (especially volume) stay null until initialization finishes;
  // keep the action disabled so the parent handler cannot silently no-op.
  const isUninitialized = currentValue === null
  const isAlreadyCurrent = !isUninitialized && hasSavedValue && String(savedValue) === String(currentValue)
  const disabled = isUninitialized || isAlreadyCurrent
  const formattedValue = hasSavedValue ? formatChannelSettingValue(type, savedValue) : ''
  let actionLabel = label

  if (isAlreadyCurrent) {
    actionLabel = t('Video.Channel Setting Already Set', { setting: settingLabel, value: formattedValue })
  } else if (hasSavedValue) {
    actionLabel = `${label}: ${formattedValue}`
  }

  return {
    visible,
    label: actionLabel,
    icon,
    value: type,
    saved: hasSavedValue,
    disabled
  }
}

const channelSettingSaveActions = computed(() => [
  createChannelSettingSaveAction('playbackSpeed', showSaveChannelPlaybackSpeedButton.value,
    t('Video.Save Channel Playback Speed'), t('Settings.Player Settings.Playback Speed'), ['fas', 'gauge']),
  createChannelSettingSaveAction('videoQuality', showSaveChannelVideoQualityButton.value,
    t('Video.Save Channel Video Quality'), t('Settings.Channel Settings.Video Quality'), ['fas', 'photo-film']),
  createChannelSettingSaveAction('subtitlesState', showSaveChannelSubtitlesStateButton.value,
    t('Video.Save Channel Subtitles State'), t('Search Listing.Label.Subtitles'),
    ['fas', 'closed-captioning']),
  createChannelSettingSaveAction('volume', showSaveChannelVolumeButton.value,
    t('Video.Save Channel Volume'), t('Settings.Channel Settings.Volume'), ['fas', 'volume-high'])
].filter(action => action.visible && store.getters.getEnableChannelSettings && props.channelId !== ''))

/**
 * @param {'playbackSpeed'|'videoQuality'|'subtitlesState'|'volume'} setting
 */
function saveChannelSetting(setting) {
  channelSettingsButton.value?.hideDropdown()
  switch (setting) {
    case 'playbackSpeed':
      emit('save-channel-playback-speed')
      break
    case 'videoQuality':
      emit('save-channel-video-quality')
      break
    case 'subtitlesState':
      emit('save-channel-subtitles-state')
      break
    case 'volume':
      emit('save-channel-volume')
      break
  }
}

/**
 * @param {'playbackSpeed'|'videoQuality'|'subtitlesState'|'volume'} setting
 */
async function removeChannelSetting(setting) {
  await removeChannelPreference(store, props.channelId, setting)
  channelSettingsButton.value?.hideDropdown()
}

/** @type {import('vue').ComputedRef<boolean>} */
const useSponsorBlock = computed(() => store.getters.getUseSponsorBlock && (!props.offline || props.sponsorBlockAvailable))

const sponsorBlockInfoTitle = computed(() => props.sponsorBlockPanelOpen
  ? t('Video.Player.SponsorBlock.CloseInfoPanel')
  : t('Video.Player.SponsorBlock.OpenInfoPanel'))

/** @type {import('vue').ComputedRef<string>} */
const externalPlayer = computed(() => store.getters.getExternalPlayer)

/** @type {import('vue').ComputedRef<number>} */
const defaultPlayback = computed(() => store.getters.getDefaultPlayback)

function handleExternalPlayer() {
  emit('pause-player')

  let payload

  // Only play video in non playlist mode when user playlist detected
  if (props.inUserPlaylist) {
    payload = {
      videoId: props.id,
      startTime: props.getTimestamp(),
      playbackRate: defaultPlayback.value,
    }
  } else {
    const playlistState = props.getPlaylistState()

    payload = {
      videoId: props.id,
      playlistId: props.playlistId,
      startTime: props.getTimestamp(),
      playbackRate: defaultPlayback.value,
      playlistIndex: playlistState.index,
      playlistReverse: playlistState.reverse,
      playlistShuffle: playlistState.shuffle,
      playlistLoop: playlistState.loop
    }
  }

  if (process.env.IS_ELECTRON) {
    window.ftElectron.openInExternalPlayer(payload)
  }
}

useMediaSessionMetadata(() => ({
  title: props.title,
  artist: props.channelName,
  artworkSrc: props.videoThumbnail
}))

const showPlaylists = computed(() => !store.getters.getHidePlaylists)
const isInAnyPlaylist = computed(() => store.getters.getPlaylistVideoCounts.has(props.id))

// Descriptions are omitted from saved playlist entries.
const addToPlaylistVideoData = computed(() => ({
  videoId: props.id,
  title: props.title,
  author: props.channelName,
  authorId: props.channelId,
  lengthSeconds: props.lengthSeconds,
  published: props.published,
  ...(props.viewCount != null ? { viewCount: props.viewCount } : {}),
  premiereDate: props.premiereDate
}))

const quickBookmarkPlaylist = computed(() => store.getters.getQuickBookmarkPlaylist)

const quickBookmarkThumbnail = computed(() => {
  return getVideoThumbnailUrl(props.id, store.getters.getBackendPreference, store.getters.getCurrentInvidiousInstanceUrl, store.getters.getThumbnailPreference)
})

const isQuickBookmarkEnabled = computed(() => quickBookmarkPlaylist.value != null)
const quickBookmarkIcon = computed(() => store.getters.getQuickBookmarkIcon)

const isInQuickBookmarkPlaylist = computed(() => {
  if (!isQuickBookmarkEnabled.value) { return false }

  // Accessing a reactive property has a negligible amount of overhead,
  // however as we know that some users have playlists that have more than 10k items in them
  // it adds up quickly. So create a temporary variable outside of the array, so we only have to do it once.
  // Also the search is retriggered every time any playlist is modified.
  const id = props.id

  return quickBookmarkPlaylist.value.videos.some((video) => {
    return video.videoId === id
  })
})

const quickBookmarkIconText = computed(() => {
  if (!isQuickBookmarkEnabled.value) { return '' }

  const translationProperties = {
    playlistName: quickBookmarkPlaylist.value.playlistName,
  }
  return isInQuickBookmarkPlaylist.value
    ? t('User Playlists.Remove from Favorites', translationProperties)
    : t('User Playlists.Add to Favorites', translationProperties)
})

const quickBookmarkIconTheme = computed(() => isInQuickBookmarkPlaylist.value ? 'base-no-default favorite' : 'base-no-default')

function toggleQuickBookmarked() {
  if (!isQuickBookmarkEnabled.value) {
    // This should be prevented by UI
    return
  }

  if (isInQuickBookmarkPlaylist.value) {
    removeFromQuickBookmarkPlaylist()
  } else {
    addToQuickBookmarkPlaylist()
  }
}

async function addToQuickBookmarkPlaylist() {
  const videoData = {
    videoId: props.id,
    title: props.title,
    author: props.channelName,
    authorId: props.channelId,
    lengthSeconds: props.lengthSeconds,
    published: props.published,
    ...(props.viewCount != null ? { viewCount: props.viewCount } : {}),
    premiereDate: props.premiereDate
  }

  const playlistName = quickBookmarkPlaylist.value.playlistName

  const saved = await store.dispatch('addVideo', {
    _id: quickBookmarkPlaylist.value._id,
    videoData,
  })

  showToast({
    message: saved
      ? t('Video.Video has been saved to {playlistName}', { playlistName })
      : t('Video.There was a problem saving the video to {playlistName}', { playlistName }),
    image: quickBookmarkThumbnail.value,
    icon: ['fas', 'bookmark'],
  })
}

async function removeFromQuickBookmarkPlaylist() {
  const playlistName = quickBookmarkPlaylist.value.playlistName

  const removed = await store.dispatch('removeVideo', {
    _id: quickBookmarkPlaylist.value._id,
    // Remove all playlist items with same videoId
    videoId: props.id,
  })

  showToast({
    message: removed
      ? t('Video.Video has been removed from {playlistName}', { playlistName })
      : t('Video.There was a problem removing the video from {playlistName}', { playlistName }),
    image: quickBookmarkThumbnail.value,
    icon: ['fas', 'trash'],
  })
}

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)

function handleChannelLinkClick(event) {
  if (!USING_ELECTRON || !enableChannelLinks.value) {
    return
  }

  const isMiddleClick = event.type === 'auxclick' && event.button === 1
  const isModifiedClick = event.type === 'click' && (event.ctrlKey || event.metaKey)
  if (!isMiddleClick && !isModifiedClick) {
    return
  }

  event.preventDefault()
  openInternalPath({
    path: `/channel/${props.channelId}`,
    title: props.channelName,
    doCreateNewWindow: event.shiftKey,
    doCreateNewTab: !event.shiftKey,
    makeActive: !isMiddleClick,
    lazyLoad: isUnloadedBackgroundTabClick(event)
  })
}
</script>

<style scoped src="./WatchVideoInfo.css" />
