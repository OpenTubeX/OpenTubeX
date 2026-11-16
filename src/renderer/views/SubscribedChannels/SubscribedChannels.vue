<template>
  <div ref="channelsContainer">
    <ft-card class="card">
      <div class="heading">
        <h2 class="pageTitle">
          <FtIcon
            :icon="['fas', 'user-check']"
            class="headingIcon"
          />
          {{ $t('Channels.Title') }}
          <span
            v-if="activeChannelEntries.length > 0"
            class="countBadge"
            :title="countLabel"
          >
            <span aria-hidden="true">{{ formattedCount }}</span>
            <span class="visuallyHidden">{{ countLabel }}</span>
          </span>
        </h2>
        <!-- Beside the title, like on the search page, and below it only when it doesn't fit -->
        <FtSelect
          v-if="supportsPlatformFollows"
          class="platformSelect"
          :value="selectedPlatform"
          :select-names="platformNames"
          :select-values="PLATFORM_VALUES"
          :option-icons="PLATFORM_OPTION_ICONS"
          :placeholder="$t('Subscriptions.Platforms.Platform')"
          :icon="['fas', 'globe']"
          @change="changePlatform"
        />
      </div>
      <div
        v-if="showSearchAndSort || selectedPlatform !== 'youtube'"
        class="controls"
      >
        <div
          v-if="selectedPlatform !== 'youtube'"
          class="channelInput"
        >
          <ft-input
            ref="channelInput"
            :label="$t('Subscriptions.Platforms.Add Channel')"
            :placeholder="$t('Subscriptions.Platforms.Channel URL')"
            :icon="['fas', 'link']"
            :show-label="true"
            :show-action-button="true"
            :action-button-label="$t('Subscriptions.Platforms.Add Channel')"
            :force-action-button-icon-name="['fas', 'plus']"
            :disabled="isAdding"
            @click="addChannel"
          />
          <div
            v-if="isAdding"
            class="addChannelProgress"
            role="progressbar"
            :aria-label="$t('Subscriptions.Platforms.Add Channel')"
          />
        </div>
        <ft-input
          v-if="showSearchAndSort"
          ref="searchBarChannels"
          class="channelSearch"
          input-type="search"
          :label="$t('Channels.Search bar placeholder')"
          :icon="['fas', 'search']"
          :placeholder="$t('Form Inputs.Search Text Hint')"
          :value="query"
          :show-action-button="false"
          :maxlength="255"
          @input="handleQueryChange"
        />
        <FtSelect
          v-if="showSearchAndSort"
          class="controlSelect"
          :value="sortBy"
          :select-names="sortByNames"
          :select-values="sortByValues"
          :placeholder="$t('Global.Sort By')"
          :icon="sortByIcon"
          @change="updateSortBy"
        />
      </div>
      <FtSubscriptionGroupBar
        v-if="selectedPlatform === 'youtube' && hasSubscriptions"
        class="groupBar"
        panel-id="subscribedChannelsList"
      />
      <ft-flex-box
        v-if="activeChannelEntries.length === 0"
        class="emptyState"
      >
        <p class="message">
          {{ emptyMessage }}
        </p>
        <p
          v-if="selectedPlatform !== 'youtube'"
          class="description"
        >
          {{ $t('Subscriptions.Platforms.Description') }}
        </p>
      </ft-flex-box>
      <template v-else>
        <!-- Moves only animate while reordering, as the transition measures every card -->
        <component
          :is="canReorder ? TransitionGroup : 'div'"
          id="subscribedChannelsList"
          v-bind="canReorder ? { tag: 'div', name: 'channelMove' } : {}"
          class="channels"
          :role="selectedPlatform === 'youtube' && hasSubscriptionGroups ? 'tabpanel' : null"
        >
          <div
            v-for="entry in displayedChannels"
            :key="entry.key"
            class="channel"
            :class="{ reorderable: canReorder, draggedChannel: draggedChannel?.videoId === entry.key }"
            :draggable="canReorder && !pointerDragging"
            :data-playlist-drag-item="canReorder ? '' : null"
            :data-video-id="canReorder ? entry.key : null"
            @pointerdown.capture="canReorder && startPointerDrag($event, channelDragData(entry.channel))"
            @keydown="canReorder && moveWithKeyboard($event, channelDragData(entry.channel))"
            v-on="canReorder ? channelDragHandlers(entry.channel) : {}"
          >
            <div
              v-if="canReorder"
              class="grabBar"
              role="button"
              tabindex="0"
              :aria-label="$t('User Playlists.Reorder Hint')"
              :title="$t('User Playlists.Reorder Hint')"
              aria-keyshortcuts="ArrowUp ArrowDown Home End"
            >
              <FtIcon
                :icon="['fas', 'grip']"
                aria-hidden="true"
              />
            </div>
            <component
              :is="enableChannelLinks ? 'router-link' : 'span'"
              tabindex="-1"
              class="thumbnailContainer"
              :draggable="canReorder ? 'false' : null"
              :to="entry.route"
            >
              <FtRetryImage
                v-if="entry.thumbnail !== null"
                :fallback-icon="['fas', 'circle-user']"
                class="channelThumbnail"
                :src="entry.thumbnail"
                alt=""
                :draggable="canReorder ? 'false' : null"
                @error.once="entry.platform === 'youtube' && handleThumbnailError(entry.channel)"
              />
              <ft-icon
                v-else
                class="channelThumbnail"
                :icon="['fas', 'circle-user']"
              />
            </component>
            <div class="channelText">
              <component
                :is="enableChannelLinks ? 'router-link' : 'span'"
                class="channelName"
                :tabindex="enableChannelLinks ? null : -1"
                :role="enableChannelLinks ? null : 'group'"
                :aria-label="entry.name"
                dir="auto"
                :title="entry.name"
                :draggable="canReorder ? 'false' : null"
                :to="entry.route"
              >
                {{ entry.name }}
              </component>
              <span
                v-if="entry.handle"
                class="channelHandle"
                dir="auto"
                :title="entry.handle"
              >
                {{ entry.handle }}
              </span>
              <span
                v-if="selectedPlatform === 'all'"
                class="channelPlatform"
              >
                <FtIcon
                  :icon="PLATFORM_OPTION_ICONS[PLATFORM_VALUES.indexOf(entry.platform)] ?? ['fas', 'globe']"
                  aria-hidden="true"
                />
                {{ platformNames[PLATFORM_VALUES.indexOf(entry.platform)] ?? entry.platform }}
              </span>
            </div>
            <div
              v-if="!hideUnsubscribeButton"
              class="unsubscribeContainer"
            >
              <ft-subscribe-button
                v-if="entry.platform === 'youtube'"
                :channel-id="entry.channel.id"
                :channel-name="entry.channel.name"
                :channel-thumbnail="entry.channel.thumbnail"
                :channel-handle="entry.channel.handle"
                :open-dropdown-on-subscribe="false"
              />
              <PlatformFollowButton
                v-else
                :platform="entry.platform"
                :channel-id="entry.channel.id"
              />
            </div>
          </div>
        </component>
        <FtAutoLoadNextPageWrapper
          v-if="hasMoreChannels"
          :key="channelPage"
          @load-next-page="channelPage++"
        >
          <ft-flex-box>
            <FtButton
              :label="$t('Channels.Load More Channels')"
              :icon="['fas', 'arrow-down']"
              background-color="var(--primary-color)"
              text-color="var(--text-with-main-color)"
              @click="loadMoreChannels"
            />
          </ft-flex-box>
        </FtAutoLoadNextPageWrapper>
      </template>
    </ft-card>
  </div>
