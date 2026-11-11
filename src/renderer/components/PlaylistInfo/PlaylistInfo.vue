<template>
  <div
    class="playlistInfo"
    :class="{ [theme]: true }"
  >
    <div
      v-if="!editMode"
      class="playlistThumbnail"
    >
      <router-link
        v-if="firstVideoIdExists"
        :to="{
          path: `/watch/${startVideo.videoId}`,
          query: {
            playlistId: id,
            playlistType: videoPlaylistType,
            playlistItemId: startVideo.playlistItemId,
          },
        }"
        tabindex="-1"
        @click="pickShuffledStartVideo"
      >
        <FtRetryImage
          :src="thumbnail"
          alt=""
          :class="{ blur: blurThumbnails }"
        />
      </router-link>
      <FtRetryImage
        v-else
        :src="thumbnail"
        alt=""
        :class="{ blur: blurThumbnails }"
      />
    </div>

    <div
      v-if="editMode"
      class="editForm"
    >
      <div class="editFields">
        <FtInput
          ref="playlistTitleInput"
          class="inputElement"
          :label="$t('User Playlists.Playlist Name')"
          :icon="['fas', 'list']"
          :placeholder="$t('Form Inputs.Example', { example: $t('Tab Organizer.Icon Labels.Music') })"
          :show-action-button="false"
          :value="newTitle"
          :maxlength="255"
          @input="handlePlaylistNameInput"
          @keydown.enter="savePlaylistInfo"
        />
        <p
          v-if="inputPlaylistNameBlank"
          class="editError"
        >
          {{ $t('User Playlists.SinglePlaylistView.Toast["Playlist name cannot be empty. Please input a name."]') }}
        </p>
        <p
          v-if="inputPlaylistWithNameExists"
          class="editError"
        >
          {{ $t('User Playlists.CreatePlaylistPrompt.Toast["There is already a playlist with this name. Please pick a different name."]') }}
        </p>
        <FtInput
          class="inputElement descriptionInput"
          :label="$t('User Playlists.Playlist Description')"
          :icon="['fas', 'file-lines']"
          :placeholder="$t('Form Inputs.Playlist Description Hint')"
          :show-action-button="false"
          :value="newDescription"
          @input="(input) => newDescription = input"
          @keydown.enter="savePlaylistInfo"
        />
        <div class="editToggles">
          <FtToggleSwitch
            :label="$t('User Playlists.Add new videos to the top (custom order)')"
            :default-value="newAddVideosToTop"
            :sync-setting-keys="preferencesSyncKeys"
            @change="newAddVideosToTop = $event"
          />
          <FtToggleSwitch
            :label="t('User Playlists.Shuffle videos by default')"
            :default-value="newShuffleByDefault"
            :sync-setting-keys="preferencesSyncKeys"
            @change="newShuffleByDefault = $event"
          />
          <FtToggleSwitch
            :label="t('User Playlists.Remove videos once watched')"
            :tooltip="t('User Playlists.Remove videos once watched Tooltip')"
            :default-value="newRemoveWatchedVideos"
            :sync-setting-keys="preferencesSyncKeys"
            @change="newRemoveWatchedVideos = $event"
          />
        </div>
      </div>
      <div class="editPickers">
        <FtPlaylistThumbnailPicker
          v-model="newCustomThumbnail"
          :default-thumbnail="defaultThumbnail"
          @loading="thumbnailLoading = $event"
        />
        <FtQuickBookmarkIconPicker
          v-model="newQuickBookmarkIcon"
        />
      </div>
    </div>
    <template v-else>
      <div class="playlistStats">
        <h2
          class="playlistTitle"
          dir="auto"
        >
          {{ title }}
        </h2>
        <p v-if="!hidePlaylistStats">
          {{ t('Global.Counts.Video Count', { count: parsedVideoCount }, videoCount) }}
          <template v-if="!hideViews && !isUserPlaylist && viewCount >= 0">
            - {{ t('Global.Counts.View Count', { count: parsedViewCount }, viewCount) }}
          </template>
          <template v-if="lastUpdated">
            -
            <template v-if="infoSource !== 'local'">
              {{ $t("Playlist.Last Updated On") }}
            </template>
            {{ lastUpdated }}
          </template>
          <template v-if="durationFormatted !== ''">
            <br>
            {{ $t('User Playlists.TotalTimePlaylist', { duration: durationFormatted }) }}
          </template>
        </p>
        <p v-if="isUserPlaylist && selectedUserPlaylist?.sourcePlaylistId">
          <router-link :to="`/playlist/${selectedUserPlaylist.sourcePlaylistId}`">
            {{ t('User Playlists.Source Playlist') }}
          </router-link>
        </p>
      </div>

      <p
        v-if="description"
        v-overlay-scrollbars
        class="playlistDescription"
        dir="auto"
      >
        {{ description }}
      </p>
    </template>

    <hr class="playlistInfoSeparator">

    <div
      ref="actionRow"
      class="channelShareWrapper"
    >
      <component
        :is="enableChannelLinks ? 'router-link' : 'div'"
        v-if="!isUserPlaylist && channelId"
        class="playlistChannel"
        :to="`/channel/${channelId}`"
      >
        <FtRetryImage
          v-if="channelThumbnail"
          :fallback-icon="['fas', 'circle-user']"
          class="channelThumbnail"
          :src="channelThumbnail"
          alt=""
        />
        <h3
          class="channelName"
          dir="auto"
        >
          {{ channelName }}
        </h3>
      </component>

      <div class="playlistOptionsWrapper">
        <FtButtonGroup
          ref="playlistOptions"
          class="playlistOptions"
        >
          <template v-if="editMode">
            <FtButton
              class="actionButton"
              :label="t('User Playlists.Save Changes')"
              :icon="['fas', 'save']"
              :disabled="playlistPersistenceDisabled"
              theme="primary"
              @click="savePlaylistInfo"
            />
            <FtButton
              class="actionButton"
              :label="t('User Playlists.Cancel')"
              :icon="['fas', 'times']"
              theme="secondary"
              variant="outlined"
              @click="exitEditMode"
            />
          </template>
          <template v-else>
            <FtButton
              v-if="inActionRow('edit')"
              class="actionButton"
              data-overflow-key="edit"
              :title="t('User Playlists.Edit Playlist Info')"
              :icon="['fas', 'edit']"
              theme="secondary"
              @click="enterEditMode"
            >
              <template #label>
                <span class="buttonLabel">{{ t('User Playlists.Edit') }}</span>
              </template>
            </FtButton>
            <FtButton
              v-if="inActionRow('save')"
              class="actionButton"
              data-overflow-key="save"
              :title="isPlaylistBookmarked ? t('User Playlists.Remove Saved Playlist') : t('User Playlists.Save Playlist')"
              :icon="isPlaylistBookmarked ? ['fas', 'bookmark'] : ['far', 'bookmark']"
              :selected="isPlaylistBookmarked"
              :disabled="playlistBookmarkPending"
              theme="secondary"
              @click="emit('toggle-playlist-bookmark')"
            >
              <template #label>
                <span class="buttonLabel">{{ t('User Playlists.Save') }}</span>
              </template>
            </FtButton>
            <FtButton
              v-if="inActionRow('queue')"
              class="actionButton"
              data-overflow-key="queue"
              :title="t('Playlist.Add Playlist to Queue')"
              :disabled="queueSnapshotPending"
              :aria-busy="queueSnapshotPending"
              theme="secondary"
              @click="addPlaylistToQueue"
            >
              <FtIcon
                :icon="queueSnapshotPending ? ['fas', 'sync'] : ['fas', 'add-to-queue']"
                :spin="queueSnapshotPending"
                aria-hidden="true"
              />
              <span class="buttonLabel">{{ t('Video.Add to Queue') }}</span>
            </FtButton>
            <FtButton
              v-if="inActionRow('download')"
              class="actionButton"
              data-overflow-key="download"
              :title="t('Downloads.Download Playlist')"
              :icon="['fas', 'download']"
              theme="secondary"
              @click="showDownloadPrompt = true"
            >
              <template #label>
                <span class="buttonLabel">{{ t('Downloads.Download') }}</span>
              </template>
            </FtButton>
            <FtButton
              v-if="unavailableVideoScan"
              class="actionButton"
              aria-busy="true"
              theme="secondary"
              @click="unavailableVideoScan.cancel()"
            >
              <FtIcon
                :icon="['fas', 'sync']"
                spin
                aria-hidden="true"
              />
              {{ `${t('User Playlists.Cancel')} (${unavailableVideoScan.checked}/${unavailableVideoScan.total})` }}
            </FtButton>
            <FtShareButton
              v-if="sharePlaylistButtonVisible"
              :id="id"
              class="sharePlaylistIcon"
              :size="14"
              :dropdown-position-y="description ? 'top' : 'bottom'"
              share-target-type="Playlist"
            />
            <FtButton
              v-if="moreMenuItems.some(item => item.type !== 'separator')"
              ref="moreOptionsButton"
              class="actionButton"
              :title="t('Video.More Options')"
              aria-haspopup="menu"
              :aria-busy="moreOptionsPending"
              theme="secondary"
              @click="openMoreOptionsMenu"
            >
              <FtIcon
                :icon="moreOptionsPending ? ['fas', 'sync'] : ['fas', 'ellipsis-h']"
                :spin="moreOptionsPending"
                aria-hidden="true"
              />
              <span class="buttonLabel">{{ t('More') }}</span>
            </FtButton>
          </template>
        </FtButtonGroup>
      </div>
      <FtPrompt
        v-if="showDeletePlaylistPrompt"
        autosize
        :label="$t('User Playlists.Are you sure you want to delete this playlist? This cannot be undone')"
        :option-names="deletePlaylistPromptNames"
        :option-values="DELETE_PLAYLIST_PROMPT_VALUES"
        :option-icons="[['fas', 'trash'], ['fas', 'xmark']]"
        is-first-option-destructive
        @click="handleDeletePlaylistPromptAnswer"
      />
      <FtPrompt
        v-if="showRemoveVideosOnWatchPrompt"
        autosize
        :label="removeVideosOnWatchPromptLabelText"
        :option-names="deletePlaylistPromptNames"
        :option-values="DELETE_PLAYLIST_PROMPT_VALUES"
        :option-icons="[['fas', 'trash'], ['fas', 'xmark']]"
        is-first-option-destructive
        @click="handleRemoveVideosOnWatchPromptAnswer"
      />
      <FtPrompt
        v-if="showRemoveDuplicateVideosPrompt"
        autosize
        :label="removeDuplicateVideosPromptLabelText"
        :option-names="deletePlaylistPromptNames"
        :option-values="DELETE_PLAYLIST_PROMPT_VALUES"
        :option-icons="[['fas', 'trash'], ['fas', 'xmark']]"
        is-first-option-destructive
        @click="handleRemoveDuplicateVideosPromptAnswer"
      />
      <FtPrompt
        v-if="showPreloadPlaylistPrompt"
        autosize
        theme="readable-width"
        :label="t('Playlist.Preload Playlist Warning Title')"
        :extra-labels="[t('Playlist.Preload Playlist Warning')]"
        :option-names="[t('Yes'), t('No'), t('Confirmations.Never Ask Again')]"
        :option-values="['preload', 'cancel', 'neverAskAgain']"
        :option-icons="[['fas', 'forward'], ['fas', 'xmark'], ['fas', 'eye-slash']]"
        @click="handlePreloadPlaylistPromptAnswer"
      />
      <FtPrompt
        v-if="showExportPrompt"
        autosize
        :label="t('Settings.Data Settings.Select Export Type')"
        :option-names="exportNames"
        :option-values="EXPORT_VALUES"
        :option-icons="[['fas', 'database'], ['fab', 'youtube'], ['fas', 'link'], ['fas', 'xmark']]"
        @click="handleExport"
      />
      <WatchVideoDownloadPrompt
        v-if="enableDownloads && showDownloadPrompt"
        :playlist-id="isUserPlaylist ? '' : id"
        :playlist-key="id"
        :video-ids="isUserPlaylist ? videos.map(video => video.videoId) : []"
        :is-playlist="true"
        :title="title"
        :thumbnail="isUserPlaylist && thumbnailPreference !== 'hidden' ? defaultThumbnail : thumbnail"
        @close="showDownloadPrompt = false"
      />
    </div>
    <div
      v-if="searchVideoModeAllowed"
      class="searchInputsRow"
    >
      <FtInput
        ref="searchInput"
        class="inputElement"
        input-type="search"
        :label="$t('User Playlists.SinglePlaylistView.Search for Videos')"
        :icon="['fas', 'search']"
        :placeholder="$t('Form Inputs.Search Text Hint')"
        :show-action-button="false"
        :value="query"
        :maxlength="255"
        @input="updateQueryDebounced"
      />
    </div>
  </div>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import { supportsYtDlp } from '../../helpers/ytDlpCapabilities'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { FtIcon } from '@opentubex/icons'

