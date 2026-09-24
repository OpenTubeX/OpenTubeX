<template>
  <FtCard
    class="card relative twitchChat"
    :class="{ fullscreenChat: fullscreenOverlay }"
  >
    <header
      v-if="fullscreenOverlay"
      class="liveChatDockHeader"
    >
      <h3>
        <FtIcon
          class="liveChatDockTitleIcon"
          :icon="['fas', 'message']"
          aria-hidden="true"
        />
        {{ title }}
      </h3>
      <div
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
          <FtIcon :icon="['fas', 'sliders-h']" />
        </button>
        <button
          type="button"
          class="liveChatDockAction"
          :aria-label="closeTitle"
          :title="closeTitle"
          @click="emit('close')"
        >
          <FtIcon :icon="['fas', 'xmark']" />
        </button>
        <div
          v-if="settingsMenuOpen"
          class="liveChatSettingsMenu"
        >
          <FtToggleSwitch
            :label="t('Video.Show Live Chat Timestamps')"
            :default-value="showLiveChatTimestamps"
            :compact="true"
            @change="store.dispatch('updateShowLiveChatTimestamps', $event)"
          />
        </div>
      </div>
    </header>
    <div class="twitchChatInner relative">
      <header
        v-if="!fullscreenOverlay"
        class="titleContainer"
      >
        <h4 class="title">
          {{ title }}
        </h4>
        <div
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
            <FtIcon :icon="['fas', 'sliders-h']" />
          </button>
          <button
            type="button"
            class="liveChatActionButton"
            :aria-label="closeTitle"
            :title="closeTitle"
            @click="emit('close')"
          >
            <FtIcon :icon="['fas', 'xmark']" />
          </button>
          <div
            v-if="settingsMenuOpen"
            class="liveChatSettingsMenu"
          >
            <FtToggleSwitch
              :label="t('Video.Show Live Chat Timestamps')"
              :default-value="showLiveChatTimestamps"
              :compact="true"
              @change="store.dispatch('updateShowLiveChatTimestamps', $event)"
            />
          </div>
        </div>
      </header>
      <div
        v-if="errorMessage"
        class="messageContainer hasError"
        role="alert"
      >
        <p class="message">
          {{ errorMessage }}
        </p>
        <FtIcon
          :icon="['fas', 'exclamation-circle']"
          class="errorIcon"
          aria-hidden="true"
        />
      </div>
      <div
        v-else-if="visibleMessages.length === 0"
        class="messageContainer liveChatMessage"
      >
        <p class="message">
          {{ props.target.type === 'replay'
            ? t("Video['Live chat replay is enabled. Chat messages will appear here as the video plays.']")
            : t("Video['Live chat is enabled. Chat messages will appear here once sent.']") }}
        </p>
      </div>
      <div
        v-else
        class="liveChatBody"
      >
        <div
          ref="scrollport"
          v-overlay-scrollbars
          class="liveChatComments"
          :class="{ atLiveEdge: !showScrollToBottom }"
          tabindex="0"
          @scroll.passive="handleScroll"
          @wheel.passive="handleWheel"
          @pointerdown="handlePointerDown"
          @keydown="handleScrollKeydown"
        >
          <div class="liveChatCommentList">
            <div
              v-for="message in visibleMessages"
              :key="message.id"
              class="comment"
            >
              <p class="chatContent">
                <span
                  v-if="showLiveChatTimestamps"
                  class="liveChatTimestamp"
                >{{ formatMessageTime(message) }}</span>
                <span
                  class="channelName"
                  :style="message.color ? { color: message.color } : undefined"
                  dir="auto"
                >{{ message.name }}</span>
                <bdi class="chatMessage">{{ message.text }}</bdi>
              </p>
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="showScrollToBottom"
        class="scrollToBottom"
        :aria-label="t('Video.Scroll to Bottom')"
        role="button"
        tabindex="0"
        @click="scrollToBottom"
        @keydown.enter.space.prevent="scrollToBottom"
      >
        <FtIcon
          class="icon"
          :icon="['fas', 'arrow-down']"
        />
      </div>
    </div>
  </FtCard>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtToggleSwitch from '../../components/FtToggleSwitch/FtToggleSwitch.vue'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { formatTime } from '../../helpers/dateFormat'
