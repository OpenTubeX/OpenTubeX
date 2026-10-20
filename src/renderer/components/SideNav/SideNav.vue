<template>
  <FtFlexBox
    class="sideNav"
    :class="[{ opened: isOpen, expanded: isOpen || props.forceExpanded, scrollHidden, compactLabels: compactNavigationLabels, highlightTransitionsDisabled, layoutTransitionsDisabled }, applyHiddenLabels]"
    data-tutorial="navigation"
    role="navigation"
    @focusin="resetScrollVisibility"
  >
    <div
      ref="innerRef"
      v-overlay-scrollbars
      class="inner"
      :class="applyHiddenLabels"
    >
      <router-link
        v-for="(item, index) in visibleNavigationItems"
        :key="item.id"
        class="navOption mobileNavItem"
        :class="{
          topNavOption: index === 0,
          mobileHidden: !mobilePrimaryItemIds.has(item.id),
        }"
        role="button"
        :to="`/${item.id}`"
        :title="item.id === 'history' ? historyTitle : item.label"
        :aria-label="item.label"
      >
        <div class="thumbnailContainer">
          <FtIcon
            :icon="item.icon"
            class="navIcon"
            :class="applyNavIconExpand"
          />
        </div>
        <NavLabel
          :label="item.label"
          :short-label="item.shortLabel"
        />
      </router-link>
      <SideNavMoreOptions
        v-if="mobileOverflowItems.length > 0"
        :items="mobileOverflowItems"
        :class="{ compactLabels: compactNavigationLabels }"
      />
      <hr>
      <div
        v-if="pinnedPlaylists.length > 0"
        class="mobileHidden pinnedPlaylists"
      >
        <router-link
          v-for="playlist in pinnedPlaylists"
          :key="playlist._id"
          :to="{ path: `/playlist/${playlist._id}`, query: { playlistType: 'user' } }"
          class="navChannel channelLink"
          :title="playlist.playlistName"
          role="button"
        >
          <div class="thumbnailContainer">
            <FtRetryImage
              v-if="pinnedPlaylistThumbnail(playlist) != null"
              :fallback-icon="['fas', 'list']"
              class="channelThumbnail playlistThumbnail"
              :class="{ blur: blurThumbnails }"
              height="35"
              width="35"
              loading="lazy"
              :src="pinnedPlaylistThumbnail(playlist)"
              :alt="isOpen ? '' : playlist.playlistName"
            />
            <FtIcon
              v-else
              class="channelThumbnail noThumbnail playlistThumbnail"
              :icon="['fas', 'list']"
            />
          </div>
          <p
            v-if="isOpen"
            class="navLabel"
            dir="auto"
          >
            {{ playlist.playlistName }}
          </p>
        </router-link>
        <hr v-if="pinnedChannels.length > 0 || !hideActiveSubscriptions">
      </div>
      <div
        v-if="pinnedChannels.length > 0"
        class="mobileHidden pinnedChannels"
      >
        <component
          :is="enableChannelLinks ? 'router-link' : 'span'"
          v-for="channel in pinnedChannels"
          :key="channel.id"
          :to="`/channel/${channel.id}`"
          :class="enableChannelLinks ? '' : 'disabledIcon'"
          class="navChannel channelLink mobileHidden"
          :title="channel.name"
          :aria-label="channel.name"
          role="button"
        >
          <div
            class="thumbnailContainer"
          >
            <FtRetryImage
              v-if="channel.thumbnail != null"
              :fallback-icon="['fas', 'circle-user']"
              class="channelThumbnail"
              height="35"
              width="35"
              loading="lazy"
              :src="channel.thumbnail"
              :alt="isOpen ? '' : channel.name"
            />
            <FtIcon
              v-else
              class="channelThumbnail noThumbnail"
              :icon="['fas', 'circle-user']"
            />
          </div>
          <p
            v-if="isOpen"
            class="navLabel"
            dir="auto"
          >
            {{ channel.name }}
          </p>
        </component>
        <hr v-if="!hideActiveSubscriptions">
      </div>
      <div
        v-if="!hideActiveSubscriptions"
        class="mobileHidden"
      >
        <component
          :is="enableChannelLinks ? 'router-link' : 'span'"
          v-for="channel in displayedActiveSubscriptions"
          :key="channel.id"
          :to="`/channel/${channel.id}`"
          :class="enableChannelLinks ? '' : 'disabledIcon'"
          class="navChannel channelLink mobileHidden"
          :title="channel.name"
          role="button"
        >
          <div
            class="thumbnailContainer"
          >
            <FtRetryImage
              v-if="channel.thumbnail != null"
              :fallback-icon="['fas', 'circle-user']"
              class="channelThumbnail"
              height="35"
              width="35"
              loading="lazy"
              :src="channel.thumbnail"
              :alt="isOpen ? '' : channel.name"
            />
            <FtIcon
              v-else
              class="channelThumbnail noThumbnail"
              :icon="['fas', 'circle-user']"
            />
          </div>
          <p
            v-if="isOpen"
            class="navLabel"
            dir="auto"
          >
            {{ channel.name }}
          </p>
        </component>
        <div
          v-if="hasMoreActiveSubscriptions"
          :key="activeSubscriptionLimit"
          v-observe-visibility="{
            callback: onActiveSubscriptionsVisibilityChanged
          }"
          class="subscriptionLoadSentinel"
          aria-hidden="true"
        />
      </div>
    </div>
  </FtFlexBox>