import FtButton from '../FtButton/FtButton.vue'
import FtButtonGroup from '../FtButtonGroup/FtButtonGroup.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtPlaylistThumbnailPicker from '../FtPlaylistThumbnailPicker.vue'
import FtQuickBookmarkIconPicker from '../FtQuickBookmarkIconPicker/FtQuickBookmarkIconPicker.vue'
import FtShareButton from '../FtShareButton/FtShareButton.vue'
import WatchVideoDownloadPrompt from '../WatchVideoDownloadPrompt/WatchVideoDownloadPrompt.vue'

import store from '../../store/index'

import {
  ctrlFHandler,
  debounce,
  formatDurationAsTimestamp,
  formatNumber,
  formatViewCount,
  showToast,
  getTodayDateStrLocalTimezone,
  writeFileWithPicker,
  deepCopy,
} from '../../helpers/utils'
import { addingMissingVideos, addMissingPlaylistVideos, loadPlaylistVideos, scanPlaylistForUnavailableVideos, unavailableVideoScans } from '../../helpers/playlistTasks'
import { isHistoryEntryWatched } from '../../helpers/history'
import { getQuickBookmarkIconValue } from '../../helpers/quickBookmarkIcons'
import { PLAYLIST_PREFERENCES_SYNC_KEY } from '../../helpers/playlist-preferences-sync'
import { openButtonMenu } from '../../helpers/buttonMenu'
import { useFittedButtonLabels } from '../../composables/useFittedButtonLabels'
import thumbnailPlaceholder from '../../assets/img/thumbnail_placeholder.svg'