</template>

<script setup>
import FtRetryImage from '../../components/FtRetryImage.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, onMounted, onBeforeUnmount, ref, watch, useTemplateRef, TransitionGroup } from 'vue'
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from 'vue-router'
import FtAutoLoadNextPageWrapper from '../../components/FtAutoLoadNextPageWrapper.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtInput from '../../components/FtInput/FtInput.vue'
import FtSelect from '../../components/FtSelect/FtSelect.vue'
import FtSubscribeButton from '../../components/FtSubscribeButton/FtSubscribeButton.vue'
import FtSubscriptionGroupBar from '../../components/FtSubscriptionGroupBar/FtSubscriptionGroupBar.vue'
import PlatformFollowButton from '../../components/PlatformFollowButton/PlatformFollowButton.vue'
import { invidiousGetChannelInfo, youtubeImageUrlToInvidious, invidiousImageUrlToInvidious } from '../../helpers/api/invidious'
import { getLocalChannel, parseLocalChannelHeader } from '../../helpers/api/local'
import { useListPagination } from '../../composables/useListPagination'
import { usePlaylistDrag } from '../../composables/usePlaylistDrag'
import { ctrlFHandler, getIconForSortPreference, showToast, throttle } from '../../helpers/utils'
import {
  followChannelByUrl,
  getFollowedChannels,
  PlatformChannelInputError,
  supportsPlatformFollows
} from '../../helpers/platformFeed'
import { getPlatformChannelKey, getPlatformChannelRoute, PLATFORM_ICONS, PLATFORMS } from '../../../platforms/index'
import {
  SUBSCRIBED_CHANNELS_SORT_BY_OPTIONS as SORT_BY_OPTIONS,
  sortSubscribedChannels
} from '../../helpers/subscription-groups'
import { moveItemByVisibleOffset } from '../../../orderedItems'
import { useI18n } from 'vue-i18n'
import store from '../../store/index'

