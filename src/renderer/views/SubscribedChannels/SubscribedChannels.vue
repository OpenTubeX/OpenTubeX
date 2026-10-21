<template>
  <div>
    <ft-card class="card">
      <div class="heading">
        <h2>
          <FtIcon
            :icon="['fas', 'user-check']"
            class="headingIcon"
          />
          {{ $t('Channels.Title') }}
        </h2>
      </div>
      <div
        v-if="activeProfileSubscriptions.length > 0"
        class="controls"
      >
        <ft-input
          v-show="activeProfileSubscriptions.length > 1"
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
          v-if="activeProfileSubscriptions.length > 1"
          class="sortSelect"
          :value="sortBy"
          :select-names="sortByNames"
          :select-values="SORT_BY_VALUES"
          :placeholder="$t('Global.Sort By')"
          :icon="sortByIcon"
          @change="updateSortBy"
        />
      </div>
      <FtSubscriptionGroupBar
        v-if="hasSubscriptions"
        class="groupBar"
        panel-id="subscribedChannelsList"
      />
      <ft-flex-box
        v-if="activeSubscriptionList.length === 0"
      >
        <p class="message">
          {{ activeProfileSubscriptions.length === 0 ? $t('Channels.Empty') : $t('Subscription Groups.Empty Group') }}
        </p>
      </ft-flex-box>
      <template v-else>
        <ft-flex-box class="count">
          {{ $t('Channels.Count', { number: channelList.length }, channelList.length) }}
        </ft-flex-box>
        <!-- Moves only animate while reordering, as the transition measures every card -->
        <component
          :is="canReorder ? TransitionGroup : 'div'"
          id="subscribedChannelsList"
          v-bind="canReorder ? { tag: 'div', name: 'channelMove' } : {}"
          class="channels"
          :role="hasSubscriptionGroups ? 'tabpanel' : null"
        >
          <div
            v-for="channel in displayedChannels"
            :key="channel.id"
            class="channel"
            :class="{ reorderable: canReorder, draggedChannel: draggedChannel?.videoId === channel.id }"
            :draggable="canReorder && !pointerDragging"
            :data-playlist-drag-item="canReorder ? '' : null"
            :data-video-id="channel.id"
            @pointerdown.capture="canReorder && startPointerDrag($event, channelDragData(channel))"
            @keydown="canReorder && moveWithKeyboard($event, channelDragData(channel))"
            v-on="canReorder ? channelDragHandlers(channel) : {}"
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
              :to="`/channel/${channel.id}`"
            >
              <FtRetryImage
                v-if="hasUsableThumbnail(channel.thumbnail)"
                :fallback-icon="['fas', 'circle-user']"
                class="channelThumbnail"
                :src="thumbnailURL(channel.thumbnail)"
                alt=""
                :draggable="canReorder ? 'false' : null"
                @error.once="handleThumbnailError(channel)"
              />
              <ft-icon
                v-else
                class="channelThumbnail"
                :icon="['fas', 'circle-user']"
              />
            </component>
            <component
              :is="enableChannelLinks ? 'router-link' : 'span'"
              class="channelName"
              dir="auto"
              :title="channel.name"
              :draggable="canReorder ? 'false' : null"
              :to="`/channel/${channel.id}`"
            >
              {{ channel.name }}
            </component>
            <div
              v-if="!hideUnsubscribeButton"
              class="unsubscribeContainer"
            >
              <ft-subscribe-button
                :channel-id="channel.id"
                :channel-name="channel.name"
                :channel-thumbnail="channel.thumbnail"
                :open-dropdown-on-subscribe="false"
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
              @click="channelPage++"
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
import { invidiousGetChannelInfo, youtubeImageUrlToInvidious, invidiousImageUrlToInvidious } from '../../helpers/api/invidious'
import { getLocalChannel, parseLocalChannelHeader } from '../../helpers/api/local'
import { useListPagination } from '../../composables/useListPagination'
import { usePlaylistDrag } from '../../composables/usePlaylistDrag'
import { ctrlFHandler, getIconForSortPreference, throttle } from '../../helpers/utils'
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

const SORT_BY_VALUES = Object.values(SORT_BY_OPTIONS)

const sortByNames = computed(() => [
  t('User Playlists.Sort By.NameAscending'),
  t('User Playlists.Sort By.NameDescending'),
  t('Playlist.Sort By.Custom')
])

/** @type {import('vue').ComputedRef<'name_ascending' | 'name_descending' | 'custom'>} */
const sortBy = computed(() => {
  const value = store.getters.getSubscribedChannelsSortBy
  return SORT_BY_VALUES.includes(value) ? value : SORT_BY_OPTIONS.NameAscending
})

const sortByIcon = computed(() => getIconForSortPreference(sortBy.value))

function updateSortBy(value) {
  store.dispatch('updateSubscribedChannelsSortBy', value)
}

const collator = computed(() => new Intl.Collator([locale.value, 'en'], { sensitivity: 'base', numeric: true }))

/** @type {import('vue').Ref<string[] | null>} Order shown while dragging, saved on drop */
const tempCustomOrder = ref(null)

/** @type {import('vue').ComputedRef<Array>} */
const subscribedChannels = computed(() => {
  return sortSubscribedChannels(
    activeSubscriptionList.value,
    sortBy.value,
    tempCustomOrder.value ?? store.getters.getSubscribedChannelsCustomOrderList,
    collator.value
  )
})

/** @type {import('vue').ComputedRef<Array>} */
const channelList = computed(() => {
  if (query.value === '') {
    return subscribedChannels.value
  }

  const escapedQuery = query.value.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&')
  const re = new RegExp(escapedQuery, 'i')
  return subscribedChannels.value.filter(channel => {
    return re.test(channel.name)
  })
})

const { page: channelPage, displayedItems: displayedChannels, hasMore: hasMoreChannels } = useListPagination(channelList, {
  pageSize: channelsPerPage,
  append: true,
  resetOn: [query, activeProfileId, activeGroupId]
})

const canReorder = computed(() => sortBy.value === SORT_BY_OPTIONS.Custom && query.value === '')

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
  const visibleIds = channelList.value.map(channel => channel.id)
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

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => {
  return store.getters.getCurrentInvidiousInstanceUrl
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
      if (backendPreference.value === 'local') {
        const response = await getLocalChannel(channel.id)
        if (response.alert) return
        channelThumbnailUrl = thumbnailURL(parseLocalChannelHeader(response).thumbnailUrl)
      } else {
        const response = await invidiousGetChannelInfo(channel.id)
        channelThumbnailUrl = thumbnailURL(response.authorThumbnails[0].url)
      }
      store.dispatch('updateSubscriptionDetails', {
        channelThumbnailUrl,
        channelName: channel.name,
        channelId: channel.id
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

function handleQueryChange(val) {
  query.value = val

  saveStateInRouter(val)
}

async function saveStateInRouter(query) {
  if (query === '') {
    await router.replace({ name: 'subscribedChannels' }).catch(failure => {
      if (isNavigationFailure(failure, NavigationFailureType.duplicated)) {
        return
      }

      throw failure
    })
    return
  }

  await router.replace({
    name: 'subscribedChannels',
    query: { searchQueryText: query },
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
  document.removeEventListener('keydown', keyboardShortcutHandler)
  // Pending refreshes would otherwise keep fetching channel pages after leaving.
  for (const timer of thumbnailRetryTimers) clearTimeout(timer)
  thumbnailRetryTimers.clear()
  pendingThumbnailChannelIds.clear()
})

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)

</script>
<style scoped src="./SubscribedChannels.css" />
