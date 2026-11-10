<template>
  <FtCard>
    <div
      class="bannerContainer"
      :class="{
        default: !bannerUrl || bannerLoadFailed
      }"
    >
      <FtRetryImage
        v-if="bannerUrl && !bannerLoadFailed"
        class="bannerImage"
        :src="bannerUrl"
        alt=""
        @error="bannerLoadFailed = true"
      />
    </div>

    <div
      class="infoContainer"
    >
      <div
        ref="info"
        class="info"
      >
        <div
          class="thumbnailContainer"
        >
          <FtRetryImage
            v-if="thumbnailUrl && !thumbnailLoadFailed"
            :fallback-icon="['fas', 'circle-user']"
            class="thumbnail"
            :src="thumbnailUrl"
            alt=""
            @error="handleThumbnailError"
          />
          <FtIcon
            v-else
            class="thumbnail"
            :icon="['fas', 'circle-user']"
          />
          <div
            class="lineContainer"
          >
            <h1
              class="name"
              dir="auto"
            >
              <FtVerifiedBadge
                :name="name || $t('Channel.Channel Name Unavailable')"
                :verified="verified"
                :artist="verifiedArtist"
              />
            </h1>

            <p
              v-if="handle || showSubCount"
              class="metadata"
            >
              <span
                v-if="handle"
                class="handle"
                dir="auto"
              >{{ handle }}</span>
              <span
                v-if="showSubCount"
                class="subCount"
              >{{ $t('Global.Counts.Subscriber Count', { count: formattedSubCount }, subCount) }}</span>
            </p>
          </div>
        </div>

        <div
          ref="actions"
          class="infoActionsContainer"
        >
          <FtIconButton
            v-if="showSearchBar && !hasErrorMessage"
            class="channelSearchToggle"
            :title="$t('Channel.Search Channel')"
            :icon="['fas', 'search']"
            :aria-expanded="searchExpanded"
            :aria-pressed="searchExpanded"
            :theme="searchExpanded ? 'secondary' : 'base-no-default'"
            @click="toggleSearch"
          />

          <FtShareButton
            v-if="!hideSharingActions && showShareMenu"
            :id="id"
            share-target-type="Channel"
            class="shareIcon"
          />

          <FtIconButton
            v-if="canPin || isPinnedToNavigation"
            class="pinButton"
            :title="isPinnedToNavigation ? $t('User Playlists.Unpin from Navigation') : $t('User Playlists.Pin to Navigation')"
            :icon="['fas', isPinnedToNavigation ? 'thumbtack-slash' : 'thumbtack']"
            :aria-pressed="isPinnedToNavigation"
            :theme="isPinnedToNavigation ? 'secondary' : 'base-no-default'"
            @click="togglePinnedToNavigation"
          />

          <FtSubscribeButton
            v-if="!hideUnsubscribeButton && (!hasErrorMessage || isSubscribed)"
            :channel-id="id"
            :channel-name="name"
            :channel-thumbnail="thumbnailUrl"
            :channel-handle="handle"
            :compact="compactSubscribe"
            @subscribed="subscribed"
          />
        </div>
      </div>

      <FtFlexBox
        v-if="!hasErrorMessage"
        class="infoTabs"
      >
        <div
          ref="tabsContainer"
          class="tabs"
        >
          <FtTabs
            ref="tabsContent"
            class="tabsContent"
            :class="{ hideTabIcons }"
            :aria-label="$t('Channel.Channel Tabs')"
          >
            <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
            <div
              v-for="tab in shownTabs"
              :id="`${tab.id}Tab`"
              :key="tab.id"
              :data-tab="tab.id"
              class="tab"
              :class="{ selectedTab: currentTab === tab.id, overflowedTab: overflowTabs.includes(tab.id) }"
              role="tab"
              :aria-selected="currentTab === tab.id && !selectedOverflowTab"
              :aria-controls="tab.panel"
              :tabindex="tabIndex(tab.id)"
              @click="changeTabFromPointer($event, tab.id)"
              @keydown.left.right="focusTab(tab.id, $event)"
              @keydown.enter.space.prevent="changeTab(tab.id)"
            >
              <FtIcon
                :icon="['fas', tab.icon]"
                class="channelTabIcon"
                aria-hidden="true"
              />
              <span
                class="tabLabel"
                :data-label="tab.label"
              ><span>{{ tab.label }}</span></span>
            </div>
            <!-- Tabs that do not fit open from here. It stands in for a selected one. -->
            <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
            <div
              id="moreTab"
              ref="moreTab"
              class="tab moreTab"
              :class="{ selectedTab: selectedOverflowTab, overflowedTab: overflowTabs.length === 0 }"
              role="tab"
              aria-haspopup="menu"
              :aria-selected="!!selectedOverflowTab"
              :aria-controls="selectedOverflowTab?.panel"
              :tabindex="selectedOverflowTab ? 0 : -1"
              @click="openMoreTabs"
              @keydown.left.right="focusTab(currentTab, $event)"
              @keydown.enter.space.prevent="openMoreTabs"
            >
              <span class="moreTabLabel">
                <span
                  ref="moreTabText"
                  :class="{ moreTabTextHidden: selectedOverflowTab }"
                >{{ $t('More') }}</span>
                <span
                  v-if="selectedOverflowTab"
                  class="moreTabSelected"
                  :data-label="selectedOverflowTab.label"
                ><span>{{ selectedOverflowTab.label }}</span></span>
              </span>
              <FtIcon
                :icon="['fas', 'angle-down']"
                class="moreTabIcon"
                aria-hidden="true"
              />
            </div>
          </FtTabs>
        </div>

        <FtInput
          v-if="showSearchBar"
          ref="searchBar"
          input-type="search"
          :label="$t('Channel.Search Channel')"
          :icon="['fas', 'search']"
          :placeholder="$t('Form Inputs.Search Text Hint')"
          :action-button-label="$t('Search Bar.Search')"
          :value="query"
          class="channelSearch"
          :class="{ expanded: searchExpanded }"
          :maxlength="255"
          @input="handleSearchInput"
          @click="search"
        />
      </FtFlexBox>
      <FtFixedBackground />
    </div>
  </FtCard>