const props = defineProps({
  id: {
    type: String,
    required: true,
  },
  firstVideoId: {
    type: String,
    required: true,
  },
  firstVideoPlaylistItemId: {
    type: String,
    required: true,
  },
  playlistThumbnail: {
    type: String,
    required: true,
  },
  theme: {
    type: String,
    default: 'base'
  },
  title: {
    type: String,
    required: true,
  },
  channelThumbnail: {
    type: String,
    required: true,
  },
  channelName: {
    type: String,
    required: true,
  },
  channelId: {
    type: String,
    default: null,
  },
  videoCount: {
    type: Number,
    required: true,
  },
  videos: {
    type: Array,
    required: true
  },
  sortedVideos: {
    type: Array,
    required: true
  },
  viewCount: {
    type: Number,
    required: true,
  },
  totalPlaylistDuration: {
    type: Number,
    required: true
  },
  isDurationApproximate: {
    type: Boolean,
    required: true
  },
  lastUpdated: {
    type: String,
    default: undefined,
  },
  description: {
    type: String,
    required: true,
  },
  infoSource: {
    type: String,
    required: true,
  },
  moreVideoDataAvailable: {
    type: Boolean,
    required: true,
  },
  searchVideoModeAllowed: {
    type: Boolean,
    required: true,
  },
  searchQueryText: {
    type: String,
    required: true,
  },
  isPlaylistBookmarked: {
    type: Boolean,
    required: true,
  },
  playlistBookmarkPending: {
    type: Boolean,
    required: true,
  },
  preloadAvailable: {
    type: Boolean,
    default: false,
  },
  preloadPending: {
    type: Boolean,
    default: false,
  },
  preloadComplete: {
    type: Boolean,
    default: false,
  },
  preloadRequiresConfirmation: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['enter-edit-mode', 'exit-edit-mode', 'search-video-query-change', 'prompt-open', 'prompt-close', 'toggle-playlist-bookmark', 'preload-playlist'])

const { t } = useI18n()
const enableDownloads = computed(() => store.getters.getEnableDownloads)

const query = ref('')
const editMode = ref(false)
const showDeletePlaylistPrompt = ref(false)
const showRemoveVideosOnWatchPrompt = ref(false)
const showRemoveDuplicateVideosPrompt = ref(false)
const showPreloadPlaylistPrompt = ref(false)
const showExportPrompt = ref(false)
const showDownloadPrompt = ref(false)
const newTitle = ref(props.title)
const newDescription = ref(props.description)
const newAddVideosToTop = ref(false)
const newShuffleByDefault = ref(false)
const newRemoveWatchedVideos = ref(false)
// Preferences sync only for playlists on the server
const preferencesSyncKeys = computed(() => store.state.settings.syncServerSyncPlaylists ? [PLAYLIST_PREFERENCES_SYNC_KEY] : [])
const newQuickBookmarkIcon = ref('bookmark')
const newCustomThumbnail = ref('')
const thumbnailLoading = ref(false)

if (props.videoCount > 0) {
  query.value = props.searchQueryText
}

const durationFormatted = computed(() => {
  let formatted = formatDurationAsTimestamp(props.totalPlaylistDuration)

  if (props.moreVideoDataAvailable && !isUserPlaylist.value) {
    formatted += '+'
  }

  if (props.isDurationApproximate && formatted) {
    formatted = `~${formatted}`
  }

  return formatted
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideSharingActions = computed(() => store.getters.getHideSharingActions)

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => store.getters.getCurrentInvidiousInstanceUrl)

/** @type {import('vue').ComputedRef<Record<string, object>>} */
const historyCacheById = computed(() => store.getters.getHistoryCacheById)

/** @type {import('vue').ComputedRef<'' | 'start' | 'middle' | 'end' | 'hidden' | 'blur'>} */
const thumbnailPreference = computed(() => store.getters.getThumbnailPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const blurThumbnails = computed(() => store.getters.getBlurThumbnails)

/** @type {import('vue').ComputedRef<'local' | 'invidious' | 'yattee'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)

/** @type {import('vue').ComputedRef<boolean>} */
const hideViews = computed(() => store.getters.getHideVideoViews)

/** @type {import('vue').ComputedRef<boolean>} */
const showPlaylists = computed(() => !store.getters.getHidePlaylists)

/** @type {import('vue').ComputedRef<boolean>} */
const hidePlaylistStats = computed(() => store.getters.getHidePlaylistStats)

/** @type {import('vue').ComputedRef<object | undefined>} */
const selectedUserPlaylist = computed(() => store.getters.getPlaylist(props.id))

/** @type {import('vue').ComputedRef<object[]>} */
const allPlaylists = computed(() => store.getters.getAllPlaylists)

const firstVideoIdExists = computed(() => props.firstVideoId !== '')

/** @type {import('vue').ComputedRef<boolean>} */
const shortenViewCounts = computed(() => store.getters.getShortenViewCounts)

const parsedViewCount = computed(() => formatViewCount(props.viewCount, shortenViewCounts.value))
const parsedVideoCount = computed(() => formatNumber(props.videoCount))

/** @type {import('vue').ComputedRef<string>} */
const thumbnail = computed(() => {
  if (thumbnailPreference.value === 'hidden') return thumbnailPlaceholder
  return (isUserPlaylist.value && selectedUserPlaylist.value?.customThumbnail) || defaultThumbnail.value
})

const defaultThumbnail = computed(() => {
  if (!firstVideoIdExists.value) {
    return thumbnailPlaceholder
  }

  let baseUrl = 'https://i.ytimg.com'
  if (backendPreference.value === 'invidious') {
    baseUrl = currentInvidiousInstanceUrl.value
  } else if (typeof props.playlistThumbnail === 'string' && props.playlistThumbnail.length > 0) {
    // Use playlist thumbnail provided by YT when available
    return props.playlistThumbnail
  }

  switch (thumbnailPreference.value) {
    case 'start':
      return `${baseUrl}/vi/${props.firstVideoId}/mq1.jpg`
    case 'middle':
      return `${baseUrl}/vi/${props.firstVideoId}/mq2.jpg`
    case 'end':
      return `${baseUrl}/vi/${props.firstVideoId}/mq3.jpg`
    default:
      return `${baseUrl}/vi/${props.firstVideoId}/maxresdefault.jpg`
  }
})

const isUserPlaylist = computed(() => props.infoSource === 'user')
const videoPlaylistType = computed(() => isUserPlaylist.value ? 'user' : '')

const shuffledStartVideo = ref(null)

// Playlists that shuffle by default start on a random video instead of the first one.
// The shown videos exclude removals that can still be undone. Each click picks the
// next start after the link has navigated, so returning to this page or opening the
// link again does not repeat the same video.
function pickShuffledStartVideo() {
  const videos = isUserPlaylist.value && selectedUserPlaylist.value?.shuffleByDefault === true
    ? props.videos
    : []
  shuffledStartVideo.value = videos.length > 0 ? videos[Math.floor(Math.random() * videos.length)] : null
}

watch(() => props.videos, pickShuffledStartVideo, { immediate: true })
watch(() => selectedUserPlaylist.value?.shuffleByDefault, pickShuffledStartVideo)

const startVideo = computed(() => shuffledStartVideo.value ?? {
  videoId: props.firstVideoId,
  playlistItemId: props.firstVideoPlaylistItemId,
})

/** @type {import('vue').ComputedRef<boolean>} */
const userPlaylistAnyVideoWatched = computed(() => {
  if (!isUserPlaylist.value) { return false }

  // Playlists replace their video lists, and the revision covers watched
  // changes, so large playlists are scanned without tracking every entry.
  store.state.history.historyEntriesRevision // eslint-disable-line no-unused-expressions
  const historyCacheById_ = toRaw(historyCacheById.value)
  return toRaw(selectedUserPlaylist.value.videos).some((video) => {
    return isHistoryEntryWatched(historyCacheById_[video.videoId])
  })
})

/** @type {import('vue').ComputedRef<number>} */
const userPlaylistUniqueVideosCount = computed(() => {
  const videos = selectedUserPlaylist.value?.videos
  return videos ? new Set(toRaw(videos).map(video => video.videoId)).size : 0
})

const userPlaylistDuplicateItemCount = computed(() => {
  if (userPlaylistUniqueVideosCount.value === 0) { return 0 }

  return selectedUserPlaylist.value.videos.length - userPlaylistUniqueVideosCount.value
})

const sharePlaylistButtonVisible = computed(() => {
  return !isUserPlaylist.value && !hideSharingActions.value
})

/** @type {import('vue').ComputedRef<object | undefined>} */
const quickBookmarkPlaylist = computed(() => {
  return store.getters.getQuickBookmarkPlaylist
})

const quickBookmarkIcon = computed(() => store.getters.getQuickBookmarkIcon)

const markedAsQuickBookmarkTarget = computed(() => {
  return selectedUserPlaylist.value &&
    quickBookmarkPlaylist.value &&
    quickBookmarkPlaylist.value._id === selectedUserPlaylist.value._id
})

const pinnedPlaylistIds = computed(() => store.getters.getPinnedPlaylistIds)
const isPinnedToNavigation = computed(() => pinnedPlaylistIds.value.includes(props.id))

function togglePinnedToNavigation() {
  store.dispatch('updatePinnedPlaylistIds', isPinnedToNavigation.value
    ? pinnedPlaylistIds.value.filter(id => id !== props.id)
    : [...pinnedPlaylistIds.value, props.id])
}

const SEPARATOR = { type: 'separator' }

/**
 * The actions of the action row that move to the More menu when even their
 * icons do not fit on one line, keyed by name.
 */
const rowActions = computed(() => ({
  edit: {
    visible: isUserPlaylist.value,
    label: t('User Playlists.Edit Playlist Info'),
    icon: ['fas', 'edit'],
    run: enterEditMode,
  },
  save: {
    visible: !isUserPlaylist.value && showPlaylists.value,
    label: props.isPlaylistBookmarked ? t('User Playlists.Remove Saved Playlist') : t('User Playlists.Save Playlist'),
    icon: props.isPlaylistBookmarked ? ['fas', 'bookmark'] : ['far', 'bookmark'],
    enabled: !props.playlistBookmarkPending,
    run: () => emit('toggle-playlist-bookmark'),
  },
  queue: {
    visible: props.videoCount > 0,
    label: t('Playlist.Add Playlist to Queue'),
    icon: ['fas', 'add-to-queue'],
    enabled: !queueSnapshotPending.value,
    run: addPlaylistToQueue,
  },
  download: {
    visible: supportsYtDlp && enableDownloads.value && props.videoCount > 0,
    label: t('Downloads.Download Playlist'),
    icon: ['fas', 'download'],
    run: () => { showDownloadPrompt.value = true },
  },
}))

// The order in which the row's actions move to the More menu
const ROW_ACTION_OVERFLOW_ORDER = ['download', 'queue', 'save', 'edit']

/**
 * Less frequent actions for the overflow menu, grouped by separators. The menu
 * drops leading, trailing, and repeated separators.
 * @type {import('vue').ComputedRef<object[]>}
 */
const ownMenuItems = computed(() => {
  const items = []
  const hasVideos = props.videoCount > 0

  if (isUserPlaylist.value) {
    items.push({
      label: isPinnedToNavigation.value ? t('User Playlists.Unpin from Navigation') : t('User Playlists.Pin to Navigation'),
      icon: ['fas', isPinnedToNavigation.value ? 'thumbtack-slash' : 'thumbtack'],
      run: togglePinnedToNavigation,
    }, {
      label: markedAsQuickBookmarkTarget.value ? t('User Playlists.Quick Bookmark Enabled') : t('User Playlists.Enable Quick Bookmark With This Playlist'),
      icon: markedAsQuickBookmarkTarget.value ? quickBookmarkIcon.value : ['far', 'bookmark'],
      enabled: !markedAsQuickBookmarkTarget.value,
      run: enableQuickBookmarkForThisPlaylist,
    }, SEPARATOR)
  }

  if (hasVideos && showPlaylists.value) {
    items.push({ label: t('User Playlists.Copy Playlist'), icon: ['fas', 'copy'], run: copyPlaylist })
  }
  if (isUserPlaylist.value && selectedUserPlaylist.value?.sourcePlaylistId) {
    items.push({ label: t('User Playlists.Add Missing Videos'), icon: ['fas', 'playlist-merge'], enabled: !addingMissingVideosPending.value, run: () => addMissingPlaylistVideos(props.id) })
  }
  if (isUserPlaylist.value && hasVideos) {
    items.push({ label: t('User Playlists.Export Playlist'), icon: ['fas', 'file-export'], run: () => { showExportPrompt.value = true } })
  }
  if (props.preloadAvailable && hasVideos) {
    items.push({
      label: props.preloadPending
        ? t('Playlist.Preloading Playlist')
        : props.preloadComplete
          ? t('Playlist.Playlist Already Preloaded')
          : t('Playlist.Preload Playlist'),
      icon: ['fas', 'forward'],
      enabled: !props.preloadPending && !props.preloadComplete,
      run: () => {
        if (props.preloadRequiresConfirmation) {
          showPreloadPlaylistPrompt.value = true
        } else {
          emit('preload-playlist')
        }
      },
    })
  }
  items.push(SEPARATOR)

  if (userPlaylistDuplicateItemCount.value > 0) {
    items.push({ label: t('User Playlists.Remove Duplicate Videos'), icon: ['fas', 'users-slash'], run: () => { showRemoveDuplicateVideosPrompt.value = true } })
  }
  if (userPlaylistAnyVideoWatched.value) {
    items.push({ label: t('User Playlists.Remove Watched Videos'), icon: ['fas', 'eye-slash'], run: () => { showRemoveVideosOnWatchPrompt.value = true } })
  }
  // While the scan runs, its progress and cancel button are in the action row.
  if (isUserPlaylist.value && hasVideos && !unavailableVideoScan.value) {
    items.push({ label: t('User Playlists.Remove Unavailable Videos'), icon: ['fas', 'link-slash'], run: () => scanPlaylistForUnavailableVideos(props.id) })
  }
  items.push(SEPARATOR)

  if (isUserPlaylist.value && !selectedUserPlaylist.value.protected) {
    items.push({
      // The quick bookmark target cannot be deleted, so explain why in place of the label.
      label: markedAsQuickBookmarkTarget.value ? t('User Playlists["Cannot delete the quick bookmark target playlist."]') : t('User Playlists.Delete Playlist'),
      icon: ['fas', 'trash'],
      enabled: !markedAsQuickBookmarkTarget.value,
      run: () => { showDeletePlaylistPrompt.value = true },
    })
  }

  return items
})

const moreOptionsButton = useTemplateRef('moreOptionsButton')

// Labels collapse to icons from the end instead of wrapping the actions onto a
// second row. If even the icons do not fit, actions move to the More menu.
const { overflowed: overflowedRowActions } = useFittedButtonLabels(useTemplateRef('playlistOptions'), useTemplateRef('actionRow'),
  () => editMode.value ? [] : ROW_ACTION_OVERFLOW_ORDER.filter(key => rowActions.value[key].visible))

/** @param {string} key */
function inActionRow(key) {
  return rowActions.value[key].visible && !overflowedRowActions.value.includes(key)
}

/** @type {import('vue').ComputedRef<object[]>} */
const moreMenuItems = computed(() => {
  // Moved actions lead the menu in their order in the row
  const moved = Object.entries(rowActions.value)
    .filter(([key]) => overflowedRowActions.value.includes(key))
    .map(([, { label, icon, enabled = true, run }]) => ({ label, icon, enabled, run }))
  return [...moved, SEPARATOR, ...ownMenuItems.value].map(item => ({ enabled: true, ...item }))
})

function openMoreOptionsMenu() {
  openButtonMenu(moreOptionsButton.value.$el, moreMenuItems, props.title)
}

onBeforeUnmount(() => {
  window.dispatchEvent(new CustomEvent('opentubex:close-context-menu', { detail: moreMenuItems }))
})

const inputPlaylistNameBlank = computed(() => newTitle.value.trim() === '')

const inputPlaylistWithNameExists = computed(() => {
  const playlistName = newTitle.value
  const selectedUserPlaylistId = selectedUserPlaylist.value._id

  return playlistName !== '' &&
    allPlaylists.value.some((playlist) => {
      return playlist._id !== selectedUserPlaylistId && playlist.playlistName === playlistName
    })
})

const playlistPersistenceDisabled = computed(() => {
  return inputPlaylistNameBlank.value || inputPlaylistWithNameExists.value || thumbnailLoading.value
})

watch(showDeletePlaylistPrompt, handlePromptToggle)
watch(showRemoveVideosOnWatchPrompt, handlePromptToggle)
watch(showRemoveDuplicateVideosPrompt, handlePromptToggle)
watch(showPreloadPlaylistPrompt, handlePromptToggle)
watch(showExportPrompt, handlePromptToggle)
watch(showDownloadPrompt, handlePromptToggle)
watch(enableDownloads, (enabled) => {
  if (!enabled) showDownloadPrompt.value = false
})

/**
 * @param {boolean} shown
 */
function handlePromptToggle(shown) {
  if (shown) {
    emit('prompt-open')
  } else {
    emit('prompt-close')
  }
}

/**
 * @param {string} input
 */
function handlePlaylistNameInput(input) {
  if (input.trim() === '') {
    // Need to show message for blank input
    newTitle.value = input
    return
  }

  newTitle.value = input.trim()
}

// Copying, adding missing videos, and checking for unavailable videos run in
// the background, so they continue when the playlist is left.
const addingMissingVideosPending = computed(() => addingMissingVideos.has(props.id))
const unavailableVideoScan = computed(() => unavailableVideoScans.get(props.id))

const queueSnapshotPending = ref(false)
let queueSnapshot
// Adding missing videos starts from the menu, as does adding to the queue when that action moved there
const moreOptionsPending = computed(() => addingMissingVideosPending.value || (queueSnapshotPending.value && !inActionRow('queue')))

function cancelQueueSnapshot() {
  queueSnapshot?.cancel()
}

watch(() => props.id, cancelQueueSnapshot)
onBeforeUnmount(cancelQueueSnapshot)

function copyPlaylist() {
  const newPlaylistDefaultProperties = {
    title: props.channelName === '' ? props.title : `${props.title} | ${props.channelName}`,
    description: props.description,
    sourcePlaylistId: isUserPlaylist.value ? selectedUserPlaylist.value?.sourcePlaylistId : props.id,
  }
  if (isUserPlaylist.value) {
    store.dispatch('showAddToPlaylistPromptForManyVideos', { videos: props.videos, newPlaylistDefaultProperties })
    return
  }

  // The prompt opens right away and the playlist's videos load in the meantime
  const pending = loadPlaylistVideos(props.id, {
    icon: ['fas', 'copy'],
    message: t('User Playlists.Background Tasks.Loading videos from {playlistName}', { playlistName: props.title }),
  })
  store.dispatch('showAddToPlaylistPromptForManyVideos', {
    pendingVideos: { ...pending, videoCount: props.videoCount, previewVideos: props.videos.slice(0, 3) },
    newPlaylistDefaultProperties,
  })
}

async function addPlaylistToQueue() {
  if (queueSnapshotPending.value) return
  // Queue user playlists in their displayed sort order.
  let videos = props.sortedVideos
  if (!isUserPlaylist.value) {
    queueSnapshotPending.value = true
    queueSnapshot = loadPlaylistVideos(props.id, {
      icon: ['fas', 'add-to-queue'],
      message: t('User Playlists.Background Tasks.Loading videos from {playlistName}', { playlistName: props.title }),
    })
    videos = await queueSnapshot.promise
    queueSnapshot = null
    queueSnapshotPending.value = false
    // Leaving the playlist while it loads cancels the action.
    if (!videos) return
  }
  if (videos.length === 0) return

  store.commit('addVideosToWatchQueue', { videos: deepCopy(videos) })
  showToast({ message: t('Playlist.Playlist Added to Queue'), icon: ['fas', 'queue'] })
}

async function savePlaylistInfo() {
  // Still possible to attempt to create via pressing enter
  if (playlistPersistenceDisabled.value) { return }

  const playlist = {
    playlistName: newTitle.value,
    protected: selectedUserPlaylist.value.protected,
    description: newDescription.value,
    addVideosToTop: newAddVideosToTop.value,
    shuffleByDefault: newShuffleByDefault.value,
    removeWatchedVideos: newRemoveWatchedVideos.value,
    quickBookmarkIcon: newQuickBookmarkIcon.value,
    customThumbnail: newCustomThumbnail.value,
    _id: props.id,
  }
  try {
    if (!await store.dispatch('updatePlaylist', playlist)) throw new Error('Could not update playlist')
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["Playlist has been updated."]'),
      icon: ['fas', 'check'],
    })
    exitEditMode()
  } catch (e) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(e)
  }
}