const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()

const re = {
  url: /(.+=\w)\d+(.+)/,
  ivToYt: /^.+ggpht\/(.+)/
}
const ytBaseURL = 'https://yt3.ggpht.com'
const thumbnailSize = 176
const channelsPerPage = 50
const channelsContainer = useTemplateRef('channelsContainer')
let errorCount = 0
/** @type {Set<ReturnType<typeof setTimeout>>} */
const thumbnailRetryTimers = new Set()
/** @type {Set<string>} */
const pendingThumbnailChannelIds = new Set()

const query = ref('')
const failedThumbnailUrls = ref(new Set())

const searchBarChannels = useTemplateRef('searchBarChannels')

/** @type {import('vue').ComputedRef<object>} */
const activeProfile = computed(() => {
  return store.getters.getActiveProfile
})

/** @type {import('vue').ComputedRef<string>} */
const activeProfileId = computed(() => {
  return activeProfile.value._id
})

/** @type {import('vue').ComputedRef<Array>} */
const activeProfileSubscriptions = computed(() => {
  return activeProfile.value.subscriptions
})

const hasSubscriptionGroups = computed(() => store.getters.getSubscriptionGroupList.length > 0)

// Groups can hold any subscription, even while the active profile is empty.
// The all channels profile is always the first profile in the array
const hasSubscriptions = computed(() => store.getters.getProfileList[0].subscriptions.length > 0)

/** @type {import('vue').ComputedRef<string | null>} */
const activeGroupId = computed(() => {
  return store.getters.getActiveSubscriptionGroup?.id ?? null
})

/** @type {import('vue').ComputedRef<Array>} */
const activeSubscriptionList = computed(() => {
  return store.getters.getActiveGroupSubscriptions
})

const CHANNELS_PLATFORM_STORAGE_KEY = 'channelsPlatform'
const PLATFORM_VALUES = ['all', 'youtube', ...PLATFORMS.map(platform => platform.id)]
const PLATFORM_OPTION_ICONS = [['fas', 'globe'], ['fab', 'youtube'], ...PLATFORMS.map(platform => PLATFORM_ICONS[platform.id])]
const platformNames = computed(() => [
  t('Subscriptions.Platforms.All Platforms'),
  'YouTube',
  ...PLATFORMS.map(platform => platform.name)
])

// The last platform shown stays selected for later visits, like on the search page
/** @type {import('vue').ComputedRef<string>} */
const selectedPlatform = computed(() => {
  if (!supportsPlatformFollows) return 'youtube'
  const requested = route.query.platform ?? localStorage.getItem(CHANNELS_PLATFORM_STORAGE_KEY)
  return PLATFORM_VALUES.includes(requested) ? requested : 'youtube'
})

/**
 * @param {string} platform
 */
function changePlatform(platform) {
  localStorage.setItem(CHANNELS_PLATFORM_STORAGE_KEY, platform)
  router.replace({ name: 'subscribedChannels', query: { ...route.query, platform } })
}

const SORT_BY_VALUES = Object.values(SORT_BY_OPTIONS)
// Only YouTube subscriptions have a custom order
const sortByValues = computed(() => selectedPlatform.value === 'youtube'
  ? SORT_BY_VALUES
  : SORT_BY_VALUES.filter(value => value !== SORT_BY_OPTIONS.Custom))

