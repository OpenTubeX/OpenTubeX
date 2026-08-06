<template>
  <FtCard
    class="card relative"
    :class="{ hasError, fullscreenChat: fullscreenOverlay }"
    @wheel.stop
  >
    <header
      v-if="fullscreenOverlay"
      class="liveChatDockHeader"
    >
      <h3>
        <FontAwesomeIcon
          class="liveChatDockTitleIcon"
          :icon="['fas', 'message']"
        />
        {{ isReplay ? t('Video.Live Chat Replay') : t('Video.Live Chat') }}
      </h3>
      <div
        ref="liveChatActionsRef"
        class="liveChatDockActions"
        @keydown.esc.stop.prevent="settingsMenuOpen = false"
      >
        <button
          type="button"
          class="liveChatDockAction"
          :class="{ active: settingsMenuOpen }"
          :aria-label="t('Video.Live Chat Settings')"
          :title="t('Video.Live Chat Settings')"
          :aria-expanded="String(settingsMenuOpen)"
          @click="settingsMenuOpen = !settingsMenuOpen"
        >
          <FontAwesomeIcon :icon="['fas', 'sliders-h']" />
        </button>
        <a
          v-if="!isReplay"
          :href="`https://www.youtube.com/live_chat?is_popout=1&v=${props.videoId}`"
          :aria-label="t('Video.Popout Live Chat')"
          :title="t('Video.Popout Live Chat')"
          target="_blank"
          class="liveChatDockAction"
        >
          <FontAwesomeIcon :icon="['fas', 'arrow-up-right-from-square']" />
        </a>
        <button
          type="button"
          class="liveChatDockAction"
          :aria-label="t('Settings.Distraction Free Settings.Hide Live Chat')"
          :title="t('Settings.Distraction Free Settings.Hide Live Chat')"
          @click="emit('close')"
        >
          <FontAwesomeIcon :icon="['fas', 'xmark']" />
        </button>
        <div
          v-if="settingsMenuOpen"
          class="liveChatSettingsMenu"
        >
          <FtToggleSwitch
            :label="t('Video.Show Live Chat Timestamps')"
            :default-value="showLiveChatTimestamps"
            :compact="true"
            @change="updateShowLiveChatTimestamps"
          />
          <FtRadioButton
            v-if="canFilter"
            class="liveChatFilter"
            :title="t('Video.Chat Filter')"
            :labels="[t('Video.Top Chat'), t('Video.All Messages')]"
            :values="['TOP_CHAT', 'LIVE_CHAT']"
            :model-value="liveChatFilter"
            @update:model-value="updateLiveChatFilter"
          />
        </div>
      </div>
    </header>
    <FtLoader
      v-if="isLoading"
    />
    <div
      v-else-if="hasError"
      class="messageContainer"
      :class="{ hasError }"
    >
      <p
        class="message"
      >
        {{ errorMessage }}
      </p>
      <FontAwesomeIcon
        :icon="['fas', 'exclamation-circle']"
        class="errorIcon"
      />
      <FtButton
        v-if="showEnableChat"
        :label="t('Video.Enable Live Chat')"
        class="enableLiveChat"
        @click="enableLiveChat"
      />
    </div>
    <div
      v-else-if="comments.length === 0"
      class="messageContainer liveChatMessage"
    >
      <p
        class="message"
      >
        {{ isReplay
          ? t("Video['Live chat replay is enabled. Chat messages will appear here as the video plays.']")
          : t("Video['Live chat is enabled. Chat messages will appear here once sent.']") }}
      </p>
    </div>
    <div
      v-else
      class="relative"
    >
      <div
        v-if="!fullscreenOverlay"
        class="titleContainer"
      >
        <h4
          class="title"
        >
          {{ isReplay ? t('Video.Live Chat Replay') : t('Video.Live Chat') }}
          <span
            v-if="!hideVideoViews && watchingCount !== null"
            class="watchingCount"
          >
            {{ t('Global.Counts.Watching Count', { count: formattedWatchingCount }, watchingCount) }}
          </span>
        </h4>
        <div
          ref="liveChatActionsRef"
          class="liveChatActions"
          @keydown.esc.stop.prevent="settingsMenuOpen = false"
        >
          <button
            type="button"
            class="liveChatActionButton"
            :class="{ active: settingsMenuOpen }"
            :aria-label="t('Video.Live Chat Settings')"
            :title="t('Video.Live Chat Settings')"
            :aria-expanded="String(settingsMenuOpen)"
            @click="settingsMenuOpen = !settingsMenuOpen"
          >
            <FontAwesomeIcon :icon="['fas', 'sliders-h']" />
          </button>
          <a
            v-if="!isReplay"
            :href="`https://www.youtube.com/live_chat?is_popout=1&v=${props.videoId}`"
            :aria-label="t('Video.Popout Live Chat')"
            :title="t('Video.Popout Live Chat')"
            target="_blank"
            class="liveChatActionButton"
          >
            <FontAwesomeIcon
              :icon="['fas', 'arrow-up-right-from-square']"
            />
          </a>
          <div
            v-if="settingsMenuOpen"
            class="liveChatSettingsMenu"
          >
            <FtToggleSwitch
              :label="t('Video.Show Live Chat Timestamps')"
              :default-value="showLiveChatTimestamps"
              :compact="true"
              @change="updateShowLiveChatTimestamps"
            />
            <FtRadioButton
              v-if="canFilter"
              class="liveChatFilter"
              :title="t('Video.Chat Filter')"
              :labels="[t('Video.Top Chat'), t('Video.All Messages')]"
              :values="['TOP_CHAT', 'LIVE_CHAT']"
              :model-value="liveChatFilter"
              @update:model-value="updateLiveChatFilter"
            />
          </div>
        </div>
      </div>
      <div
        v-if="superChatComments.length > 0"
        v-overlay-scrollbars
        class="superChatComments"
      >
        <div
          v-for="comment in superChatComments"
          :key="comment.id"
          :aria-label="t('Video.Show Super Chat Comment')"
          class="superChat"
          :class="comment.superChat.colorClass"
          role="button"
          tabindex="0"
          @click="showSuperChatComment(comment)"
          @keydown.enter.space.prevent="showSuperChatComment(comment)"
        >
          <img
            :src="comment.author.thumbnailUrl"
            class="channelThumbnail"
            alt=""
          >
          <p
            class="superChatContent"
          >
            <bdi
              class="donationAmount"
            >
              {{ comment.superChat.amount }}
            </bdi>
          </p>
        </div>
      </div>
      <div class="liveChatBody">
        <div
          v-if="showSuperChat"
          class="openedSuperChat"
          :class="superChat.superChat.colorClass"
          role="button"
          tabindex="0"
          @click="hideSuperChat"
          @keydown.enter.space.prevent="hideSuperChat"
        >
          <div
            class="superChatMessage"
            @click.stop.prevent
          >
            <div
              class="upperSuperChatMessage"
            >
              <img
                :src="superChat.author.thumbnailUrl"
                class="channelThumbnail"
                alt=""
              >
              <div class="superChatAuthor">
                <span
                  v-if="showLiveChatTimestamps"
                  class="liveChatTimestamp"
                >
                  {{ superChat.timestampText }}
                </span>
                <RouterLink
                  class="channelName"
                  dir="auto"
                  :to="`/channel/${superChat.author.id}`"
                >
                  {{ superChat.author.name }}
                </RouterLink>
              </div>
              <p
                class="donationAmount"
                dir="auto"
              >
                {{ superChat.superChat.amount }}
              </p>
            </div>
            <p
              v-safer-html="superChat.message"
              class="chatMessage"
              dir="auto"
            />
          </div>
        </div>
        <div
          ref="commentsRef"
          v-overlay-scrollbars
          class="liveChatComments"
          :style="{ blockSize: chatHeight }"
          @pointerdown="stopScrollingToBottom"
          @scroll.passive="onScroll"
          @scrollend="onScrollEnd"
          @wheel.passive="stopScrollingToBottom"
        >
          <TransitionGroup
            name="live-chat-message"
            tag="div"
            class="liveChatCommentList"
            @after-enter="onLiveChatMessageEntered"
          >
            <div
              v-for="comment in comments"
              :key="comment.id"
              class="comment"
              :class="comment.superChat ? `superChatMessage ${comment.superChat.colorClass}` : ''"
            >
              <template
                v-if="comment.superChat"
              >
                <div
                  class="upperSuperChatMessage"
                >
                  <img
                    :src="comment.author.thumbnailUrl"
                    class="channelThumbnail"
                    alt=""
                  >
                  <div class="superChatAuthor">
                    <span
                      v-if="showLiveChatTimestamps"
                      class="liveChatTimestamp"
                    >
                      {{ comment.timestampText }}
                    </span>
                    <RouterLink
                      class="channelName"
                      dir="auto"
                      :to="`/channel/${comment.author.id}`"
                    >
                      {{ comment.author.name }}
                    </RouterLink>
                  </div>
                  <p
                    class="donationAmount"
                    dir="auto"
                  >
                    {{ comment.superChat.amount }}
                  </p>
                </div>
                <p
                  v-if="comment.message"
                  v-safer-html="comment.message"
                  class="chatMessage"
                  dir="auto"
                />
              </template>
              <template
                v-else
              >
                <img
                  :src="comment.author.thumbnailUrl"
                  class="channelThumbnail"
                  alt=""
                >
                <p
                  class="chatContent"
                >
                  <span
                    v-if="showLiveChatTimestamps"
                    class="liveChatTimestamp"
                  >
                    {{ comment.timestampText }}
                  </span>
                  <RouterLink
                    class="channelName"
                    :class="{
                      member: comment.author.isMember,
                      moderator: comment.author.isModerator,
                      owner: comment.author.isOwner
                    }"
                    dir="auto"
                    :to="`/channel/${comment.author.id}`"
                  >
                    {{ comment.author.name }}
                  </RouterLink>
                  <span
                    v-if="comment.author.badge"
                    class="badge"
                  >
                    <img
                      :src="comment.author.badge.url"
                      alt=""
                      :title="comment.author.badge.tooltip"
                      class="badgeImage"
                    >
                  </span>
                  <bdi
                    v-safer-html="comment.message"
                    class="chatMessage"
                  />
                </p>
              </template>
            </div>
          </TransitionGroup>
        </div>
      </div>
      <div
        v-if="showScrollToBottom"
        class="scrollToBottom"
        :aria-label="t('Video.Scroll to Bottom')"
        role="button"
        tabindex="0"
        @click="scrollToBottom()"
        @keydown.enter.space.prevent="scrollToBottom()"
      >
        <FontAwesomeIcon
          class="icon"
          :icon="['fas', 'arrow-down']"
        />
      </div>
    </div>
  </FtCard>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import autolinker from 'autolinker'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowReactive, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { YTNodes } from 'youtubei.js'

