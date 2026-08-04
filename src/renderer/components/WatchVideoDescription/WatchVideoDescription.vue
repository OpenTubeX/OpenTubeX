<template>
  <FtCard
    v-if="shownDescription.length > 0 || games.length > 0"
    :class="{
      videoDescription: true,
      short: !isExpanded,
      alwaysExpanded
    }"
  >
    <span
      v-if="showControls && !isExpanded && !alwaysExpanded"
      class="descriptionStatus"
      role="button"
      tabindex="0"
      @click="expandDescription"
      @keydown.enter.space.prevent="expandDescription"
    >
      {{ $t("Description.Expand Description") }}
    </span>
    <div
      ref="descriptionScroll"
      v-overlay-scrollbars="!alwaysExpanded"
      class="descriptionScroll"
    >
      <FtTimestampCatcher
        ref="descriptionContainer"
        class="description"
        :input-html="processedShownDescription"
        :link-tab-index="linkTabIndex"
        @timestamp-event="onTimestamp"
        @click="expandDescriptionWithClick"
      />
      <bdi
        v-if="license && isExpanded"
        class="license"
      >
        {{ license }}
      </bdi>
      <template v-if="games.length > 0 && isExpanded">
        <h3 class="gamesHeading">
          {{ $t("Description.Games") }}
        </h3>
        <ul class="gameList">
          <li
            v-for="(game, index) in shownGames"
            :key="game.channelId ?? index"
          >
            <component
              :is="game.channelId ? 'RouterLink' : 'div'"
              :to="`/channel/${game.channelId}`"
              :tabindex="game.channelId ? linkTabIndex : null"
              class="game"
            >
              <img
                v-if="game.thumbnail"
                :src="game.thumbnail"
                class="gameBoxArt"
                alt=""
                loading="lazy"
              >
              <span class="gameText">
                <bdi class="gameTitle">{{ game.title }}</bdi>
                <bdi
                  v-if="game.subtitle"
                  class="gameSubtitle"
                >{{ game.subtitle }}</bdi>
              </span>
            </component>
          </li>
        </ul>
      </template>
    </div>
    <span
      v-if="showControls && isExpanded && !alwaysExpanded"
      class="descriptionStatus"
      role="button"
      tabindex="0"
      @click="collapseDescription"
      @keydown.enter.space.prevent="collapseDescription"
    >
      {{ $t("Description.Collapse Description") }}
    </span>
  </FtCard>
</template>

<script setup>
import autolinker from 'autolinker'

import { onMounted, ref, computed, nextTick, useTemplateRef, watch } from 'vue'
import FtCard from '../ft-card/ft-card.vue'
import FtTimestampCatcher from '../FtTimestampCatcher.vue'

import { useTabContext } from '../../tabs/TabContext'

import store from '../../store/index'

const props = defineProps({
  description: {
    type: String,
    default: ''
  },
  descriptionHtml: {
    type: String,
    default: ''
  },
  license: {
    type: String,
    default: null,
  },
  /** @type {import('vue').PropType<import('../../helpers/video-games').LocalVideoGame[]>} */
  games: {
    type: Array,
    default: () => [],
  },
  alwaysExpanded: {
    type: Boolean,
    default: false,
  }
})

const emit = defineEmits(['timestamp-event'])

let shownDescription = ''
const descriptionScroll = useTemplateRef('descriptionScroll')
const descriptionContainer = useTemplateRef('descriptionContainer')
const showFullDescription = ref(false)
const showControls = ref(false)
// a video can have games but no description, and there is nothing to expand or collapse then,
// so treat it as expanded. `measureDescription` can't do it, it bails out on a zero height element.
const isExpanded = computed(() => props.alwaysExpanded || shownDescription === '' || showFullDescription.value)

if (props.descriptionHtml !== '') {
  const parsed = parseDescriptionHtml(props.descriptionHtml)

  // the invidious API returns emtpy html elements when the description is empty
  // so we need to parse it to see if there is any meaningful text in the html
  // or if it's just empty html elements e.g. `<p></p>`

  const testDiv = document.createElement('div')
  testDiv.innerHTML = parsed

  if (!/^\s*$/.test(testDiv.innerText)) {
    shownDescription = parsed
  }
} else {
  if (!/^\s*$/.test(props.description)) {
    shownDescription = autolinker.link(props.description)
  }
}