const sortByNames = computed(() => [
  t('User Playlists.Sort By.NameAscending'),
  t('User Playlists.Sort By.NameDescending'),
  t('Playlist.Sort By.Custom')
].slice(0, sortByValues.value.length))

/** @type {import('vue').ComputedRef<'name_ascending' | 'name_descending' | 'custom'>} */
const sortBy = computed(() => {
  const value = store.getters.getSubscribedChannelsSortBy
  return sortByValues.value.includes(value) ? value : SORT_BY_OPTIONS.NameAscending
})

const sortByIcon = computed(() => getIconForSortPreference(sortBy.value))

function updateSortBy(value) {
  store.dispatch('updateSubscribedChannelsSortBy', value)
}

const collator = computed(() => new Intl.Collator([locale.value, 'en'], { sensitivity: 'base', numeric: true }))

/** @type {import('vue').Ref<string[] | null>} Order shown while dragging, saved on drop */
const tempCustomOrder = ref(null)

// The entries resolve thumbnails while the list paginates during setup
/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => {
  return store.getters.getCurrentInvidiousInstanceUrl
})

/**
 * @typedef {object} ChannelEntry
 * @property {string} key
 * @property {string} platform `youtube` or the ID of another platform
 * @property {{ id: string, name: string, handle?: string, thumbnail?: string }} channel
 * @property {string} name
 * @property {string | null} handle
 * @property {string | null} thumbnail
 * @property {string | import('vue-router').RouteLocationRaw} route
 */

/**
 * @param {{ id: string, name: string, handle?: string, thumbnail?: string }} channel
 * @returns {ChannelEntry}
 */
function youtubeEntry(channel) {
  return {
    key: channel.id,
    platform: 'youtube',
    channel,
    name: channel.name,
    handle: typeof channel.handle === 'string' ? channel.handle : null,
    thumbnail: hasUsableThumbnail(channel.thumbnail) ? thumbnailURL(channel.thumbnail) : null,
    route: `/channel/${channel.id}`
  }
}

/**
 * @param {import('../../helpers/platformFeed').FollowedChannel} channel
 * @returns {ChannelEntry}
 */
function platformEntry(channel) {
  return {
    key: getPlatformChannelKey(channel),
    platform: channel.platform,
    channel,
    name: channel.name,
    handle: null,
    thumbnail: channel.avatar || null,
    route: getPlatformChannelRoute(channel.platform, channel.id)
  }
}

/**
 * The channels of the selected platform, before searching. Groups only hold
 * YouTube subscriptions, so the other views list the whole profile.
 * @type {import('vue').ComputedRef<ChannelEntry[]>}
 */
const activeChannelEntries = computed(() => {
  if (selectedPlatform.value === 'youtube') {
    return sortSubscribedChannels(
      activeSubscriptionList.value,
      sortBy.value,
      tempCustomOrder.value ?? store.getters.getSubscribedChannelsCustomOrderList,
      collator.value
    ).map(youtubeEntry)
  }

  const followed = getFollowedChannels()
    .filter(channel => selectedPlatform.value === 'all' || channel.platform === selectedPlatform.value)
    .map(platformEntry)
  const entries = selectedPlatform.value === 'all'
    ? [...activeProfileSubscriptions.value.map(youtubeEntry), ...followed]
    : followed
  return sortSubscribedChannels(entries, sortBy.value, [], collator.value)
})

const showSearchAndSort = computed(() => activeChannelEntries.value.length > 1 || query.value !== '')

/** @type {import('vue').ComputedRef<ChannelEntry[]>} */
const channelList = computed(() => {
  if (query.value === '') {
    return activeChannelEntries.value
  }

  const escapedQuery = query.value.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&')
  const re = new RegExp(escapedQuery, 'i')
  return activeChannelEntries.value.filter(entry => {
    return re.test(entry.name) || (entry.handle !== null && re.test(entry.handle))
  })
})

const formattedCount = computed(() => new Intl.NumberFormat([locale.value, 'en']).format(channelList.value.length))
const countLabel = computed(() => t('Channels.Count', { number: formattedCount.value }, channelList.value.length))

const emptyMessage = computed(() => {
  if (selectedPlatform.value === 'youtube') {
    return activeProfileSubscriptions.value.length === 0 ? t('Channels.Empty') : t('Subscription Groups.Empty Group')
  }
  return selectedPlatform.value === 'all' ? t('Channels.Empty') : t('Subscriptions.Platforms.No Channels')
})