import FtLoader from '../FtLoader/FtLoader.vue'
import FtCard from '../ft-card/ft-card.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtRadioButton from '../FtRadioButton/FtRadioButton.vue'
import { vSaferHtml } from '../../directives/vSaferHtml.js'

import store from '../../store/index'

import { formatNumber } from '../../helpers/utils'
import { getRandomColorClass } from '../../helpers/colors'
import { getLocalVideoInfo, parseLocalTextRuns } from '../../helpers/api/local'
import { restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import {
  createCoalescingPoller,
  isReplaySeek,
  parseReplayOffsetMs,
  shouldPrefetchReplay,
  takeDueReplayComments
} from './liveChatReplay.js'

const props = defineProps({
  fullscreenOverlay: {
    type: Boolean,
    default: false
  },
  liveChat: {
    type: EventTarget,
    default: null
  },
  videoId: {
    type: String,
    required: true
  },
  channelId: {
    type: String,
    required: true
  },
  currentTime: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['close'])

const { locale, t } = useI18n()

/** @type {import('youtubei.js').YT.LiveChat|null} */
let liveChatInstance = null
let hasEnded = false
let stayAtBottom = true
let isScrollingToBottom = false
/** @type {ReturnType<typeof setTimeout> | null} */
let scrollToLiveHoldTimer = null

/** Hold auto-follow through the message enter animation (~180ms). */
const SCROLL_TO_LIVE_HOLD_MS = 220

/**
 * Replay messages that were fetched but that the player hasn't reached yet.
 * @type {{ offsetMs: number, comment: any }[]}
 */
let pendingReplayComments = []
let lastCurrentTime = props.currentTime

/**
 * The player position the replay has been fetched up to. Unlike the pending
 * messages this doesn't shrink as messages are shown, so stretches of the stream
 * without any chat activity don't look like an empty buffer.
 */
let replayFetchedUntilMs = 0

/**
 * Tops the replay buffer back up once it no longer reaches far enough ahead of the player.
 */
const requestMoreReplayComments = createCoalescingPoller(async () => {
  if (liveChatInstance === null || !shouldPrefetchReplay(replayFetchedUntilMs, props.currentTime)) {
    return
  }

  await liveChatInstance.pollNext()
})

const isLoading = ref(true)
const isReplay = ref(false)
const canFilter = ref(false)
const hasError = ref(false)
const showEnableChat = ref(false)
const errorMessage = ref('')
const showSuperChat = ref(false)
const showScrollToBottom = ref(false)
const settingsMenuOpen = ref(false)
const liveChatActionsRef = useTemplateRef('liveChatActionsRef')
const comments = shallowReactive([])
const superChatComments = shallowReactive([])
const superChat = ref({
  id: '',
  author: {
    id: '',
    name: '',
    thumbnailUrl: ''
  },
  message: '',
  superChat: {
    amount: '',
    colorClass: ''
  }
})

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => store.getters.getBackendPreference)
/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => store.getters.getBackendFallback)