const playlistTitleInput = useTemplateRef('playlistTitleInput')

function enterEditMode() {
  newTitle.value = props.title
  newDescription.value = props.description
  newAddVideosToTop.value = selectedUserPlaylist.value.addVideosToTop === true
  newShuffleByDefault.value = selectedUserPlaylist.value.shuffleByDefault === true
  newRemoveWatchedVideos.value = selectedUserPlaylist.value.removeWatchedVideos === true
  newQuickBookmarkIcon.value = getQuickBookmarkIconValue(selectedUserPlaylist.value)
  newCustomThumbnail.value = selectedUserPlaylist.value.customThumbnail || ''
  thumbnailLoading.value = false
  editMode.value = true

  emit('enter-edit-mode')

  nextTick(() => {
    playlistTitleInput.value.focus()
  })
}

const EXPORT_VALUES = [
  'database',
  'youtube',
  'urls',
  'close'
]

const exportNames = computed(() => [
  `${t('Settings.Data Settings.Export OpenTubeX')} (.db)`,
  `${t('Settings.Data Settings.Export YouTube')} (.csv)`,
  `${t('User Playlists.Export list of URLs')} (.txt)`,
  t('Close')
])

/**
 * @param {'database' | 'youtube' | 'urls' | null} value
 */
function handleExport(value) {
  showExportPrompt.value = false

  switch (value) {
    case 'database':
      exportAsFreeTubeDatabase()
      break
    case 'youtube':
      exportAsYouTubeCsv()
      break
    case 'urls':
      exportAsListOfUrls()
      break
  }
}