const processedShownDescription = computed(() => {
  if (shownDescription === '') { return shownDescription }

  return processDescriptionHtml(shownDescription, linkTabIndex.value)
})

const linkTabIndex = computed(() => {
  return isExpanded.value ? '0' : '-1'
})

// drop the channel ids when channel links are disabled, so that the games render as plain text
const shownGames = computed(() => {
  if (!store.getters.getDisableChannelLinks) {
    return props.games
  }

  return props.games.map(game => ({ ...game, channelId: undefined }))
})

/**
 * @param {number} timestamp
 */
function onTimestamp(timestamp) {
  emit('timestamp-event', timestamp)
}

/**
 @param {PointerEvent} e
 */
function expandDescriptionWithClick(e) {
  // Ignore link clicks
  if (props.alwaysExpanded || e.target.tagName === 'A') { return }

  expandDescription()
}

/**
 * Enables user to view entire contents of description
 */
function expandDescription() {
  showFullDescription.value = true
}

/**
 * Enables user to collapse contents of description
 */
function collapseDescription() {
  descriptionScroll.value.scrollTop = 0
  showFullDescription.value = false
}

const { isTabPresented } = useTabContext()
let hasMeasured = false

/**
 * Returns true when description content does not overflow description container
 * Useful for hiding description expansion/contraction controls
 */
function isShortDescription() {
  const descriptionElem = descriptionContainer.value?.$el
  return descriptionElem?.clientHeight >= descriptionElem?.scrollHeight
}

// To verify whether or not the description is too short for displaying
// description controls, we need to check the description's dimensions.
// A tab can mount while it isn't the one on screen (background preload, session
// restore), in which case it is `display: none` and every dimension reads 0,
// which would misdetect the description as short and leave it permanently
// expanded with no collapse control. Only measure once the element has a real
// layout, retrying when the tab is first presented.
function measureDescription() {
  if (hasMeasured || props.alwaysExpanded) {
    return
  }

  const descriptionElem = descriptionContainer.value?.$el
  if (!descriptionElem || (descriptionElem.clientHeight === 0 && descriptionElem.scrollHeight === 0)) {
    return
  }

  showFullDescription.value = isShortDescription()
  showControls.value = !showFullDescription.value
  hasMeasured = true
}

onMounted(measureDescription)

watch(() => props.alwaysExpanded, (alwaysExpanded, wasAlwaysExpanded) => {
  if (!alwaysExpanded && wasAlwaysExpanded) {
    nextTick(measureDescription)
  }
})

if (isTabPresented) {
  watch(isTabPresented, (presented) => {
    if (presented) {
      nextTick(measureDescription)
    }
  })
}

/**
 * @param {string} descriptionText
 * @returns {string}
 */
function parseDescriptionHtml(descriptionText) {
  return descriptionText
    .replaceAll('target="_blank"', '')
    .replaceAll(/\/redirect.+?(?=q=)/g, '')
    .replaceAll('q=', '')
    .replaceAll(/rel="nofollow\snoopener"/g, '')
    .replaceAll(/class=.+?(?=")./g, '')
    .replaceAll(/id=.+?(?=")./g, '')
    .replaceAll(/data-target-new-window=.+?(?=")./g, '')
    .replaceAll(/data-url=.+?(?=")./g, '')
    .replaceAll(/data-sessionlink=.+?(?=")./g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('%3A', ':')
    .replaceAll('%2F', '/')
    .replaceAll(/&v.+?(?=")/g, '')
    .replaceAll(/&redirect-token.+?(?=")/g, '')
    .replaceAll(/&redir_token.+?(?=")/g, '')
    .replaceAll('href="/', 'href="https://www.youtube.com/')
    .replaceAll('href="/hashtag/', 'href="https://wwww.youtube.com/hashtag/')
    .replaceAll('yt.www.watch.player.seekTo', 'changeDuration')
}

/**
 * @param {string} descriptionText
 * @param {string} tabIndex
 * @returns {string}
 */
function processDescriptionHtml(descriptionText, tabIndex) {
  return descriptionText
    .replaceAll('<a', `<a tabindex="${tabIndex}"`)
}
</script>

<style scoped src="./WatchVideoDescription.css" />
