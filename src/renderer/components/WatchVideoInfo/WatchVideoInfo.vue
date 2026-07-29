<template>
  <FtCard class="watchVideoInfo">
    <div>
      <h1
        class="videoTitle"
        dir="auto"
      >
        {{ title }}
      </h1>
      <div
        v-if="isUnlisted || hasAiGeneratedContent"
        class="videoBadges"
      >
        <div
          v-if="isUnlisted"
          class="videoBadge"
        >
          {{ t('Video.Unlisted') }}
        </div>
        <div
          v-if="hasAiGeneratedContent"
          :aria-label="t('Video.AI-generated content')"
          :title="t('Video.AI-generated content')"
          class="videoBadge"
        >
          <FontAwesomeIcon :icon="['fas', 'info-circle']" />
          {{ t('Video.AI') }}
        </div>
      </div>
    </div>
    <div class="videoMetrics">
      <div class="datePublishedAndViewCount">
        <span class="publishedDate">
          {{ publishedDateText }}
        </span>
        <template
          v-if="publishedTimeAgo && !isPremiereInProgress"
        >
          <span class="seperator">•</span><span class="publishedTimeAgo">{{ publishedTimeAgo }}</span>
        </template>
        <template
          v-if="parsedViewCount"
        >
          <span class="seperator">•</span><span class="videoViews">{{ parsedViewCount }}</span>
        </template>
        <template v-if="category">
          <span class="seperator">•</span>
          <bdi class="videoCategory">
            <strong>{{ t('Description.Video Category') }}</strong> {{ category }}
          </bdi>
        </template>
      </div>
      <div
        v-if="!hideVideoLikesAndDislikes"
        class="likeBarContainer"
      >
        <div
          class="likeSection"
        >
          <div
            v-if="useReturnYoutubeDislikes && likePercentageRatio !== null"
            class="likeBar"
            :style="{ background: `linear-gradient(to right, var(--accent-color) ${likePercentageRatio}%, #9E9E9E ${likePercentageRatio}%)` }"
          />
          <div class="likeCounts">
            <span class="likeCount"><FontAwesomeIcon :icon="['fas', 'thumbs-up']" /> {{ parsedLikeCount }}</span>
            <span
              v-if="useReturnYoutubeDislikes"
              class="dislikeCount"
            >
              <FontAwesomeIcon :icon="['fas', 'thumbs-down']" /> {{ parsedDislikeCount }}
            </span>
          </div>
        </div>
      </div>
    </div>
    <div class="videoButtons">
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
            <img
              v-for="collaborator in channelCollaborators"
              :key="collaborator.id"
              :src="collaborator.thumbnail"
              class="channelThumbnail collaboratorThumbnail"
              alt=""
            >
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
              @click="handleChannelLinkClick"
              @auxclick="handleChannelLinkClick"
            >
              <img
                :src="channelThumbnail"
                :class="enableChannelLinks ? '' : 'initialCursor'"
                class="channelThumbnail"
                alt=""
              >
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
              v-if="!hideUnsubscribeButton"
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
      <div class="videoOptions">
        <span class="videoOptionsMobileRow">
          <FtIconButton
            v-if="showPlaylists && !isUpcoming && !hidePlaylistActions"
            :title="t('User Playlists.Add to Playlist')"
            :icon="isInAnyPlaylist ? ['fac', 'playlist-check'] : ['fac', 'playlist-add']"
            theme="base"
            force-dropdown
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
            @click="toggleQuickBookmarked"
          />
          <FtIconButton
            v-if="canSaveWatchedProgress && watchedProgressSavingInSemiAutoMode"
            :title="t('Video.Save Watched Progress')"
            :icon="['fas', 'bars-progress']"
            @click="saveWatchedProgressManually"
          />
          <FtIconButton
            v-if="showSaveChannelPlaybackSpeedButton"
            :title="t('Video.Save Channel Playback Speed')"
            :icon="['fas', 'gauge']"
            @click="saveChannelPlaybackSpeedManually"
          />
          <FtIconButton
            v-if="showSaveChannelVideoQualityButton"
            :title="t('Video.Save Channel Video Quality')"
            :icon="['fas', 'photo-film']"
            @click="saveChannelVideoQualityManually"
          />
          <FtIconButton
            v-if="useSponsorBlock && !isUpcoming && !hideFullscreenDockActions"
            :title="sponsorBlockInfoTitle"
            :icon="['fas', 'shield-halved']"
            :theme="sponsorBlockPanelOpen ? 'secondary' : 'base'"
            @click="emit('toggle-sponsorblock-info')"
          />
          <FtIconButton
            v-if="!isLive && !isUpcoming && !hideFullscreenDockActions"
            :title="transcriptOpen ? t('Video.Transcript.Hide') : t('Video.Transcript.Show')"
            :icon="['fas', 'file-lines']"
            :theme="transcriptOpen ? 'secondary' : 'base'"
            @click="emit('toggle-transcript')"
          />
        </span>
        <span class="videoOptionsMobileRow">
          <FtIconButton
            v-if="USING_ELECTRON && !isUpcoming"
            :title="t('Downloads.Download Video')"
            :icon="['fas', 'download']"
            theme="secondary"
            @click="showDownloadPrompt = true"
          />
          <FtIconButton
            v-if="USING_ELECTRON && externalPlayer !== ''"
            :title="t('Video.External Player.OpenInTemplate', { externalPlayer })"
            :icon="['fas', 'external-link-alt']"
            theme="secondary"
            @click="handleExternalPlayer"
          />
          <FtIconButton
            v-if="!isUpcoming"
            :title="t('Change Format.Change Media Formats')"
            theme="secondary"
            :icon="['fas', 'file-video']"
            :dropdown-options="formatTypeOptions"
            @click="changeFormat"
          />
          <FtShareButton
            v-if="!hideSharingActions && !hideShareButton"
            :id="id"
            :get-timestamp="getTimestamp"
            :playlist-id="playlistId"
          />
        </span>
      </div>
    </div>
    <WatchVideoDownloadPrompt
      v-if="showDownloadPrompt"
      :video-id="id"
      :title="title"
      @close="showDownloadPrompt = false"
    />
  </FtCard>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtAddToPlaylistDropdown from '../FtAddToPlaylistDropdown/FtAddToPlaylistDropdown.vue'