const chatHeight = computed(() => superChatComments.length > 0 ? '390px' : '445px')

const scrollingBehaviour = computed(() => {
  return store.getters.getDisableSmoothScrolling ? 'auto' : 'smooth'
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideVideoViews = computed(() => store.getters.getHideVideoViews)
const showLiveChatTimestamps = computed(() => store.getters.getShowLiveChatTimestamps)

/** @type {import('vue').ComputedRef<'TOP_CHAT' | 'LIVE_CHAT'>} */
const liveChatFilter = computed(() => store.getters.getLiveChatFilter)

/** @type {import('vue').Ref<number | null>} */
const watchingCount = ref(null)

const formattedWatchingCount = computed(() => {
  return watchingCount.value !== null ? formatNumber(watchingCount.value) : '0'
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleChatSettingsClickOutside, true)
  if (scrollToLiveHoldTimer !== null) {
    clearTimeout(scrollToLiveHoldTimer)
    scrollToLiveHoldTimer = null
  }
  handleEnd()
})

onMounted(() => {
  // Fullscreen docks stop pointer events from bubbling into the player. Capture
  // the event first so clicking another dock can still dismiss this menu.
  document.addEventListener('pointerdown', handleChatSettingsClickOutside, true)
})

if (!process.env.SUPPORTS_LOCAL_API) {
  hasError.value = true
  errorMessage.value = t('Video["Live Chat is currently not supported in this build."]')
  isLoading.value = false
} else {
  switch (backendPreference.value) {
    case 'local':
      if (props.liveChat) {
        liveChatInstance = props.liveChat
        startLiveChatLocal()
      } else {
        showLiveChatUnavailable()
      }
      break
    case 'invidious':
      if (backendFallback.value) {
        getLiveChatLocal()
      } else {
        hasError.value = true
        errorMessage.value = t('Video["Live Chat is currently not supported with the Invidious API. A direct connection to YouTube is required."]')
        showEnableChat.value = true
        isLoading.value = false
      }
      break
  }
}

function enableLiveChat() {
  hasError.value = false
  showEnableChat.value = false
  isLoading.value = true
  getLiveChatLocal()
}

async function getLiveChatLocal() {
  const videoInfo = await getLocalVideoInfo(props.videoId)

  if (videoInfo.livechat) {
    liveChatInstance = videoInfo.getLiveChat()

    startLiveChatLocal()
  } else {
    showLiveChatUnavailable()
  }
}

function showLiveChatUnavailable() {
  hasError.value = true
  errorMessage.value = t('Video["Live Chat is unavailable for this stream. It may have been disabled by the uploader."]')
  isLoading.value = false
  showEnableChat.value = false
}

function startLiveChatLocal() {
  isReplay.value = liveChatInstance.is_replay

  // Replays emit `start` again after every seek, so this can't be a `once` listener.
  liveChatInstance.on('start', handleStart)
  liveChatInstance.on('chat-update', handleChatUpdate)
  liveChatInstance.on('metadata-update', handleMetadataUpdate)
  liveChatInstance.once('error', handleError)
  liveChatInstance.once('end', handleEnd)

  // Videos opened at a saved watch progress start midway through the replay.
  if (isReplay.value && props.currentTime > 0) {
    liveChatInstance.seekTo(props.currentTime * 1000)
  }

  // A component remount (notably Vue HMR in development) can receive the same
  // chat instance after it has already advanced beyond its initial continuation.
  // Restarting that instance resumes polling, but it cannot emit `start` again
  // until a replay seek. Rehydrate from youtubei.js' cached initial payload so
  // loading and the chat filter UI do not wait forever.
  if (liveChatInstance.initial_info) {
    handleStart(liveChatInstance.initial_info)
  }

  liveChatInstance.start()
}

const commentsRef = useTemplateRef('commentsRef')

watch(() => props.fullscreenOverlay, () => {
  // Entering and leaving the dock both change the viewport height; OverlayScrollbars
  // can keep an obsolete end offset and leave the list parked on empty space.
  if (stayAtBottom) {
    scrollToLiveAfterLayout()
  }
})

/**
 * Keep the live edge glued across dock open/close animations and height shares.
 * OverlayScrollbars otherwise restores a stale scrollTop past the content end —
 * empty view until the user scrolls up (same failure mode as the comments dock).
 */
watch(commentsRef, (element, _previous, onCleanup) => {
  if (element == null) {
    return
  }

  const resizeObserver = new ResizeObserver(() => {
    if (!stayAtBottom) {
      return
    }

    scrollToBottom('instant')
  })

  resizeObserver.observe(element)
  onCleanup(() => {
    resizeObserver.disconnect()
  })
}, { flush: 'post' })

/**
 * OverlayScrollbars measures its viewport after Vue renders. Waiting through
 * the following frame ensures both sidebar creation and dock teleporting have
 * their final height before the chat is anchored to the live edge.
 */
function scrollToLiveAfterLayout() {
  nextTick(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollToBottom('instant'))
    })
  })
}