</template>

<script setup>
import FtRetryImage from '../FtRetryImage.vue'
import NavLabel from './NavLabel.vue'
import { FtIcon } from '@opentubex/icons'
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, useTemplateRef, watch } from 'vue'
import { ObserveVisibility as vObserveVisibility } from 'vue-observe-visibility'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import SideNavMoreOptions from '../SideNavMoreOptions/SideNavMoreOptions.vue'

import store from '../../store/index'

import { youtubeImageUrlToInvidious } from '../../helpers/api/invidious'
import { filterAvailableNavigationItems } from '../../../navigationAvailability'
import { getVideoThumbnailUrl, localizeAndAddKeyboardShortcutToActionTitle } from '../../helpers/utils'
import { getConfiguredKeyboardShortcuts } from '../../../constants'
import { NAVIGATION_ITEM_DEFINITIONS } from '../../../navigationItems'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { createMobileNavigationScroll, mobileNavigationMinimizePreview } from '../../helpers/mobileNavigationScroll'
import { getTabNavigationService } from '../../tabs/TabNavigationService'
import { sortUserPlaylists } from '../../helpers/playlists'

const { locale, t } = useI18n()
const appKeyboardShortcuts = computed(() => getConfiguredKeyboardShortcuts(
  store.getters.getKeyboardShortcuts
).APP.GENERAL)

const SUPPORTS_LOCAL_API = process.env.SUPPORTS_LOCAL_API
const activeSubscriptionsPerPage = 50

const props = defineProps({
  forceExpanded: {
    type: Boolean,
    default: false
  }
})

const route = useRoute()
const highlightTransitionsDisabled = ref(false)
watch(() => route.fullPath, (_route, _previousRoute, onCleanup) => {
  // Tab switches project the route before updating the presented tab. Suppress
  // only that highlight update, keeping interaction feedback during slow mounts.
  highlightTransitionsDisabled.value = getTabNavigationService().isPresentingRoute(route.fullPath)
  if (!highlightTransitionsDisabled.value) return

  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      highlightTransitionsDisabled.value = false
    })
  })
  onCleanup(() => cancelAnimationFrame(frame))
}, { flush: 'sync' })

/** @type {import('vue').ComputedRef<boolean>} */
const isOpen = computed(() => {
  return store.getters.getIsSideNavOpen
})

/** @type {import('vue').ComputedRef<boolean>} */
const backendFallback = computed(() => {
  return store.getters.getBackendFallback
})

/** @type {import('vue').ComputedRef<'local' | 'invidious'>} */
const backendPreference = computed(() => {
  return store.getters.getBackendPreference
})

/** @type {import('vue').ComputedRef<string>} */
const currentInvidiousInstanceUrl = computed(() => {
  return store.getters.getCurrentInvidiousInstanceUrl
})