import FtCard from '../ft-card/ft-card.vue'
import FtCollaboratorsPrompt from '../FtCollaboratorsPrompt/FtCollaboratorsPrompt.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtShareButton from '../FtShareButton/FtShareButton.vue'
import FtSubscribeButton from '../FtSubscribeButton/FtSubscribeButton.vue'
import WatchVideoDownloadPrompt from '../WatchVideoDownloadPrompt/WatchVideoDownloadPrompt.vue'

import store from '../../store'

import { formatNumber, getRelativeTimeFromDate, getVideoThumbnailUrl, openInternalPath, showToast } from '../../helpers/utils'
import { useTabContext } from '../../tabs/TabContext'
import { tabMediaCoordinator } from '../../tabs/TabMediaCoordinator'

const { tabId } = useTabContext()

const props = defineProps({
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
  inUserPlaylist: {
    type: Boolean,
    required: true
  },
  isUnlisted: {
    type: Boolean,
    required: false
  },
  hasAiGeneratedContent: {
    type: Boolean,
    default: false
  },
  canSaveWatchedProgress: {
    type: Boolean,
    required: true
  },
  sponsorBlockPanelOpen: {
    type: Boolean,
    default: false
  },
  transcriptOpen: {
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
})

const emit = defineEmits([
  'change-format',
  'pause-player',
  'save-watched-progress',
  'save-channel-playback-speed',
  'save-channel-video-quality',
  'toggle-sponsorblock-info',
  'toggle-transcript',
])

const USING_ELECTRON = process.env.IS_ELECTRON

const { locale, t } = useI18n()

const showCollaboratorsPrompt = ref(false)
const showDownloadPrompt = ref(false)

/** @type {import('vue').ComputedRef<boolean>} */
const hideSharingActions = computed(() => store.getters.getHideSharingActions)

/** @type {import('vue').ComputedRef<boolean>} */
const hideUnsubscribeButton = computed(() => store.getters.getHideUnsubscribeButton)

/** @type {import('vue').ComputedRef<boolean>} */
const hideUploader = computed(() => store.getters.getHideUploader)

/** @type {import('vue').ComputedRef<boolean>} */
const hideVideoLikesAndDislikes = computed(() => store.getters.getHideVideoLikesAndDislikes)

const parsedLikeCount = computed(() => {
  if (hideVideoLikesAndDislikes.value || props.likeCount === null) {
    return null
  }

  return formatNumber(props.likeCount)
})

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

const parsedDislikeCount = computed(() => {
  if (hideVideoLikesAndDislikes.value || props.dislikeCount === null) {
    return null
  }

  return formatNumber(props.dislikeCount)
})

const likePercentageRatio = computed(() => {
  if (hideVideoLikesAndDislikes.value || props.likeCount === null || props.dislikeCount === null) {
    return null
  }

  const total = props.likeCount + props.dislikeCount
  if (total === 0) {
    return null
  }

  return Math.round((props.likeCount / total) * 100)
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideVideoViews = computed(() => store.getters.getHideVideoViews)

const parsedViewCount = computed(() => {
  if (hideVideoViews.value || props.viewCount == null) {
    return null
  }

  return t('Global.Counts.View Count', { count: formatNumber(props.viewCount) }, props.viewCount)
})

const validPublishedDate = computed(() => {
  if (!Number.isFinite(props.published) || props.published <= 0) return null

  const date = new Date(props.published)
  return Number.isNaN(date.getTime()) ? null : date
})

const dateString = computed(() => {
  if (!validPublishedDate.value) return ''

  const formatter = new Intl.DateTimeFormat([locale.value, 'en'], { dateStyle: 'medium' })
  const localeDateString = formatter.format(validPublishedDate.value)
  // replace spaces with no break spaces to make the date act as a single entity while wrapping
  return localeDateString.replaceAll(' ', '\u00A0')
})

const publishedTimeAgo = computed(() => {
  if (!locale.value || !validPublishedDate.value || props.published > Date.now()) {
    return ''
  }

  return getRelativeTimeFromDate(props.published)
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

const formatTypeOptions = computed(() => [
  {
    label: t('Change Format.Use Dash Formats'),
    value: 'dash'
  },
  {
    label: t('Change Format.Use Legacy Formats'),
    value: 'legacy'
  },
  {
    label: t('Change Format.Use Audio Formats'),
    value: 'audio'
  }
])

/**
 * @param {'dash' | 'legacy' | 'audio'} value
 */
function changeFormat(value) {
  emit('change-format', value)
}

const watchedProgressSavingInSemiAutoMode = computed(() => {
  return store.getters.getWatchedProgressSavingMode === 'semi-auto'
})

function saveWatchedProgressManually() {
  emit('save-watched-progress')
}

/** @type {import('vue').ComputedRef<boolean>} */
const rememberPlaybackSpeedPerChannel = computed(() => store.getters.getRememberPlaybackSpeedPerChannel)

/** @type {import('vue').ComputedRef<boolean>} */
const autoUpdateChannelPlaybackSpeeds = computed(() => store.getters.getAutoUpdateChannelPlaybackSpeeds)

/** @type {import('vue').ComputedRef<boolean>} */
const useQuickPlaybackSpeedBar = computed(() => store.getters.getUseQuickPlaybackSpeedBar)

const showSaveChannelPlaybackSpeedButton = computed(() => {
  return !props.isUpcoming &&
    rememberPlaybackSpeedPerChannel.value &&
    !autoUpdateChannelPlaybackSpeeds.value &&
    !useQuickPlaybackSpeedBar.value
})

function saveChannelPlaybackSpeedManually() {
  emit('save-channel-playback-speed')
}

/** @type {import('vue').ComputedRef<boolean>} */
const rememberVideoQualityPerChannel = computed(() => store.getters.getRememberVideoQualityPerChannel)

/** @type {import('vue').ComputedRef<boolean>} */
const autoUpdateChannelVideoQualities = computed(() => store.getters.getAutoUpdateChannelVideoQualities)

const showSaveChannelVideoQualityButton = computed(() => {
  return !props.isUpcoming && rememberVideoQualityPerChannel.value && !autoUpdateChannelVideoQualities.value
})

function saveChannelVideoQualityManually() {
  emit('save-channel-video-quality')
}

/** @type {import('vue').ComputedRef<boolean>} */
const useSponsorBlock = computed(() => store.getters.getUseSponsorBlock)

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

watch(
  () => [props.title, props.channelName, props.videoThumbnail],
  ([title, artist, artworkSrc]) => {
    if ('mediaSession' in navigator && typeof MediaMetadata === 'function') {
      tabMediaCoordinator.setMetadata(tabId ?? 'web', new MediaMetadata({
        title,
        artist,
        artwork: artworkSrc
          ? [{ src: artworkSrc, sizes: '128x128', type: 'image/png' }]
          : []
      }))
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  tabMediaCoordinator.setMetadata(tabId ?? 'web', null)
})

const showPlaylists = computed(() => !store.getters.getHidePlaylists)
const isInAnyPlaylist = computed(() => store.getters.getPlaylistVideoCounts.has(props.id))

// `description` and `viewCount` are intentionally left out,
// the store drops them from playlist entries as undesired attributes
const addToPlaylistVideoData = computed(() => ({
  videoId: props.id,
  title: props.title,
  author: props.channelName,
  authorId: props.channelId,
  lengthSeconds: props.lengthSeconds,
  published: props.published,
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

const quickBookmarkIconTheme = computed(() => isInQuickBookmarkPlaylist.value ? 'base favorite' : 'base')

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
    makeActive: !isMiddleClick
  })
}
</script>

<style scoped src="./WatchVideoInfo.css" />