/**
 * @param {import ('youtubei.js/dist/src/parser/continuations').LiveChatContinuation} initialData
 */
function handleStart(initialData) {
  const viewSelector = initialData.header?.view_selector ?? liveChatInstance?.initial_info?.header?.view_selector
  canFilter.value = (viewSelector?.sub_menu_items?.length ?? 0) > 1

  // A chat always starts on YouTube's default view, so switch away from it before
  // showing anything if the other one is the view that is wanted.
  if (canFilter.value && liveChatInstance.filter !== liveChatFilter.value) {
    applyChatFilter()
    return
  }

  for (const action of initialData.actions) {
    handleChatAction(action)
  }

  isLoading.value = false

  if (isReplay.value) {
    releaseReplayComments()
    requestMoreReplayComments()
  }

  scrollToLiveAfterLayout()
}

/**
 * @param {import('youtubei.js/dist/src/parser/youtube/LiveChat').ChatAction} action
 */
function handleChatUpdate(action) {
  if (!hasEnded) {
    handleChatAction(action)
  }
}

/**
 * @param {import('youtubei.js/dist/src/parser/youtube/LiveChat').ChatAction} action
 * @param {number} [offsetMs] the player position this action belongs to, for replays
 */
function handleChatAction(action, offsetMs) {
  if (action.is(YTNodes.ReplayChatItemAction)) {
    const actionOffsetMs = parseReplayOffsetMs(action.video_offset_time_msec)

    replayFetchedUntilMs = Math.max(replayFetchedUntilMs, actionOffsetMs)

    for (const replayedAction of action.actions) {
      handleChatAction(replayedAction, actionOffsetMs)
    }

    return
  }

  if (!action.is(YTNodes.AddChatItemAction)) {
    return
  }

  let comment = null

  if (action.item.is(YTNodes.LiveChatTextMessage)) {
    comment = parseLiveChatComment(action.item)
  } else if (action.item.is(YTNodes.LiveChatPaidMessage)) {
    comment = parseLiveChatSuperChat(action.item)
  }

  if (comment === null) {
    return
  }

  if (offsetMs === undefined) {
    deliverComment(comment)
  } else {
    pendingReplayComments.push({ offsetMs, comment })
  }
}