const { page: channelPage, displayedItems: displayedChannels, hasMore: hasMoreChannels, loadMore: loadMoreChannels } = useListPagination(channelList, {
  pageSize: channelsPerPage,
  append: true,
  resetOn: [query, activeProfileId, activeGroupId, selectedPlatform],
  focusItem: index => channelsContainer.value?.querySelectorAll('.channel')[index]?.querySelector('.channelName')?.focus()
})

const canReorder = computed(() => selectedPlatform.value === 'youtube' && sortBy.value === SORT_BY_OPTIONS.Custom && query.value === '')

/** @type {import('vue').Ref<import('../../helpers/dragAndDrop').VideoData | null>} */
const draggedChannel = ref(null)

// The playlist drag events name the dragged item a video, here it's a channel.
const { dragVideo, moveDraggedVideo, afterDrag, pointerDragging, startPointerDrag, moveWithKeyboard } = usePlaylistDrag((event, ...args) => {
  switch (event) {
    case 'drag-video':
      draggedChannel.value = args[0]
      break
    case 'move-dragged-video':
      onMoveDraggedChannel(args[0], args[1])
      break
    case 'drag-video-end':
      onDragChannelEnd()
      break
    case 'move-video-up':
      moveChannel(args[0], index => index - 1)
      break
    case 'move-video-down':
      moveChannel(args[0], index => index + 1)
      break
    case 'move-video-to-the-top':
      moveChannel(args[0], () => 0)
      break
    case 'move-video-to-the-bottom':
      moveChannel(args[0], (_index, lastIndex) => lastIndex)
      break
  }
})

/** @param {{ id: string }} channel */
function channelDragData(channel) {
  return { videoId: channel.id, playlistItemId: null }
}

/** @param {{ id: string }} channel */
function channelDragHandlers(channel) {
  const channelData = channelDragData(channel)
  return {
    dragstart: (event) => {
      // Links and images start their own drags, only the card itself reorders
      if (event.target === event.currentTarget) dragVideo(event, channelData)
    },
    dragover: event => event.preventDefault(),
    dragenter: () => {
      if (draggedChannel.value === null) return
      // Coming back to the dragged card allows moving onto the previous target again
      if (channel.id === draggedChannel.value.videoId) lastNativeDragTargetId = null
      moveDraggedVideo(channelData, draggedChannel.value)
    },
    dragend: afterDrag
  }
}

/**
 * The saved order plus any channels missing from it, so moving a channel
 * within a group or profile keeps the position of every other channel.
 * @returns {string[]}
 */
function getFullCustomOrder() {
  const order = tempCustomOrder.value ?? store.getters.getSubscribedChannelsCustomOrderList
  const orderedIds = new Set(order)
  // The all channels profile is always the first profile in the array
  const missingChannels = store.getters.getProfileList[0].subscriptions.filter(channel => !orderedIds.has(channel.id))
  return [
    ...order,
    ...sortSubscribedChannels(missingChannels, SORT_BY_OPTIONS.NameAscending, [], collator.value).map(channel => channel.id)
  ]
}

/**
 * @param {string} channelId
 * @param {(index: number, lastIndex: number) => number} getTargetIndex
 */
async function moveChannel(channelId, getTargetIndex) {
  const visibleIds = channelList.value.map(entry => entry.key)
  const index = visibleIds.indexOf(channelId)
  const targetIndex = getTargetIndex(index, visibleIds.length - 1)
  if (index === -1 || targetIndex === index || targetIndex < 0 || targetIndex >= visibleIds.length) return

  const order = moveItemByVisibleOffset(getFullCustomOrder(), visibleIds, channelId, targetIndex - index)
  // Keep the moved channel rendered, so its handle keeps focus past the loaded page.
  channelPage.value = Math.max(channelPage.value, Math.floor(targetIndex / channelsPerPage))
  // Show the move before the setting is saved, so repeated keys build on it.
  tempCustomOrder.value = order
  await store.dispatch('updateSubscribedChannelsCustomOrder', order)
  if (tempCustomOrder.value === order) tempCustomOrder.value = null
}

/**
 * @param {import('../../helpers/dragAndDrop').VideoData} target
 * @param {import('../../helpers/dragAndDrop').VideoData} source
 */