/**
 * @param {string} title
 * @param {string} extension
 */
function getExportFilename(title, extension) {
  const dateStr = getTodayDateStrLocalTimezone()
  const sanitisedTitle = title.replaceAll(/[ "%*/:<>?\\|]/g, '_')
  return `freetube-playlist-${sanitisedTitle}-${dateStr}.${extension}`
}

async function exportAsFreeTubeDatabase() {
  const exportFileName = getExportFilename(selectedUserPlaylist.value.playlistName, 'db')

  const data = JSON.stringify(selectedUserPlaylist.value) + '\n'

  // See DataSettings.vue `promptAndWriteToFile`

  try {
    const response = await writeFileWithPicker(
      exportFileName,
      data,
      t('Settings.Data Settings.Playlist File'),
      'application/x-freetube-db',
      '.db',
      'single-playlist-export',
      'downloads'
    )

    if (response) {
      showToast({
        message: t('User Playlists.The playlist has been successfully exported'),
        icon: ['fas', 'file-download'],
      })
    }
  } catch (error) {
    const message = t('Settings.Data Settings.Unable to write file')
    showToast({ message: `${message}: ${error}`, icon: ['fas', 'circle-exclamation'] })
  }
}

async function exportAsYouTubeCsv() {
  const exportFileName = getExportFilename(props.title, 'csv')

  const videoData = props.sortedVideos.map((video) => {
    // Remove milliseconds and replace "Z" with +00:00 to match YouTube's exports
    const timestamp = new Date(video.timeAdded).toISOString().slice(0, -5) + '+00:00'

    return `${video.videoId},${timestamp}`
  }).join('\n')

  // YouTube includes 6 line feed characters at the end of the file, so we do the same here
  const data = `Video ID,Playlist video creation timestamp\n${videoData}\n\n\n\n\n\n`

  // See DataSettings.vue `promptAndWriteToFile`

  try {
    const response = await writeFileWithPicker(
      exportFileName,
      data,
      '',
      'text/csv',
      '.csv',
      'single-playlist-export',
      'downloads'
    )

    if (response) {
      showToast({
        message: t('User Playlists.The playlist has been successfully exported'),
        icon: ['fas', 'file-download'],
      })
    }
  } catch (error) {
    const message = t('Settings.Data Settings.Unable to write file')
    showToast({ message: `${message}: ${error}`, icon: ['fas', 'circle-exclamation'] })
  }
}

async function exportAsListOfUrls() {
  const exportFileName = getExportFilename(props.title, 'txt')

  const data = props.sortedVideos.map((video) => {
    return `https://www.youtube.com/watch?v=${video.videoId}`
  }).join('\n') + '\n'

  // See DataSettings.vue `promptAndWriteToFile`

  try {
    const response = await writeFileWithPicker(
      exportFileName,
      data,
      '',
      'text/plain',
      '.txt',
      'single-playlist-export',
      'downloads'
    )

    if (response) {
      showToast({
        message: t('User Playlists.The playlist has been successfully exported'),
        icon: ['fas', 'file-download'],
      })
    }
  } catch (error) {
    const message = t('Settings.Data Settings.Unable to write file')
    showToast({ message: `${message}: ${error}`, icon: ['fas', 'circle-exclamation'] })
  }
}

function exitEditMode() {
  editMode.value = false
  thumbnailLoading.value = false

  emit('exit-edit-mode')
}

const DELETE_PLAYLIST_PROMPT_VALUES = ['delete', 'cancel']

const deletePlaylistPromptNames = computed(() => [
  t('Yes, Delete'),
  t('Cancel')
])

/**
 * @param {'preload' | 'cancel' | 'neverAskAgain' | null} option
 */
function handlePreloadPlaylistPromptAnswer(option) {
  showPreloadPlaylistPrompt.value = false
  if (option === 'neverAskAgain') { store.dispatch('updateConfirmLargePlaylistPreload', false) }
  if (option === 'preload' || option === 'neverAskAgain') { emit('preload-playlist') }
}

/** @type {import('vue').ComputedRef<number>} */
const userPlaylistWatchedVideoCount = computed(() => {
  if (!isUserPlaylist.value || !userPlaylistAnyVideoWatched.value) { return false }

  const historyCacheById_ = historyCacheById.value
  return selectedUserPlaylist.value.videos.reduce((count, video) => {
    return isHistoryEntryWatched(historyCacheById_[video.videoId]) ? count + 1 : count
  }, 0)
})

const removeVideosOnWatchPromptLabelText = computed(() => {
  return t(
    'User Playlists.Are you sure you want to remove {playlistItemCount} watched videos from this playlist? This cannot be undone',
    { playlistItemCount: userPlaylistWatchedVideoCount.value },
    userPlaylistWatchedVideoCount.value
  )
})

const removeDuplicateVideosPromptLabelText = computed(() => {
  return t(
    'User Playlists.Are you sure you want to remove {playlistItemCount} duplicate videos from this playlist? This cannot be undone',
    { playlistItemCount: userPlaylistDuplicateItemCount.value },
    userPlaylistDuplicateItemCount.value
  )
})

/**
 * @param {'delete' | 'cancel' | null} option
 */
async function handleRemoveDuplicateVideosPromptAnswer(option) {
  showRemoveDuplicateVideosPrompt.value = false
  if (option !== 'delete') { return }

  const videoIdsAdded = new Set()
  const newVideoItems = selectedUserPlaylist.value.videos.reduce((ary, video) => {
    if (!videoIdsAdded.has(video.videoId)) {
      ary.push(video)
      videoIdsAdded.add(video.videoId)
    }

    return ary
  }, [])

  const removedVideosCount = userPlaylistDuplicateItemCount.value
  if (removedVideosCount === 0) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There were no videos to remove."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    return
  }

  // Remove the entries instead of saving the rest, so videos another window
  // added in the meantime stay. One copy of each video remains.
  const kept = new Set(newVideoItems)
  const removal = {
    _id: selectedUserPlaylist.value._id,
    playlistItemIds: selectedUserPlaylist.value.videos.filter(video => !kept.has(video)).map(video => video.playlistItemId),
    videoIds: [],
  }
  try {
    await store.dispatch('removeVideos', removal)
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast.{videoCount} video(s) have been removed', {
        videoCount: removedVideosCount
      }, removedVideosCount),
      icon: ['fas', 'trash'],
    })
  } catch (e) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(e)
  }
}