</template>

<script setup>
import FtTabs from '../FtTabs/FtTabs.vue'
import FtRetryImage from '../FtRetryImage.vue'
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { FtIcon } from '@opentubex/icons'
import FtCard from '../ft-card/ft-card.vue'
import FtFixedBackground from '../FtFixedBackground/FtFixedBackground.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtShareButton from '../FtShareButton/FtShareButton.vue'
import FtSubscribeButton from '../FtSubscribeButton/FtSubscribeButton.vue'
import FtVerifiedBadge from '../FtVerifiedBadge/FtVerifiedBadge.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'

import store from '../../store/index'

import { ctrlFHandler, formatSubscriberCount } from '../../helpers/utils'
import { openButtonMenu } from '../../helpers/buttonMenu'
import { labeledSubscribeButtonWidth } from '../../helpers/subscribeButton'
import { useTabContext } from '../../tabs/TabContext'

const props = defineProps({
  id: {
    type: String,
    required: true
  },
  name: {
    type: String,
    default: null
  },
  verified: {
    type: Boolean,
    default: false
  },
  verifiedArtist: {
    type: Boolean,
    default: false
  },
  bannerUrl: {
    type: String,
    default: null
  },
  canPin: {
    type: Boolean,
    default: false
  },
  hasErrorMessage: {
    type: Boolean,
    default: false
  },
  thumbnailUrl: {
    type: String,
    default: null
  },
  handle: {
    type: String,
    default: null
  },
  subCount: {
    type: Number,
    default: null
  },
  showShareMenu: {
    type: Boolean,
    default: true
  },
  showSearchBar: {
    type: Boolean,
    default: true
  },
  isSubscribed: {
    type: Boolean,
    default: false
  },
  visibleTabs: {
    type: Array,
    default: () => ([])
  },
  currentTab: {
    type: String,
    default: 'videos'
  },
  query: {
    type: String,
    default: ''
  },
})