/** @type {import('vue').ComputedRef<object>} */
const activeProfile = computed(() => {
  return store.getters.getActiveProfile
})

const pinnedChannels = computed(() => store.getters.getPinnedChannels.map(channel => {
  let thumbnail = channel.thumbnail?.replace(/=s\d+/, '=s35')
  if (backendPreference.value === 'invidious') {
    thumbnail = youtubeImageUrlToInvidious(thumbnail, currentInvidiousInstanceUrl.value)
  }
  return { ...channel, thumbnail }
}))

const activeSubscriptions = computed(() => {
  const instanceUrl = backendPreference.value === 'invidious' ? currentInvidiousInstanceUrl.value : null

  // Only copy the displayed fields: a deep copy would track every nested
  // channel setting and rerun this for unrelated subscription updates.
  const subscriptions = activeProfile.value.subscriptions.map(({ id, name, thumbnail }) => {
    // Change thumbnail size to 35x35, as that's the size we display it
    // so we don't need to download a bigger image (the default is 176x176)
    thumbnail = thumbnail?.replace(/=s\d+/, '=s35')
    if (instanceUrl !== null) thumbnail = youtubeImageUrlToInvidious(thumbnail, instanceUrl)
    return { id, name, thumbnail, sortKey: name?.toLowerCase() ?? '' }
  })

  const collator = new Intl.Collator(locale.value)
  subscriptions.sort((a, b) => collator.compare(a.sortKey, b.sortKey))

  return subscriptions
})

const activeSubscriptionLimit = ref(activeSubscriptionsPerPage)

const displayedActiveSubscriptions = computed(() => {
  return activeSubscriptions.value.slice(0, activeSubscriptionLimit.value)
})

const hasMoreActiveSubscriptions = computed(() => {
  return displayedActiveSubscriptions.value.length < activeSubscriptions.value.length
})

function onActiveSubscriptionsVisibilityChanged(isVisible) {
  if (isVisible) {
    activeSubscriptionLimit.value += activeSubscriptionsPerPage
  }
}

const pinnedPlaylists = computed(() => {
  const pinnedIds = new Set(store.getters.getPinnedPlaylistIds)
  if (pinnedIds.size === 0) return []
  // Follow the order of the Playlists page, so it can be arranged there.
  return sortUserPlaylists(
    store.getters.getAllPlaylists.filter(playlist => pinnedIds.has(playlist._id)),
    store.getters.getUserPlaylistsSortBy,
    store.getters.getUserPlaylistsCustomOrder,
    new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' })
  )
})

function pinnedPlaylistThumbnail(playlist) {
  const thumbnailPreference = store.getters.getThumbnailPreference
  if (thumbnailPreference === 'hidden') return null
  if (playlist.customThumbnail) return playlist.customThumbnail
  const videoId = playlist.videos[0]?.videoId
  if (videoId == null) return null
  return getVideoThumbnailUrl(videoId, backendPreference.value, currentInvidiousInstanceUrl.value, thumbnailPreference)
}

const blurThumbnails = computed(() => store.getters.getBlurThumbnails)

/** @type {import('vue').ComputedRef<boolean>} */
const hideActiveSubscriptions = computed(() => {
  return store.getters.getHideActiveSubscriptions
})

/** @type {import('vue').ComputedRef<boolean>} */
const showWatchStats = computed(() => {
  return store.getters.getRememberHistory && store.getters.getEnableWatchStats
})

const navigationCatalog = computed(() => new Map(NAVIGATION_ITEM_DEFINITIONS.map(item => [
  item.id,
  {
    ...item,
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    label: t(item.labelKey),
    // eslint-disable-next-line @intlify/vue-i18n/no-dynamic-keys
    shortLabel: t(`Mobile Navigation.${item.id}`),
  },
])))

const visibleNavigationItems = computed(() => filterAvailableNavigationItems(
  store.getters.getNavigationItems,
  {
    supportsLocalApi: !!SUPPORTS_LOCAL_API,
    backendPreference: backendPreference.value,
    backendFallback: backendFallback.value,
    showWatchStats: showWatchStats.value,
  }
)
  .map(id => navigationCatalog.value.get(id))
  .filter(item => item != null))