function moveDraggedChannelTemporarily(target, source) {
  pendingNativeDragMove = null
  // The cards glide after a move, so the cursor can enter the same target again.
  // Moving onto it twice would undo the first move. Pointer drags track this themselves.
  if (!source.pointerDragging && target.videoId === lastNativeDragTargetId) return
  const ids = getFullCustomOrder()
  const targetIndex = ids.indexOf(target.videoId)
  const sourceIndex = ids.indexOf(source.videoId)
  if (targetIndex === -1 || sourceIndex === -1) return

  ids.splice(sourceIndex, 1)
  ids.splice(targetIndex, 0, source.videoId)
  tempCustomOrder.value = ids
  lastNativeDragTargetId = target.videoId
}

/** @type {string | null} Channel the natively dragged card last moved onto */
let lastNativeDragTargetId = null

/** @type {Parameters<typeof moveDraggedChannelTemporarily> | null} Latest native target skipped by the throttle */
let pendingNativeDragMove = null

// Native drags fire repeatedly while cards animate, so wait between moves. The
// cursor can stop on a target skipped by the wait, so show that one afterwards.
const moveDraggedChannelTemporarilyThrottled = throttle((target, source) => {
  moveDraggedChannelTemporarily(target, source)
  const drag = draggedChannel.value
  setTimeout(() => {
    if (draggedChannel.value === drag && pendingNativeDragMove !== null) {
      moveDraggedChannelTemporarily(...pendingNativeDragMove)
    }
  }, 100)
}, 100)

/**
 * @param {import('../../helpers/dragAndDrop').VideoData} target
 * @param {import('../../helpers/dragAndDrop').VideoData} source
 */
function onMoveDraggedChannel(target, source) {
  // Pointer drags already wait for transitions and flush their final target.
  if (source.pointerDragging) {
    moveDraggedChannelTemporarily(target, source)
  } else {
    pendingNativeDragMove = [target, source]
    moveDraggedChannelTemporarilyThrottled(target, source)
  }
}

