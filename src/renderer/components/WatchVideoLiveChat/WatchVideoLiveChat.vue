<template>
  <FtCard
    class="card relative"
    :class="{ hasError }"
  >
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
        {{ t("Video['Live chat is enabled. Chat messages will appear here once sent.']") }}
      </p>
    </div>
    <div
      v-else
      class="relative"
    >
      <div
        class="titleContainer"
      >
        <h4
          class="title"
        >
          {{ t("Video.Live Chat") }}
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowReactive, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { YTNodes } from 'youtubei.js'

import FtLoader from '../FtLoader/FtLoader.vue'
import FtCard from '../ft-card/ft-card.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import { vSaferHtml } from '../../directives/vSaferHtml.js'

import store from '../../store/index'

import { formatNumber } from '../../helpers/utils'
import { getRandomColorClass } from '../../helpers/colors'
import { getLocalVideoInfo, parseLocalTextRuns } from '../../helpers/api/local'

const props = defineProps({
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
  }
})

const { locale, t } = useI18n()

/** @type {import('youtubei.js').YT.LiveChat|null} */
let liveChatInstance = null
let hasEnded = false
let stayAtBottom = true
let isScrollingToBottom = false

const isLoading = ref(true)
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

/** @type {import('vue').Ref<number | null>} */
const watchingCount = ref(null)

const formattedWatchingCount = computed(() => {
  return watchingCount.value !== null ? formatNumber(watchingCount.value) : '0'
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleChatSettingsClickOutside)
  handleEnd()
})

onMounted(() => {
  document.addEventListener('pointerdown', handleChatSettingsClickOutside)
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
  liveChatInstance.once('start', handleStart)
  liveChatInstance.on('chat-update', handleChatUpdate)
  liveChatInstance.on('metadata-update', handleMetadataUpdate)
  liveChatInstance.once('error', handleError)
  liveChatInstance.once('end', handleEnd)

  liveChatInstance.start()
}

const commentsRef = useTemplateRef('commentsRef')

/**
 * @param {import ('youtubei.js/dist/src/parser/continuations').LiveChatContinuation} initialData
 */
function handleStart(initialData) {
  const actions = initialData.actions.filterType(YTNodes.AddChatItemAction)

  for (const { item } of actions) {
    if (item.is(YTNodes.LiveChatTextMessage)) {
      parseLiveChatComment(item)
    } else if (item.is(YTNodes.LiveChatPaidMessage)) {
      parseLiveChatSuperChat(item)
    }
  }

  isLoading.value = false

  nextTick(() => {
    scrollToBottom('instant')
  })
}

/**
 * @param {import('youtubei.js/dist/src/parser/youtube/LiveChat').ChatAction} action
 */
function handleChatUpdate(action) {
  if (!hasEnded && action.is(YTNodes.AddChatItemAction)) {
    if (action.item.is(YTNodes.LiveChatTextMessage)) {
      parseLiveChatComment(action.item)
    } else if (action.item.is(YTNodes.LiveChatPaidMessage)) {
      parseLiveChatSuperChat(action.item)
    }
  }
}

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

  pushComment(parsedComment)
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

  superChatComments.unshift(parsedComment)

  setTimeout(() => {
    removeFromSuperChat(parsedComment)
  }, 120000)

  pushComment(parsedComment)
}

/**
 * @param {any} comment
 */
function pushComment(comment) {
  comments.push(comment)

  if (!isLoading.value && stayAtBottom) {
    nextTick(() => {
      scrollToBottom()
    })
  }

  if (comments.length > 150 && stayAtBottom) {
    comments.splice(0, comments.length - 150)
  }
}

/**
 * @param {any} comment
 */
function removeFromSuperChat(comment) {
  const index = superChatComments.indexOf(comment)

  superChatComments.splice(index, 1)
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

function onScroll() {
  const liveChatComments = commentsRef.value
  const isAtBottom = liveChatComments.scrollHeight - liveChatComments.scrollTop - liveChatComments.clientHeight <= 1

  if (isAtBottom) {
    stayAtBottom = true
    isScrollingToBottom = false
    showScrollToBottom.value = false
  } else if (!isScrollingToBottom) {
    stayAtBottom = false
    showScrollToBottom.value = liveChatComments.scrollHeight > liveChatComments.clientHeight
  }
}

function onScrollEnd() {
  isScrollingToBottom = false
  onScroll()
}

function stopScrollingToBottom() {
  isScrollingToBottom = false
}

function hideSuperChat() {
  showSuperChat.value = false
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

  liveChatComments.scrollTo({
    top: liveChatComments.scrollHeight,
    behavior
  })
}

</script>

<style scoped src="./WatchVideoLiveChat.css" />