const mobilePrimaryItems = computed(() => visibleNavigationItems.value.length > 5
  ? visibleNavigationItems.value.slice(0, 4)
  : visibleNavigationItems.value)
const mobilePrimaryItemIds = computed(() => new Set(mobilePrimaryItems.value.map(({ id }) => id)))
const mobileOverflowItems = computed(() => visibleNavigationItems.value.length > 5
  ? visibleNavigationItems.value.slice(4)
  : [])

/** @type {import('vue').ComputedRef<boolean>} */
const hideText = computed(() => {
  return !isOpen.value && !props.forceExpanded && store.getters.getHideLabelsSideBar
})

const applyNavIconExpand = computed(() => {
  return {
    navIconExpand: hideText.value
  }
})

const applyHiddenLabels = computed(() => {
  return {
    hiddenLabels: hideText.value
  }
})

const historyTitle = computed(() => {
  const shortcut = process.platform === 'darwin'
    ? appKeyboardShortcuts.value.NAVIGATE_TO_HISTORY_MAC
    : appKeyboardShortcuts.value.NAVIGATE_TO_HISTORY

  return localizeAndAddKeyboardShortcutToActionTitle(
    t('History.History'),
    shortcut
  )
})

// Fit visible mobile labels together so every destination has the same size.
let labelObserver
let observedLabelTexts = []
let labelFitFrame
const mobileLayout = window.matchMedia('(max-width: 680px)')

// Crossing the phone breakpoint swaps the full-width bar for the rail. Its
// width transition would otherwise resize the page over several frames.
const layoutTransitionsDisabled = ref(false)
let layoutTransitionFrame

function handleMobileLayoutChange() {
  scheduleLabelFit()
  layoutTransitionsDisabled.value = true
  cancelAnimationFrame(layoutTransitionFrame)
  layoutTransitionFrame = requestAnimationFrame(() => {
    layoutTransitionFrame = requestAnimationFrame(() => {
      layoutTransitionsDisabled.value = false
    })
  })
}

function scheduleLabelFit() {
  cancelAnimationFrame(labelFitFrame)
  labelFitFrame = requestAnimationFrame(fitNavigationLabels)
}

function fitNavigationLabels() {
  const nav = innerRef.value?.closest('.sideNav')
  if (!nav || !labelObserver) return
  const texts = [...nav.querySelectorAll('.mobileNavItem .navLabel > span')]
  if (texts.length !== observedLabelTexts.length || texts.some((text, index) => text !== observedLabelTexts[index])) {
    labelObserver.disconnect()
    labelObserver.observe(nav)
    texts.forEach(text => labelObserver.observe(text))
    observedLabelTexts = texts
  }
  if (!mobileLayout.matches) {
    nav.style.removeProperty('--fitted-nav-label-size')
    texts.forEach(text => text.parentElement.classList.remove('useShortLabel'))
    return
  }
  const labels = [...new Set(texts.map(text => text.parentElement))]
  labels.forEach(label => label.classList.remove('useShortLabel'))
  const sizes = labels.flatMap(label => {
    let text = label.querySelector('span')
    const availableWidth = label.getBoundingClientRect().width
    let textWidth = text.getBoundingClientRect().width
    if (availableWidth === 0 || textWidth === 0) return []
    const maximumSize = parseFloat(getComputedStyle(label).fontSize)
    let currentSize = parseFloat(getComputedStyle(text).fontSize)
    const shortText = label.querySelector('.shortLabel')
    if (shortText && currentSize * (availableWidth - 0.25) / textWidth < 10) {
      label.classList.add('useShortLabel')
      text = shortText
      textWidth = text.getBoundingClientRect().width
      currentSize = parseFloat(getComputedStyle(text).fontSize)
    }
    return [Math.min(maximumSize, currentSize * (availableWidth - 0.25) / textWidth)]
  })
  if (sizes.length === 0) return
  const size = `${Math.max(10, Math.floor(Math.min(...sizes) * 100) / 100)}px`
  if (nav.style.getPropertyValue('--fitted-nav-label-size') !== size) {
    nav.style.setProperty('--fitted-nav-label-size', size)
  }
}