async function onDragChannelEnd() {
  if (pendingNativeDragMove != null) moveDraggedChannelTemporarily(...pendingNativeDragMove)
  lastNativeDragTargetId = null
  draggedChannel.value = null
  if (tempCustomOrder.value != null) {
    const order = tempCustomOrder.value
    await store.dispatch('updateSubscribedChannelsCustomOrder', order)
    if (tempCustomOrder.value === order) tempCustomOrder.value = null
  }
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideUnsubscribeButton = computed(() => {
  return store.getters.getHideUnsubscribeButton
})

function thumbnailURL(originalURL) {
  // Imported subscriptions can carry anything here, including non-strings.
  if (typeof originalURL !== 'string' || originalURL === '') { return null }
  let newURL = originalURL
  // Sometimes relative protocol URLs are passed in
  if (originalURL.startsWith('//')) {
    newURL = `https:${originalURL}`
  }
  // Subscriptions imported from other apps can carry an unusable thumbnail,
  // which used to throw here and take the whole page render down with it.
  let hostname
  try {
    hostname = new URL(newURL).hostname
  } catch {
    return null
  }
  if (hostname === 'yt3.ggpht.com' || hostname === 'yt3.googleusercontent.com') {
    if (backendPreference.value === 'invidious') { // YT to IV
      newURL = youtubeImageUrlToInvidious(newURL, currentInvidiousInstanceUrl.value)
    }
  } else {
    if (backendPreference.value === 'local') { // IV to YT
      newURL = newURL.replace(re.ivToYt, `${ytBaseURL}/$1`)
    } else { // IV to IV
      newURL = invidiousImageUrlToInvidious(newURL, currentInvidiousInstanceUrl.value)
    }
  }

  return newURL.replace(re.url, `$1${thumbnailSize}$2`)
}

function hasUsableThumbnail(originalURL) {
  const url = thumbnailURL(originalURL)
  return url !== null && !failedThumbnailUrls.value.has(url)
}

function handleThumbnailError(channel) {
  const url = thumbnailURL(channel.thumbnail)
  if (url !== null) {
    failedThumbnailUrls.value = new Set(failedThumbnailUrls.value).add(url)
  }

  updateThumbnail(channel)
}

function updateThumbnail(channel) {
  // Re-rendering the list (filtering, profile switch) fires the image error
  // again; one refresh per channel is enough.
  if (pendingThumbnailChannelIds.has(channel.id)) return
  pendingThumbnailChannelIds.add(channel.id)

  errorCount += 1
  // avoid too many concurrent requests
  const timer = setTimeout(async () => {
    thumbnailRetryTimers.delete(timer)
    try {
      let channelThumbnailUrl
      let channelHandle
      if (backendPreference.value === 'local') {
        const response = await getLocalChannel(channel.id)
        if (response.alert) return
        const header = parseLocalChannelHeader(response)
        channelThumbnailUrl = thumbnailURL(header.thumbnailUrl)
        channelHandle = header.handle
      } else {
        const response = await invidiousGetChannelInfo(channel.id)
        // Yattee servers can return channels without avatars
        if (response.authorThumbnails.length === 0) return
        channelThumbnailUrl = thumbnailURL(response.authorThumbnails[0].url)
      }
      store.dispatch('updateSubscriptionDetails', {
        channelThumbnailUrl,
        channelName: channel.name,
        channelId: channel.id,
        channelHandle
      })
    } catch (error) {
      console.error('Failed to refresh the channel thumbnail', channel.id, error)
    } finally {
      pendingThumbnailChannelIds.delete(channel.id)
      // Space out the next burst from zero instead of growing the delay forever.
      if (pendingThumbnailChannelIds.size === 0) errorCount = 0
    }
  }, errorCount * 500)
  thumbnailRetryTimers.add(timer)
}

const isAdding = ref(false)
const channelInput = useTemplateRef('channelInput')
let isUnmounted = false

/**
 * @param {string} message
 */
function showError(message) {
  showToast({ message, icon: ['fas', 'circle-exclamation'] })
}

/**
 * Follows the channel at an address on another platform.
 * @param {string} text
 */
async function addChannel(text) {
  if (isAdding.value) return
  isAdding.value = true
  try {
    const result = await followChannelByUrl(text)
    if (result === null) {
      showError(t('Subscriptions.Platforms.Channel Not Found'))
    } else if (!result.followed) {
      showError(t('Subscriptions.Platforms.Channel Already Followed'))
    } else if (!isUnmounted) {
      // The follow is saved either way, but the page must not navigate after it's left
      channelInput.value?.clear()
      // Shows the new channel when it's on another platform than the selected one
      if (selectedPlatform.value !== 'all' && selectedPlatform.value !== result.channel.platform) {
        changePlatform(result.channel.platform)
      }
    }
  } catch (error) {
    if (!(error instanceof PlatformChannelInputError)) console.error('Failed to follow the channel', error)
    showError(error instanceof PlatformChannelInputError
      ? t('Subscriptions.Platforms.Invalid Channel')
      : t('Subscriptions.Platforms.Channel Could Not Be Loaded'))
  } finally {
    isAdding.value = false
  }
}

function handleQueryChange(val) {
  query.value = val

  saveStateInRouter(val)
}

async function saveStateInRouter(query) {
  const { searchQueryText: _, ...otherQuery } = route.query
  await router.replace({
    name: 'subscribedChannels',
    query: query === '' ? otherQuery : { ...otherQuery, searchQueryText: query },
  }).catch(failure => {
    if (isNavigationFailure(failure, NavigationFailureType.duplicated)) {
      return
    }

    throw failure
  })
}

function keyboardShortcutHandler(event) {
  ctrlFHandler(event, searchBarChannels.value)
}

watch(activeProfileId, () => {
  query.value = ''
})

// region created

const rawQuery = route.query.searchQueryText
const oldQuery = Array.isArray(rawQuery) ? rawQuery[0] ?? '' : rawQuery ?? ''
if (oldQuery !== '') {
  handleQueryChange(oldQuery)
}

// endregion created

onMounted(() => {
  document.addEventListener('keydown', keyboardShortcutHandler)
})

onBeforeUnmount(() => {
  isUnmounted = true
  document.removeEventListener('keydown', keyboardShortcutHandler)
  // Pending refreshes would otherwise keep fetching channel pages after leaving.
  for (const timer of thumbnailRetryTimers) clearTimeout(timer)
  thumbnailRetryTimers.clear()
  pendingThumbnailChannelIds.clear()
})

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)

</script>
<style scoped src="./SubscribedChannels.css" />
