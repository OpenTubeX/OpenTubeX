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
        v-if="showSearchAndSort || canFollowByAddress"
        class="controls"
      >
        <!-- Searches the list, and follows the channel at a pasted address -->
        <div class="channelSearch">
          <ft-input
            ref="searchBarChannels"
            input-type="search"
            :label="$t('Channels.Search bar placeholder')"
            :icon="['fas', 'search']"
            :placeholder="canFollowByAddress ? $t('Subscriptions.Platforms.Search Or Paste Channel') : $t('Form Inputs.Search Text Hint')"
            :value="query"
            :show-action-button="canFollowByAddress && queryIsAddress"
            :action-button-label="$t('Subscriptions.Platforms.Add Channel')"
            :force-action-button-icon-name="['fas', 'plus']"
            :disabled="isAdding"
            :maxlength="canFollowByAddress ? null : 255"
            @input="handleQueryChange"
            @click="submitQuery"
            @paste="markQueryPasted"
          />
          <div
            v-if="isAdding"
            class="addChannelProgress"
            role="progressbar"
            :aria-label="$t('Subscriptions.Platforms.Add Channel')"
          />
        </div>
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
          {{ emptyDescription }}
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
              :data-tab-title="entry.name"
            >
              <FtRetryImage
                v-if="entry.thumbnail !== null && !failedThumbnailUrls.has(entry.thumbnail)"
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
                :data-tab-title="entry.name"
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
import { getLocalChannel, getOriginalChannelName, parseLocalChannelHeader } from '../../helpers/api/local'
import { mapConcurrently } from '../../helpers/concurrent-map'
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
/** Failures collected until the next frame, which publishes them together. */
const newFailedThumbnailUrls = new Set()
let failedThumbnailFrame = null
/** Refreshed channel details, saved together instead of once per channel. */
let refreshedChannels = []
let refreshedChannelsTimer = null

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
const hasSubscriptions = computed(() => store.getters.getSubscriptionRootProfile.subscriptions.length > 0)

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
// Read once, so a choice made in another tab doesn't switch this page
const storedPlatform = localStorage.getItem(CHANNELS_PLATFORM_STORAGE_KEY)
const selectedPlatform = computed(() => {
  if (!supportsPlatformFollows) return 'youtube'
  const requested = route.query.platform ?? storedPlatform
  return PLATFORM_VALUES.includes(requested) ? requested : 'youtube'
})
const selectedPlatformName = computed(() => platformNames.value[PLATFORM_VALUES.indexOf(selectedPlatform.value)])

/**
 * @param {string} platform
 */