onUpdated(scheduleLabelFit)

// ===== Bottom navigation scroll visibility =====
const innerRef = useTemplateRef('innerRef')
const scrollHidden = ref(false)
const alwaysShowNavigationBar = computed(() => store.getters.getAlwaysShowNavigationBar)
const compactNavigationLabels = computed(() => store.getters.getCompactNavigationLabels)
const navigationScroll = createMobileNavigationScroll()
let hideOnScroll = false
let scrollResumeFrame = null

function resetScrollVisibility() {
  navigationScroll.reset(window.scrollY)
  scrollHidden.value = false
}

function updateScrollLayout() {
  const nav = innerRef.value?.closest('.sideNav')
  // Resolve the CSS layout on mount/resize, not on every page scroll.
  hideOnScroll = nav != null && getComputedStyle(nav).getPropertyValue('--hide-on-scroll').trim() === '1'
  if (hideOnScroll && !alwaysShowNavigationBar.value &&
    (mobileNavigationMinimizePreview.value !== null || scrollResumeFrame !== null)) {
    navigationScroll.reset(window.scrollY, scrollHidden.value)
  } else {
    resetScrollVisibility()
  }
}

function updateScrollVisibility() {
  if (!hideOnScroll || alwaysShowNavigationBar.value || mobileNavigationMinimizePreview.value !== null || scrollResumeFrame !== null) return
  const nav = innerRef.value?.closest('.sideNav')
  if (!nav || nav.querySelector(':focus-visible, [aria-expanded="true"]')) {
    resetScrollVisibility()
    return
  }
  const page = document.scrollingElement
  scrollHidden.value = navigationScroll.update(window.scrollY, page.scrollHeight - page.clientHeight)
}
watch(() => route.fullPath, () => {
  if (mobileNavigationMinimizePreview.value === null) resetScrollVisibility()
})
watch(mobileNavigationMinimizePreview, tabId => {
  if (scrollResumeFrame !== null) cancelAnimationFrame(scrollResumeFrame)
  scrollResumeFrame = null
  if (tabId === null) {
    // History restoration and the settled bar's scroll anchoring are not user
    // scrolls. Resume after the new layout, at its actual viewport offset.
    scrollResumeFrame = requestAnimationFrame(() => {
      navigationScroll.reset(window.scrollY, scrollHidden.value)
      scrollResumeFrame = null
    })
  }
}, { flush: 'post' })
watch(alwaysShowNavigationBar, resetScrollVisibility)
watch([
  () => activeProfile.value._id,
  () => activeProfile.value.subscriptions.length
], () => {
  activeSubscriptionLimit.value = activeSubscriptionsPerPage
})

// Reconcile the real content end when rail labels or destinations disappear.
watch([isOpen, () => props.forceExpanded, hideText, visibleNavigationItems, pinnedPlaylists, pinnedChannels, hideActiveSubscriptions, displayedActiveSubscriptions], () => {
  const inner = innerRef.value
  if (inner == null || window.matchMedia('(max-width: 680px)').matches) return
  const contentEnd = [...inner.querySelectorAll(':scope > div.mobileHidden')].at(-1) ?? inner.querySelector('hr')
  clampOverlayScrollTop(inner, contentEnd)
}, { flush: 'post' })

onMounted(() => {
  labelObserver = new ResizeObserver(scheduleLabelFit)
  mobileLayout.addEventListener('change', handleMobileLayoutChange)
  scheduleLabelFit()
  updateScrollLayout()
  window.addEventListener('scroll', updateScrollVisibility, { passive: true })
  window.addEventListener('resize', updateScrollLayout)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(labelFitFrame)
  labelObserver?.disconnect()
  cancelAnimationFrame(layoutTransitionFrame)
  mobileLayout.removeEventListener('change', handleMobileLayoutChange)
  if (scrollResumeFrame !== null) cancelAnimationFrame(scrollResumeFrame)
  window.removeEventListener('scroll', updateScrollVisibility)
  window.removeEventListener('resize', updateScrollLayout)
})

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)
</script>

<style scoped src="./SideNav.css" />
<style scoped src="./DesktopNavItem.css" />
<style src="./MobileNavItem.css" />