/**
 * Drops everything on screen, which is what switching to a different part of the
 * video or to a different view of the chat leaves behind.
 */
function clearChat() {
  comments.splice(0, comments.length)
  superChatComments.splice(0, superChatComments.length)
  showSuperChat.value = false
  pendingReplayComments = []
  replayFetchedUntilMs = 0
}

/**
 * Moves the chat onto the currently selected view, keeping a replay at the
 * position the player is at.
 */
function applyChatFilter() {
  if (liveChatInstance === null || !canFilter.value || liveChatInstance.filter === liveChatFilter.value) {
    return
  }

  clearChat()
  liveChatInstance.setFilter(liveChatFilter.value)

  if (isReplay.value) {
    liveChatInstance.seekTo(props.currentTime * 1000)
    requestMoreReplayComments()
  }
}

watch(liveChatFilter, applyChatFilter)

/**
 * Shows every buffered replay message that the player has reached by now.
 */
function releaseReplayComments() {
  for (const { comment } of takeDueReplayComments(pendingReplayComments, props.currentTime)) {
    deliverComment(comment)
  }
}

watch(() => props.currentTime, (currentTime) => {
  if (!isReplay.value || liveChatInstance === null) {
    return
  }

  const seeked = isReplaySeek(lastCurrentTime, currentTime)
  lastCurrentTime = currentTime

  if (seeked) {
    // Everything on screen and in the buffer belongs to the position we just left.
    clearChat()
    liveChatInstance.seekTo(currentTime * 1000)
  } else {
    releaseReplayComments()
  }

  requestMoreReplayComments()
})