const pinnedChannels = computed(() => store.getters.getPinnedChannels)
const isPinnedToNavigation = computed(() => pinnedChannels.value.some(channel => channel.id === props.id))

// Store the upstream avatar, as subscriptions do, so pins can change backends.
const pinThumbnail = computed(() => props.thumbnailUrl?.replace(/^https?:\/\/[^/]+\/ggpht/, 'https://yt3.googleusercontent.com'))

async function togglePinnedToNavigation() {
  if (!isPinnedToNavigation.value && !props.canPin) return
  const saved = await store.dispatch('updatePinnedChannels', isPinnedToNavigation.value
    ? pinnedChannels.value.filter(channel => channel.id !== props.id)
    : [...pinnedChannels.value, { id: props.id, name: props.name || props.id, thumbnail: pinThumbnail.value }])
  if (!saved) return
  await store.dispatch('refreshPinnedChannelMetadata', { id: props.id, name: props.name, thumbnail: pinThumbnail.value })
}

const emit = defineEmits(['change-tab', 'search', 'subscribed'])

const { locale, t } = useI18n()
const { isTabPresented } = useTabContext()
const tabsContainer = useTemplateRef('tabsContainer')
const tabsContent = useTemplateRef('tabsContent')
let tabsResizeObserver = null
let actionsResizeObserver = null

const tabDefinitions = computed(() => [
  { id: 'home', panel: 'homePanel', icon: 'house', label: t('Channel.Home.Home') },
  { id: 'videos', panel: 'videoPanel', icon: 'video', label: t('Channel.Videos.Videos') },
  { id: 'shorts', panel: 'shortPanel', icon: 'play', label: t('Global.Shorts') },
  { id: 'live', panel: 'livePanel', icon: 'tower-broadcast', label: t('Channel.Live.Live') },
  { id: 'releases', panel: 'releasePanel', icon: 'headphones', label: t('Channel.Releases.Releases') },
  { id: 'shows', panel: 'showsPanel', icon: 'tv', label: t('Channel.Shows.Shows') },
  { id: 'podcasts', panel: 'podcastPanel', icon: 'podcast', label: t('Channel.Podcasts.Podcasts') },
  { id: 'courses', panel: 'coursesPanel', icon: 'book-open', label: t('Channel.Courses.Courses') },
  { id: 'playlists', panel: 'playlistPanel', icon: 'list', label: t('Channel.Playlists.Playlists') },
  { id: 'community', panel: 'communityPanel', icon: 'rss', label: t('Global.Posts') },
  { id: 'about', panel: 'aboutPanel', icon: 'circle-info', label: t('Channel.About.About') },
])

const shownTabs = computed(() => tabDefinitions.value.filter(tab => tab.id === 'about' || props.visibleTabs.includes(tab.id)))

/** Tabs that do not fit in the row and open from the More tab instead. */
const overflowTabs = ref([])
const hideTabIcons = ref(false)
const selectedOverflowTab = computed(() => overflowTabs.value.includes(props.currentTab)
  ? shownTabs.value.find(tab => tab.id === props.currentTab)
  : null)

/** @param {string} tab */
function tabIndex(tab) {
  if (selectedOverflowTab.value) return -1
  // Search results belong to the Home or Videos tab.
  if (props.currentTab === 'search' && (tab === 'home' || tab === 'videos')) return 0
  return props.currentTab === tab ? 0 : -1
}

const moreTab = useTemplateRef('moreTab')
const moreTabText = useTemplateRef('moreTabText')

/** @param {string} value */
function px(value) {
  return Number.parseFloat(value) || 0
}

/**
 * Shows every tab in one row: with icons if they fit, otherwise without, and
 * otherwise as many as fit before a More tab that lists the rest. The row
 * never wraps or scrolls.
 */