import { formatDurationAsTimestamp } from '../../helpers/utils'
import store from '../../store/index'
import { parseTwitchIrcMessage, parseTwitchReplayPage } from './twitchChat'
import { getTwitchReplayPage } from './twitchChatReplay'

const props = defineProps({
  target: { type: Object, required: true },
  fullscreenOverlay: { type: Boolean, default: false },
  currentTime: { type: Number, default: 0 },
  seekCount: { type: Number, default: 0 }
})

const { t, locale } = useI18n()
const title = computed(() => props.target.type === 'replay' ? t('Video.Live Chat Replay') : t('Video.Live Chat'))
const closeTitle = computed(() => props.target.type === 'replay' ? t('Video.Close Live Chat Replay') : t('Video.Close Live Chat'))
const showLiveChatTimestamps = computed(() => store.getters.getShowLiveChatTimestamps)
const timeFormat = computed(() => store.getters.getTimeFormat)
const emit = defineEmits(['close'])
const errorMessage = ref('')
const messages = ref([])
const settingsMenuOpen = ref(false)
const showScrollToBottom = ref(false)
const scrollport = useTemplateRef('scrollport')
const visibleMessages = computed(() => props.target.type === 'live'
  ? messages.value
  : messages.value.filter(message => message.offset <= props.currentTime).slice(-500))

let socket = null
let retryTimer = null
let stopped = false
let replayGeneration = 0
let cursor = null
let fetchedUntil = 0
let fetching = false
let exhausted = false
let stayAtEnd = true

function formatMessageTime(message) {
  return props.target.type === 'replay'
    ? formatDurationAsTimestamp(message.offset)
    : formatTime(message.timestamp, locale.value, timeFormat.value, { timeStyle: 'short' })
}

function addMessages(incoming) {
  if (incoming.length === 0) return
  messages.value = [...messages.value, ...incoming].slice(-1000)
}

function handleScroll() {
  const viewport = scrollport.value
  if (!viewport) return
  const atEnd = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 1
  if (atEnd) stayAtEnd = true
  showScrollToBottom.value = !stayAtEnd
}

function handleWheel(event) {
  if (event.deltaY < 0) stayAtEnd = false
}

function handlePointerDown(event) {
  const clickedScrollbar = event.target instanceof Element && event.target.closest('.os-scrollbar-vertical') !== null
  if (event.button === 1 || clickedScrollbar) {
    stayAtEnd = false
    return
  }
  if (event.pointerType !== 'touch') return

  const element = event.currentTarget
  const pointerId = event.pointerId
  const startX = event.clientX
  const startY = event.clientY
  const finish = finishEvent => {
    if (finishEvent.pointerId !== pointerId) return
    element.removeEventListener('pointermove', handlePointerMove)
    element.removeEventListener('pointerup', finish)
    element.removeEventListener('pointercancel', finish)
  }
  const handlePointerMove = moveEvent => {
    if (moveEvent.pointerId !== pointerId || Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) return
    stayAtEnd = false
    finish(moveEvent)
  }
  element.addEventListener('pointermove', handlePointerMove, { passive: true })
  element.addEventListener('pointerup', finish, { passive: true })
  element.addEventListener('pointercancel', finish, { passive: true })
}

function handleScrollKeydown(event) {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stayAtEnd = false
}

function scrollToBottom() {
  const viewport = scrollport.value
  if (!viewport) return
  stayAtEnd = true
  showScrollToBottom.value = false
  restoreOverlayScrollTop(viewport, viewport.scrollHeight)
  clampOverlayScrollTop(viewport, viewport.querySelector('.liveChatCommentList'))
}

function syncScrollPosition() {
  const viewport = scrollport.value
  if (!viewport) return
  clampOverlayScrollTop(viewport, viewport.querySelector('.liveChatCommentList'))
  if (stayAtEnd) scrollToBottom()
}