/**
 * @param {import('youtubei.js/dist/src/parser/youtube/LiveChat').LiveMetadata} metadata
 */
function handleMetadataUpdate(metadata) {
  if (metadata.views && !isNaN(metadata.views.original_view_count)) {
    watchingCount.value = metadata.views.original_view_count
  }
}

function handleEnd() {
  hasEnded = true

  if (liveChatInstance) {
    liveChatInstance.stop()
    liveChatInstance.off('start', handleStart)
    liveChatInstance.off('chat-update', handleChatUpdate)
    liveChatInstance.off('metadata-update', handleMetadataUpdate)
    liveChatInstance.off('error', handleError)
    liveChatInstance.off('end', handleEnd)
    liveChatInstance = null
  }
}

/**
 * @param {Error} error
 */
function handleError(error) {
  handleEnd()

  console.error(error)
  errorMessage.value = `[${error.name}] ${error.message}`
  hasError.value = true
  isLoading.value = false
}

/**
 * @param {import('youtubei.js').YTNodes.LiveChatTextMessage} comment
 */
function parseLiveChatComment(comment) {
  /** @type {import('youtubei.js').YTNodes.LiveChatAuthorBadge | undefined} */
  const badge = comment.author.badges.find(badge => badge.is(YTNodes.LiveChatAuthorBadge) && badge.custom_thumbnail)

  const parsedComment = {
    id: comment.id,
    timestampText: formatLiveChatTimestamp(comment),
    message: autolinker.link(parseLocalTextRuns(comment.message.runs, 20)),
    author: {
      id: comment.author.id,
      name: comment.author.name,
      thumbnailUrl: comment.author.thumbnails.at(-1).url,
      isOwner: comment.author.id === props.channelId,
      isModerator: comment.author.is_moderator,
      isMember: !!badge
    }
  }

  if (badge) {
    parsedComment.badge = {
      url: badge.custom_thumbnail.at(-1)?.url,
      tooltip: badge.tooltip ?? ''
    }
  }

  return parsedComment
}

/**
 * @param {import('youtubei.js').YTNodes.LiveChatPaidMessage} superChat
 */
function parseLiveChatSuperChat(superChat) {
  const parsedComment = {
    id: superChat.id,
    timestampText: formatLiveChatTimestamp(superChat),
    message: autolinker.link(parseLocalTextRuns(superChat.message.runs, 20)),
    author: {
      id: superChat.author.id,
      name: superChat.author.name.text,
      thumbnailUrl: superChat.author.thumbnails[0].url
    },
    superChat: {
      amount: superChat.purchase_amount,
      colorClass: getRandomColorClass()
    }
  }

  return parsedComment
}

/**
 * Adds a parsed message to the chat. For replays this happens once the player
 * reaches the position the message was sent at, rather than as soon as it is fetched.
 * @param {any} comment
 */
function deliverComment(comment) {
  if (comment.superChat) {
    superChatComments.unshift(comment)

    setTimeout(() => {
      removeFromSuperChat(comment)
    }, 120000)
  }

  pushComment(comment)
}

/**
 * @param {any} comment
 */
function pushComment(comment) {
  const shouldStayAtBottom = stayAtBottom
  comments.push(comment)

  // Trim before re-anchoring so OverlayScrollbars does not restore a scrollTop
  // that pointed past messages that were just removed from the top.
  if (comments.length > 150 && shouldStayAtBottom) {
    comments.splice(0, comments.length - 150)
  }

  if (!isLoading.value && shouldStayAtBottom) {
    nextTick(() => {
      // Smooth scrolling can be interrupted when another message arrives or the
      // tab is backgrounded. An instant follow-up keeps the bottom anchored.
      scrollToBottom('instant')
    })
  }
}