function updateTabsLayout() {
  const container = tabsContainer.value
  const content = tabsContent.value?.$el
  const more = moreTab.value
  if (!container || !content || !more) return
  const available = container.getBoundingClientRect().width + 0.5
  if (available <= 0.5) return
  const gap = px(getComputedStyle(content).columnGap)
  // Hidden tabs stay in the layout, and labels reserve their bold width, so
  // every width is known whichever tabs are shown or selected.
  const tabs = [...content.querySelectorAll('.tab:not(.moreTab)')].map(tab => {
    const style = getComputedStyle(tab)
    const label = tab.querySelector('.tabLabel').getBoundingClientRect().width
    const width = label + px(style.paddingInlineStart) + px(style.paddingInlineEnd)
    const icon = px(getComputedStyle(tab.querySelector('.channelTabIcon')).inlineSize) + px(style.columnGap)
    return { id: tab.dataset.tab, label, width, withIcon: width + icon }
  })
  const rowWidth = (items, key = 'width') => items.reduce((sum, tab) => sum + tab[key], 0) + Math.max(0, items.length - 1) * gap

  let overflow = []
  const hideIcons = rowWidth(tabs, 'withIcon') > available
  if (hideIcons && rowWidth(tabs) > available) {
    const moreChrome = more.getBoundingClientRect().width - more.querySelector('.moreTabLabel').getBoundingClientRect().width
    const moreText = moreTabText.value.getBoundingClientRect().width
    const fitting = (label) => {
      const moreWidth = moreChrome + Math.max(moreText, label)
      let count = 0
      while (count < tabs.length && rowWidth(tabs.slice(0, count + 1)) + gap + moreWidth <= available) count++
      return count
    }
    let count = fitting(0)
    const selected = tabs.findIndex(tab => tab.id === props.currentTab)
    // The More tab shows the selected tab's label in place of its own.
    if (selected >= count) count = fitting(tabs[selected].label)
    overflow = tabs.slice(count).map(tab => tab.id)
  }
  if (hideTabIcons.value !== hideIcons) hideTabIcons.value = hideIcons
  if (overflow.join() !== overflowTabs.value.join()) overflowTabs.value = overflow
}

const moreTabItems = computed(() => overflowTabs.value.map(id => {
  const tab = shownTabs.value.find(tab => tab.id === id)
  return {
    type: 'radio',
    label: tab.label,
    icon: ['fas', tab.icon],
    checked: props.currentTab === id,
    enabled: true,
    run: () => changeTab(id, false)
  }
}))

function openMoreTabs() {
  if (overflowTabs.value.length > 0) openButtonMenu(moreTab.value, moreTabItems, t('More'))
}

function observeTabs() {
  tabsResizeObserver?.disconnect()
  if (tabsContainer.value && tabsContent.value) {
    tabsResizeObserver?.observe(tabsContainer.value)
    // Labels can change width without resizing the row.
    tabsContainer.value.querySelectorAll('.tabLabel, .moreTabLabel > span').forEach(label => tabsResizeObserver?.observe(label))
  }
  updateTabsLayout()
}

const info = useTemplateRef('info')
const actions = useTemplateRef('actions')
const compactSubscribe = ref(false)

/** Drops the subscribe label when the actions would not fit in one row. */
function updateActionsLayout() {
  const row = actions.value
  if (!row || !info.value) return
  const available = info.value.getBoundingClientRect().width + 0.5
  if (available <= 0.5) return
  const children = [...row.children].filter(child => child.getBoundingClientRect().width > 0)
  let width = children.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0) +
    Math.max(0, children.length - 1) * px(getComputedStyle(row).columnGap)
  const button = row.querySelector('.subscribeButton')
  if (button) {
    width += labeledSubscribeButtonWidth(button) - button.getBoundingClientRect().width
  }
  const compact = width > available
  if (compact !== compactSubscribe.value) compactSubscribe.value = compact
}

function observeActions() {
  actionsResizeObserver?.disconnect()
  if (info.value && actions.value) {
    actionsResizeObserver?.observe(info.value)
    for (const child of actions.value.children) actionsResizeObserver?.observe(child)
    const label = actions.value.querySelector('.subscribeLabel')
    if (label) actionsResizeObserver?.observe(label)
  }
  updateActionsLayout()
}

watch(() => props.currentTab, updateTabsLayout, { flush: 'post' })
watch([() => props.visibleTabs, tabsContainer, locale,
  () => isTabPresented?.value], observeTabs, { flush: 'post' })