function changePlatform(platform) {
  localStorage.setItem(CHANNELS_PLATFORM_STORAGE_KEY, platform)
  // From the current text, as a replace for clearing it can still be pending
  const { searchQueryText: _, ...otherQuery } = route.query
  router.replace({
    name: 'subscribedChannels',
    query: { ...otherQuery, platform, ...(query.value === '' ? {} : { searchQueryText: query.value }) }
  })
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

// Rewritten URLs depend only on the backend and instance, so each original is
// rewritten once per configuration rather than on every list update.
const thumbnailURLCache = computed(() => ({
  backend: backendPreference.value,
  instance: currentInvidiousInstanceUrl.value,
  /** @type {Map<string, string | null>} */
  urls: new Map()
}))

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
    // Failed thumbnails are checked while rendering, so a broken image does not
    // sort and rebuild every entry again.
    thumbnail: thumbnailURL(channel.thumbnail),
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

// Channels on other platforms are followed by the address of their page
const canFollowByAddress = computed(() => selectedPlatform.value !== 'youtube')
// Channel names never start like this, so the text isn't searched for
const queryIsAddress = computed(() => /^https?:\/\//i.test(query.value.trim()))

/** @type {import('vue').ComputedRef<ChannelEntry[]>} */
const channelList = computed(() => {
  if (query.value === '' || (canFollowByAddress.value && queryIsAddress.value)) {
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
  return selectedPlatform.value === 'all'
    ? t('Channels.Empty')
    : t('Subscriptions.Platforms.No Platform Channels', { platform: selectedPlatformName.value })
})

const emptyDescription = computed(() => selectedPlatform.value === 'all'
  ? t('Subscriptions.Platforms.Description')
  : t('Subscriptions.Platforms.Platform Description', { platform: selectedPlatformName.value }))

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
  const missingChannels = store.getters.getSubscriptionRootProfile.subscriptions.filter(channel => !orderedIds.has(channel.id))
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
  const cache = thumbnailURLCache.value.urls
  let url = cache.get(originalURL)
  if (url === undefined) {
    url = rewriteThumbnailURL(originalURL)
    cache.set(originalURL, url)
  }
  return url
}

function rewriteThumbnailURL(originalURL) {
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

function handleThumbnailError(channel) {
  const url = thumbnailURL(channel.thumbnail)
  if (url !== null) {
    newFailedThumbnailUrls.add(url)
    failedThumbnailFrame ??= requestAnimationFrame(publishFailedThumbnails)
  }

  updateThumbnail(channel)
}

function publishFailedThumbnails() {
  failedThumbnailFrame = null
  failedThumbnailUrls.value = new Set([...failedThumbnailUrls.value, ...newFailedThumbnailUrls])
  newFailedThumbnailUrls.clear()
}

function saveRefreshedChannels() {
  clearTimeout(refreshedChannelsTimer)
  refreshedChannelsTimer = null
  if (refreshedChannels.length === 0) return
  store.dispatch('batchUpdateSubscriptionDetails', refreshedChannels)
  refreshedChannels = []
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
      // Refreshes are spaced 500 ms apart, so each would otherwise rewrite
      // every profile holding the channel and update all of their getters.
      refreshedChannels.push({
        channelThumbnailUrl,
        channelName: channel.name,
        channelId: channel.id,
        channelHandle
      })
      refreshedChannelsTimer ??= setTimeout(saveRefreshedChannels, 2000)
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
/** Set by a paste, so that the input it causes follows a pasted address */
let queryPasted = false

function markQueryPasted() {
  queryPasted = true
  // A paste that leaves the text unchanged causes no input
  setTimeout(() => { queryPasted = false })
}

let isUnmounted = false

// Some pages save the channel names YouTube translated, while channel feeds
// keep the original ones. The lookups are shared and cached for the session.
const originalNameLookupIds = new Set()
watch([
  displayedChannels,
  () => process.env.SUPPORTS_LOCAL_API && backendPreference.value === 'local' && store.getters.getAvoidTranslation === 'entire_app'
], async ([entries, preferOriginalNames]) => {
  if (!preferOriginalNames) return
  const channels = entries
    .filter(entry => entry.platform === 'youtube' && !originalNameLookupIds.has(entry.key))
    .map(entry => entry.channel)
  if (channels.length === 0) return
  for (const channel of channels) originalNameLookupIds.add(channel.id)

  const updates = []
  await mapConcurrently(channels, 3, async channel => {
    if (isUnmounted) return
    const name = await getOriginalChannelName(channel.id)
    if (name && name !== channel.name) updates.push({ channelId: channel.id, channelName: name })
  })
  store.dispatch('batchUpdateSubscriptionDetails', updates)
}, { immediate: true })

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
      handleQueryChange('')
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

  const pasted = queryPasted
  queryPasted = false
  if (pasted && canFollowByAddress.value && queryIsAddress.value) addChannel(val)
}

/**
 * Enter and the action button follow the channel at an address, the list is
 * searched while typing.
 * @param {string} text
 */
function submitQuery(text) {
  if (canFollowByAddress.value && queryIsAddress.value) addChannel(text)
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
  cancelAnimationFrame(failedThumbnailFrame)
  saveRefreshedChannels()
})

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)

</script>
<style scoped src="./SubscribedChannels.css" />