/**
 * @param {any} comment
 */
function removeFromSuperChat(comment) {
  const index = superChatComments.indexOf(comment)

  // Seeking a replay clears the ticker while the removal timeouts are still pending.
  if (index !== -1) {
    superChatComments.splice(index, 1)
  }

  // The ticker chip is gone; don't leave its expanded card floating over chat.
  if (showSuperChat.value && superChat.value.id === comment.id) {
    showSuperChat.value = false
  }
}

/**
 * @param {any} comment
 */
function showSuperChatComment(comment) {
  if (superChat.value.id === comment.id && showSuperChat.value) {
    showSuperChat.value = false
  } else {
    superChat.value = comment
    showSuperChat.value = true
  }
}

function formatLiveChatTimestamp(comment) {
  if (comment.timestamp_text) {
    return comment.timestamp_text
  }

  if (Number.isFinite(comment.timestamp)) {
    return new Intl.DateTimeFormat([locale.value, 'en'], { timeStyle: 'short' }).format(comment.timestamp)
  }

  return ''
}

function handleChatSettingsClickOutside(event) {
  if (settingsMenuOpen.value && !liveChatActionsRef.value?.contains(event.target)) {
    settingsMenuOpen.value = false
  }
}

function updateShowLiveChatTimestamps(value) {
  store.dispatch('updateShowLiveChatTimestamps', value)
}

function updateLiveChatFilter(value) {
  store.dispatch('updateLiveChatFilter', value)
}

function onScroll() {
  const liveChatComments = commentsRef.value
  const isAtBottom = liveChatComments.scrollHeight - liveChatComments.scrollTop - liveChatComments.clientHeight <= 1

  if (isAtBottom) {
    stayAtBottom = true
    // Keep the programmatic follow flag for the enter-animation hold window.
    if (scrollToLiveHoldTimer === null) {
      isScrollingToBottom = false
    }
    showScrollToBottom.value = false
  } else if (!isScrollingToBottom) {
    stayAtBottom = false
    showScrollToBottom.value = liveChatComments.scrollHeight > liveChatComments.clientHeight
  }
}

function onScrollEnd() {
  // Programmatic follow uses a hold timer through the enter animation; don't let
  // an intermediate scrollend drop stayAtBottom early.
  if (scrollToLiveHoldTimer !== null) {
    return
  }

  isScrollingToBottom = false
  onScroll()
}

function stopScrollingToBottom() {
  if (scrollToLiveHoldTimer !== null) {
    clearTimeout(scrollToLiveHoldTimer)
    scrollToLiveHoldTimer = null
  }

  isScrollingToBottom = false
  stayAtBottom = false
}

function hideSuperChat() {
  showSuperChat.value = false
}

/**
 * Enter animation can leave the viewport short of the live edge for a frame;
 * re-pin once the new message has finished sliding in.
 */
function onLiveChatMessageEntered() {
  if (stayAtBottom) {
    scrollToBottom('instant')
  }
}

/**
 * @param {ScrollBehavior | 'instant'} [behavior]
 */
function scrollToBottom(behavior = scrollingBehaviour.value) {
  const liveChatComments = commentsRef.value
  if (!liveChatComments) {
    return
  }

  stayAtBottom = true
  isScrollingToBottom = true
  showScrollToBottom.value = false

  if (scrollToLiveHoldTimer !== null) {
    clearTimeout(scrollToLiveHoldTimer)
    scrollToLiveHoldTimer = null
  }

  const top = liveChatComments.scrollHeight

  if (behavior === 'instant' || behavior === 'auto') {
    // Force OverlayScrollbars to accept the new end offset; a plain scrollTo can
    // lose to its restored pre-teleport / pre-trim position.
    restoreOverlayScrollTop(liveChatComments, top)
    scrollToLiveHoldTimer = setTimeout(() => {
      scrollToLiveHoldTimer = null
      if (commentsRef.value !== liveChatComments) {
        return
      }

      if (stayAtBottom) {
        restoreOverlayScrollTop(liveChatComments, liveChatComments.scrollHeight)
      }

      isScrollingToBottom = false
      onScroll()
    }, SCROLL_TO_LIVE_HOLD_MS)
    return
  }

  liveChatComments.scrollTo({
    top,
    behavior
  })
}

</script>

<style scoped src="./WatchVideoLiveChat.css" />