/**
 * @param {'delete' | 'cancel' | null} option
 */
async function handleRemoveVideosOnWatchPromptAnswer(option) {
  showRemoveVideosOnWatchPrompt.value = false
  if (option !== 'delete') { return }

  const historyCacheById_ = historyCacheById.value
  const videosToWatch = selectedUserPlaylist.value.videos.filter((video) => {
    return !isHistoryEntryWatched(historyCacheById_[video.videoId])
  })

  const removedVideosCount = selectedUserPlaylist.value.videos.length - videosToWatch.length

  if (removedVideosCount === 0) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There were no videos to remove."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    return
  }

  // Remove the entries instead of saving the rest, so videos another window
  // added in the meantime stay
  const kept = new Set(videosToWatch)
  const removed = selectedUserPlaylist.value.videos.filter(video => !kept.has(video))
  const removal = {
    _id: selectedUserPlaylist.value._id,
    playlistItemIds: removed.map(video => video.playlistItemId),
    videoIds: removed.map(video => video.videoId),
  }
  try {
    await store.dispatch('removeVideos', removal)
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast.{videoCount} video(s) have been removed', {
        videoCount: removedVideosCount
      }, removedVideosCount),
      icon: ['fas', 'trash'],
    })
  } catch (e) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["There was an issue with updating this playlist."]'),
      icon: ['fas', 'circle-exclamation'],
    })
    console.error(e)
  }
}