onActivated(() => nextTick(() => {
  observeTabs()
  observeActions()
}))
onDeactivated(() => {
  tabsResizeObserver?.disconnect()
  actionsResizeObserver?.disconnect()
})

const thumbnailLoadFailed = ref(false)
const bannerLoadFailed = ref(false)

watch([() => props.id, () => props.bannerUrl], () => {
  bannerLoadFailed.value = false
})

watch(() => props.thumbnailUrl, () => {
  thumbnailLoadFailed.value = false
})

function handleThumbnailError() {
  thumbnailLoadFailed.value = true
}

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelSubscriptions = computed(() => {
  return store.getters.getHideChannelSubscriptions
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideSharingActions = computed(() => {
  return store.getters.getHideSharingActions
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideUnsubscribeButton = computed(() => {
  return store.getters.getHideUnsubscribeButton
})

const showSubCount = computed(() => props.subCount !== null && !hideChannelSubscriptions.value)

const formattedSubCount = computed(() => {
  if (hideChannelSubscriptions.value) {
    return null
  }
  return formatSubscriberCount(props.subCount)
})

function subscribed() {
  emit('subscribed')
}

/**
 * @param {string} tab
 * @param {boolean} moveFocus
 */
function changeTab(tab, moveFocus = true) {
  emit('change-tab', tab, moveFocus)
}

/**
 * @param {MouseEvent} event
 * @param {string} tab
 */
function changeTabFromPointer(event, tab) {
  changeTab(tab, false)

  if (event.detail > 0 && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
}

/**
 * @param {string} currentTab
 * @param {KeyboardEvent} event
 */
function focusTab(currentTab, event) {
  if (event.altKey) {
    return
  }

  event.preventDefault()

  const visibleTabs = props.visibleTabs

  const index = visibleTabs.indexOf(currentTab)

  // focus left or right tab with wrap around
  const tab = (event.key === 'ArrowLeft')
    ? visibleTabs[(index > 0 ? index : visibleTabs.length) - 1]
    : visibleTabs[(index + 1) % visibleTabs.length]

  changeTab(tab)
  // Tabs in the More menu are represented by the More tab.
  nextTick(() => (overflowTabs.value.includes(tab) ? moreTab.value : document.getElementById(`${tab}Tab`))?.focus())
  store.dispatch('showOutlines')
}

/**
 * @param {string} query
 */
function search(query) {
  emit('search', query)
}

/**
 * @param {string} query
 */
function handleSearchInput(query) {
  if (query === '') {
    clearSearch()
  }
}

function clearSearch() {
  emit('search', '')
}

const searchBar = useTemplateRef('searchBar')
const searchExpanded = ref(false)

function focusSearch() {
  searchExpanded.value = true
  nextTick(() => searchBar.value?.focus())
}

function toggleSearch() {
  searchExpanded.value = !searchExpanded.value
  if (searchExpanded.value) focusSearch()
}

/**
 * @param {KeyboardEvent} event
 */
function keyboardShortcutHandler(event) {
  if (props.showSearchBar && !props.hasErrorMessage && (!isTabPresented || isTabPresented.value)) {
    ctrlFHandler(event, { focus: focusSearch })
  }
}

// Actions appear and disappear with these, without resizing the row.
watch([hideSharingActions, hideUnsubscribeButton, isPinnedToNavigation, locale, () => props.canPin,
  () => props.showSearchBar, () => props.hasErrorMessage], observeActions, { flush: 'post' })

onMounted(() => {
  tabsResizeObserver = new ResizeObserver(updateTabsLayout)
  actionsResizeObserver = new ResizeObserver(updateActionsLayout)
  observeTabs()
  observeActions()
  document.addEventListener('keydown', keyboardShortcutHandler)
})

onBeforeUnmount(() => {
  tabsResizeObserver?.disconnect()
  actionsResizeObserver?.disconnect()
  window.dispatchEvent(new CustomEvent('opentubex:close-context-menu', { detail: moreTabItems }))
  document.removeEventListener('keydown', keyboardShortcutHandler)
})
</script>

<style scoped src="./ChannelDetails.css" />
