<template>
  <FtFlexBox
    class="sideNav"
    :class="[{ opened: isOpen, expanded: isOpen || props.forceExpanded, scrollHidden, compactLabels: compactNavigationLabels }, applyHiddenLabels]"
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
        <NavLabel :label="item.label" />
      </router-link>
      <SideNavMoreOptions
        v-if="mobileOverflowItems.length > 0"
        :items="mobileOverflowItems"
        :class="{ compactLabels: compactNavigationLabels }"
      />
      <hr>
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
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import SideNavMoreOptions from '../SideNavMoreOptions/SideNavMoreOptions.vue'

import store from '../../store/index'

import { youtubeImageUrlToInvidious } from '../../helpers/api/invidious'
import { filterAvailableNavigationItems } from '../../../navigationAvailability'
import { deepCopy, localizeAndAddKeyboardShortcutToActionTitle } from '../../helpers/utils'
import { getConfiguredKeyboardShortcuts } from '../../../constants'
import { NAVIGATION_ITEM_DEFINITIONS } from '../../../navigationItems'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { createMobileNavigationScroll, mobileNavigationMinimizePreview } from '../../helpers/mobileNavigationScroll'

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

const activeSubscriptions = computed(() => {
  /** @type {any[]} */
  const subscriptions = deepCopy(activeProfile.value.subscriptions)

  subscriptions.forEach(channel => {
    // Change thumbnail size to 35x35, as that's the size we display it
    // so we don't need to download a bigger image (the default is 176x176)
    channel.thumbnail = channel.thumbnail?.replace(/=s\d+/, '=s35')
  })

  const locale_ = locale.value
  subscriptions.sort((a, b) => {
    return a.name?.toLowerCase().localeCompare(b.name?.toLowerCase(), locale_)
  })

  if (backendPreference.value === 'invidious') {
    const instanceUrl = currentInvidiousInstanceUrl.value

    subscriptions.forEach((channel) => {
      channel.thumbnail = youtubeImageUrlToInvidious(channel.thumbnail, instanceUrl)
    })
  }

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
    return
  }
  const sizes = texts.flatMap(text => {
    const label = text.parentElement
    const availableWidth = label.getBoundingClientRect().width
    const textWidth = text.getBoundingClientRect().width
    if (availableWidth === 0 || textWidth === 0) return []
    const maximumSize = parseFloat(getComputedStyle(label).fontSize)
    const currentSize = parseFloat(getComputedStyle(text).fontSize)
    return [Math.min(maximumSize, currentSize * (availableWidth - 0.25) / textWidth)]
  })
  if (sizes.length === 0) return
  const size = `${Math.floor(Math.min(...sizes) * 100) / 100}px`
  if (nav.style.getPropertyValue('--fitted-nav-label-size') !== size) {
    nav.style.setProperty('--fitted-nav-label-size', size)
  }
}

onUpdated(scheduleLabelFit)

// ===== Bottom navigation scroll visibility =====
const route = useRoute()
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
watch([isOpen, () => props.forceExpanded, hideText, visibleNavigationItems, hideActiveSubscriptions, displayedActiveSubscriptions], () => {
  const inner = innerRef.value
  if (inner == null || window.matchMedia('(max-width: 680px)').matches) return
  const contentEnd = inner.querySelector(':scope > div.mobileHidden') ?? inner.querySelector('hr')
  clampOverlayScrollTop(inner, contentEnd)
}, { flush: 'post' })

onMounted(() => {
  labelObserver = new ResizeObserver(scheduleLabelFit)
  mobileLayout.addEventListener('change', scheduleLabelFit)
  scheduleLabelFit()
  updateScrollLayout()
  window.addEventListener('scroll', updateScrollVisibility, { passive: true })
  window.addEventListener('resize', updateScrollLayout)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(labelFitFrame)
  labelObserver?.disconnect()
  mobileLayout.removeEventListener('change', scheduleLabelFit)
  if (scrollResumeFrame !== null) cancelAnimationFrame(scrollResumeFrame)
  window.removeEventListener('scroll', updateScrollVisibility)
  window.removeEventListener('resize', updateScrollLayout)
})

const enableChannelLinks = computed(() => !store.getters.getDisableChannelLinks)
</script>

<style scoped src="./SideNav.css" />
<style scoped src="./DesktopNavItem.css" />
<style src="./MobileNavItem.css" />