const router = useRouter()

/**
 * @param {'delete' | 'cancel' | null} option
 */
function handleDeletePlaylistPromptAnswer(option) {
  showDeletePlaylistPrompt.value = false
  if (option !== 'delete') { return }

  if (selectedUserPlaylist.value.protected) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["This playlist is protected and cannot be removed."]'),
      icon: ['fas', 'circle-exclamation'],
    })
  } else {
    store.dispatch('removePlaylist', props.id)
    router.push(
      {
        path: '/userplaylists'
      }
    )
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["Playlist {playlistName} has been deleted."]', {
        playlistName: props.title
      }),
      icon: ['fas', 'trash'],
    })
  }
}

function enableQuickBookmarkForThisPlaylist() {
  const currentQuickBookmarkTargetPlaylist = quickBookmarkPlaylist.value

  store.dispatch('updateQuickBookmarkTargetPlaylistId', props.id)
  if (currentQuickBookmarkTargetPlaylist != null) {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast["This playlist is now used for quick bookmark instead of {oldPlaylistName}. Click here to undo"]', {
        oldPlaylistName: currentQuickBookmarkTargetPlaylist.playlistName
      }),
      time: 5000,
      action: () => {
        store.dispatch('updateQuickBookmarkTargetPlaylistId', currentQuickBookmarkTargetPlaylist._id)
        showToast({
          message: t('User Playlists.SinglePlaylistView.Toast["Reverted to use {oldPlaylistName} for quick bookmark"]', {
            oldPlaylistName: currentQuickBookmarkTargetPlaylist.playlistName
          }),
          time: 5000,
          icon: ['fas', 'undo'],
        })
      },
      icon: ['fas', 'bookmark'],
    })
  } else {
    showToast({
      message: t('User Playlists.SinglePlaylistView.Toast.This playlist is now used for quick bookmark'),
      icon: ['fas', 'bookmark'],
    })
  }
}

const updateQueryDebounced = debounce((newQuery) => {
  query.value = newQuery
  emit('search-video-query-change', newQuery)
}, 500)

const searchInput = useTemplateRef('searchInput')

/**
 * @param {KeyboardEvent} event
 */
function keyboardShortcutHandler(event) {
  ctrlFHandler(event, searchInput.value)
}

onMounted(() => {
  document.addEventListener('keydown', keyboardShortcutHandler)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', keyboardShortcutHandler)
})

watch(() => props.id, () => {
  exitEditMode()
})

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)
</script>

<style scoped lang="scss" src="./PlaylistInfo.scss" />