function connect() {
  if (stopped || socket) return
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  const connection = new WebSocket('wss://irc-ws.chat.twitch.tv:443')
  socket = connection
  connection.addEventListener('open', () => {
    connection.send('CAP REQ :twitch.tv/tags\r\n')
    connection.send(`NICK justinfan${Math.floor(Math.random() * 90000 + 10000)}\r\n`)
    connection.send(`JOIN #${props.target.id}\r\n`)
    errorMessage.value = ''
  })
  connection.addEventListener('message', event => {
    for (const line of event.data.split('\r\n')) {
      if (line.startsWith('PING ')) connection.send(`PONG ${line.slice(5)}\r\n`)
      const message = parseTwitchIrcMessage(line)
      if (message) addMessages([message])
    }
  })
  connection.addEventListener('close', () => {
    if (socket !== connection) return
    socket = null
    if (!stopped) retryTimer = setTimeout(connect, 5000)
  })
  connection.addEventListener('error', () => {
    errorMessage.value = t('Video["Live Chat is unavailable for this stream. It may have been disabled by the uploader."]')
  })
}

async function fetchReplay() {
  if (fetching || retryTimer || exhausted || stopped || fetchedUntil >= props.currentTime + 20) return
  fetching = true
  const generation = replayGeneration
  let failed = false
  try {
    const payload = await getTwitchReplayPage(props.target.id, cursor ?? Math.floor(props.currentTime))
    if (generation !== replayGeneration || stopped) return
    const page = parseTwitchReplayPage(payload)
    addMessages(page.messages)
    cursor = page.cursor
    fetchedUntil = page.messages.at(-1)?.offset ?? props.currentTime + 20
    exhausted = cursor === null
    errorMessage.value = ''
  } catch (error) {
    if (generation === replayGeneration) {
      console.error('Twitch chat replay failed', error)
      errorMessage.value = t('Video["Live Chat is unavailable for this stream. It may have been disabled by the uploader."]')
      failed = true
    }
  } finally {
    fetching = false
    if (generation !== replayGeneration && !stopped) fetchReplay()
    else if (failed && !stopped) {
      retryTimer = setTimeout(() => {
        retryTimer = null
        fetchReplay()
      }, 5000)
    } else if (cursor && !stopped && fetchedUntil < props.currentTime + 20) fetchReplay()
  }
}

function resetReplay() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  replayGeneration++
  messages.value = []
  stayAtEnd = true
  showScrollToBottom.value = false
  nextTick(() => {
    if (!scrollport.value) return
    restoreOverlayScrollTop(scrollport.value, 0)
    clampOverlayScrollTop(scrollport.value, scrollport.value.querySelector('.liveChatCommentList'))
  })
  cursor = null
  fetchedUntil = 0
  exhausted = false
  fetchReplay()
}

watch(() => props.currentTime, () => { if (props.target.type === 'replay') fetchReplay() })
watch(() => [visibleMessages.value[0]?.id, visibleMessages.value.at(-1)?.id, visibleMessages.value.length], syncScrollPosition, { flush: 'post' })
watch([showLiveChatTimestamps, () => props.fullscreenOverlay], syncScrollPosition, { flush: 'post' })
watch(scrollport, (viewport, _previous, onCleanup) => {
  if (!viewport) return
  const content = viewport.querySelector('.liveChatCommentList')
  let resizeTimer = null
  const viewportObserver = new ResizeObserver(() => {
    if (resizeTimer !== null) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(syncScrollPosition, 50)
  })
  const contentObserver = new ResizeObserver(syncScrollPosition)
  viewportObserver.observe(viewport)
  if (content) contentObserver.observe(content)
  onCleanup(() => {
    viewportObserver.disconnect()
    contentObserver.disconnect()
    if (resizeTimer !== null) clearTimeout(resizeTimer)
  })
}, { flush: 'post' })
watch(() => props.seekCount, () => { if (props.target.type === 'replay') resetReplay() })
if (props.target.type === 'live') connect()
else fetchReplay()

onBeforeUnmount(() => {
  stopped = true
  replayGeneration++
  if (retryTimer) clearTimeout(retryTimer)
  socket?.close()
})
</script>

<style scoped src="../../components/WatchVideoLiveChat/WatchVideoLiveChat.css" />
<style scoped src="./TwitchChat.css" />
