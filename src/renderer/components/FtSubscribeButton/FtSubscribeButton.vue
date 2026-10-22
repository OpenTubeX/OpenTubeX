<template>
  <div
    ref="subscribeButton"
    class="ftSubscribeButton"
    @focusout="handleProfileDropdownFocusOut"
  >
    <div
      ref="buttonList"
      class="buttonList"
      :style="{ anchorName: profileDropdownAnchor }"
    >
      <FtButton
        :label="subscribedText"
        :no-border="true"
        :icon="isSubscribed ? ['fas', 'check'] : null"
        class="subscribeButton"
        :class="{
          hasProfileDropdownToggle: isSubscriptionOptionsEnabled,
          dropdownOpened: isProfileDropdownOpen,
          justToggled: justToggled
        }"
        background-color="var(--primary-color)"
        text-color="var(--text-with-main-color)"
        @click="handleSubscription(activeProfile)"
      />
      <FtPrompt
        v-if="showUnsubscribePopupForProfile !== null"
        :label="$t('Channels.Unsubscribe Prompt', { channelName: channelName })"
        :option-names="[$t('Yes'), $t('No')]"
        :option-values="['yes', 'no']"
        :autosize="true"
        @click="handleUnsubscribeConfirmation"
      />
      <button
        v-if="isNotificationBellEnabled"
        type="button"
        :title="$t('Channel.Notify about new uploads')"
        :aria-label="$t('Channel.Notify about new uploads')"
        :aria-pressed="notificationsEnabled"
        class="notificationBell"
        @click="updateNotifications(!notificationsEnabled)"
      >
        <FtIcon :icon="['fas', notificationsEnabled ? 'bell' : 'bell-slash']" />
      </button>
      <button
        v-if="isSubscriptionOptionsEnabled"
        type="button"
        :title="subscriptionOptionsTitle"
        :aria-label="subscriptionOptionsTitle"
        class="profileDropdownToggle profileDropdownToggleButton"
        :class="{ dropdownOpened: isProfileDropdownOpen}"
        :aria-expanded="isProfileDropdownOpen"
        @click="toggleProfileDropdown"
      />
    </div>
    <Teleport
      v-if="isProfileDropdownOpen"
      :to="profileDropdownTarget"
    >
      <Transition
        name="profile-dropdown"
        appear
      >
        <div
          ref="profileDropdown"
          tabindex="-1"
          class="profileDropdown"
          :class="{
            profileDropdownAnchoredLeftEdge,
            profileDropdownPositioned: isProfileDropdownPositioned,
            profileDropdownOpensAbove: profileDropdownOpensAbove
          }"
          :style="profileDropdownStyle"
          @focusout="handleProfileDropdownFocusOut"
          @keydown.esc.stop.prevent="closeProfileDropdown"
        >
          <div
            ref="preferencesScroller"
            v-overlay-scrollbars
            class="feedTypePreferences"
          >
            <div ref="preferencesContent">
              <div
                v-for="group in feedTypeGroups"
                :key="group.key"
                role="group"
                class="feedTypePreferenceGroup"
                :aria-labelledby="`${id}-${group.key}`"
              >
                <p
                  :id="`${id}-${group.key}`"
                  class="feedTypePreferencesLabel"
                >
                  {{ group.label }}
                </p>
                <div class="feedTypePreferenceGrid">
                  <button
                    v-for="feedType in feedTypes"
                    :key="feedType.id"
                    type="button"
                    class="feedTypePreference"
                    role="checkbox"
                    :aria-checked="isFeedTypeChecked(feedType.id, group.key)"
                    :disabled="group.key === 'notificationFeedTypes' && !isFeedTypeChecked(feedType.id)"
                    @click="updateFeedType(feedType.id, !isFeedTypeChecked(feedType.id, group.key), group.key)"
                  >
                    <span
                      class="feedTypePreferenceIcon"
                      aria-hidden="true"
                    >
                      <FtIcon :icon="feedType.icon" />
                    </span>
                    <span>{{ feedType.label }}</span>
                    <span
                      class="feedTypePreferenceCheck"
                      aria-hidden="true"
                    >
                      <FtIcon
                        v-if="isFeedTypeChecked(feedType.id, group.key)"
                        :icon="['fas', 'check']"
                      />
                    </span>
                  </button>
                </div>
              </div>
              <div class="secondaryPreferences">
                <div
                  v-if="restrictedPlaybackConfigured"
                  class="membersOnlyPreference"
                >
                  <FtToggleSwitch
                    :label="$t('Search Listing.Label.Members Only')"
                    :default-value="activeChannelSettings.showMembersOnly"
                    compact
                    controlled
                    @change="updateShowMembersOnly"
                  />
                </div>
                <div class="dailyVideoLimitPreference">
                  <FtSelect
                    class="dailyVideoLimitSelect"
                    :value="dailyVideoLimitValue"
                    :placeholder="$t('Channel.Videos per day')"
                    :select-names="dailyVideoLimitNames"
                    :select-values="dailyVideoLimitValues"
                    :icon="['fas', 'clock']"
                    :dropdown-z-index="1002"
                    @change="updateDailyVideoLimit"
                  />
                </div>
              </div>
            </div>
          </div>
          <div
            v-if="isProfileDropdownEnabled || isGroupListEnabled"
            ref="profileDropdownScroller"
            v-overlay-scrollbars
            class="profileDropdownScroller"
          >
            <div ref="profileListContent">
              <ul
                v-if="isProfileDropdownEnabled"
                class="profileList"
              >
                <li
                  v-for="(profile, index) in profileDisplayList"
                  :key="index"
                  class="profile"
                  :aria-labelledby="id + '-' + index"
                  :aria-selected="isActiveProfile(profile)"
                  :aria-checked="isProfileSubscribed(profile)"
                  tabindex="0"
                  role="checkbox"
                  @click.stop.prevent="handleSubscription(profile)"
                  @keydown.space.stop.prevent="handleSubscription(profile)"
                >
                  <FtProfileIcon
                    class="colorOption"
                    :profile="profile"
                    :fallback="profileInitials[profile._id]"
                  />
                  <p
                    :id="id + '-' + index"
                    class="profileName"
                    dir="auto"
                  >
                    {{ profile.name }}
                  </p>
                  <span
                    class="profileCheck"
                    aria-hidden="true"
                  >
                    <FtIcon
                      v-if="isProfileSubscribed(profile)"
                      :icon="['fas', 'check']"
                    />
                  </span>
                </li>
              </ul>
              <div
                v-if="isGroupListEnabled"
                role="group"
                class="groupPreferences"
                :aria-labelledby="`${id}-groups`"
              >
                <p
                  :id="`${id}-groups`"
                  class="feedTypePreferencesLabel"
                >
                  {{ $t('Subscription Groups.Groups') }}
                </p>
                <ul class="profileList">
                  <li
                    v-for="group in subscriptionGroups"
                    :key="group.id"
                    class="profile groupOption"
                    :aria-checked="isInGroup(group)"
                    tabindex="0"
                    role="checkbox"
                    @click.stop.prevent="toggleGroup(group)"
                    @keydown.space.stop.prevent="toggleGroup(group)"
                  >
                    <p
                      class="profileName"
                      dir="auto"
                    >
                      {{ group.name }}
                    </p>
                    <span
                      class="profileCheck"
                      aria-hidden="true"
                    >
                      <FtIcon
                        v-if="isInGroup(group)"
                        :icon="['fas', 'check']"
                      />
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtProfileIcon from '../FtProfileIcon/FtProfileIcon.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../store/index'

import { MAIN_PROFILE_ID } from '../../../constants'
import { showToast } from '../../helpers/utils'
import { getFirstCharacter } from '../../helpers/strings'
import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { getAnchoredPosition, supportsAnchorPositioning } from '../../helpers/anchoredPosition'
import { useAnchoredViewportBounds } from '../../composables/useAnchoredViewportBounds'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'
import {
  formatSubscriptionDailyVideoLimit,
  getSubscriptionDailyVideoLimitOptions,
  getSubscriptionFeedTypeOptions,
  getUpdatedSubscriptionFeedTypes,
  hasSubscriptionNotifications,
  normalizeSubscriptionChannelSettings,
  parseSubscriptionDailyVideoLimit
} from '../../helpers/subscription-channels'

const { locale, t } = useI18n()

const props = defineProps({
  channelId: {
    type: String,
    required: true
  },
  channelName: {
    type: String,
    required: true
  },
  channelThumbnail: {
    type: String,
    default: null
  },
  hideProfileDropdownToggle: {
    type: Boolean,
    default: false
  },
  openDropdownOnSubscribe: {
    type: Boolean,
    default: true
  },
  subscriptionCountText: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['subscribed'])

const id = useId()
const profileDropdownAnchor = `--subscription-${id}`

/**
 * @typedef {object} Profile
 * @property {string} _id
 * @property {string} name
 * @property {string} bgColor
 * @property {string} textColor
 * @property {object[]} subscriptions
 * @property {string} subscriptions[].id
 * @property {string|undefined} subscriptions[].name
 * @property {string|undefined} subscriptions[].thumbnail
 * @property {string[]|undefined} subscriptions[].feedTypes
 * @property {number|null|undefined} subscriptions[].dailyVideoLimit
 * @property {boolean|undefined} subscriptions[].showMembersOnly
 */

/** @type {import('vue').ComputedRef<Profile[]>} */
const profileList = computed(() => {
  return store.getters.getProfileList
})

/** @type {import('vue').ComputedRef<Profile>} */
const activeProfile = computed(() => {
  return store.getters.getActiveProfile
})

const profileDisplayList = computed(() => [
  profileList.value[0],
  ...(activeProfile.value._id !== MAIN_PROFILE_ID ? [activeProfile.value] : []),
  ...profileList.value.filter((profile, i) => i !== 0 && !isActiveProfile(profile) && !isProfileSubscribed(profile)),
  ...profileList.value.filter((profile, i) => i !== 0 && !isActiveProfile(profile) && isProfileSubscribed(profile))
])

const profileInitials = computed(() => {
  const locale_ = locale.value

  return profileList.value.reduce((accumulator, profile) => {
    accumulator[profile._id] = profile.name
      ? getFirstCharacter(profile.name, locale_)
      : ''

    return accumulator
  }, {})
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideChannelSubscriptions = computed(() => {
  return store.getters.getHideChannelSubscriptions
})

const subscribedText = computed(() => {
  let subscribedValue = (isSubscribed.value ? t('Channel.Unsubscribe') : t('Channel.Subscribe'))
  if (props.subscriptionCountText !== '' && !hideChannelSubscriptions.value) {
    subscribedValue += ' ' + props.subscriptionCountText
  }
  return subscribedValue
})

const isProfileDropdownEnabled = computed(() => {
  return !props.hideProfileDropdownToggle && profileList.value.length > 1
})

/** @type {import('vue').ComputedRef<import('../../helpers/subscription-groups').SubscriptionGroup[]>} */
const subscriptionGroups = computed(() => store.getters.getSubscriptionGroupList)

const isGroupListEnabled = computed(() => {
  return !props.hideProfileDropdownToggle && subscriptionGroups.value.length > 0
})

/** @param {import('../../helpers/subscription-groups').SubscriptionGroup} group */
function isInGroup(group) {
  return group.channelIds.includes(props.channelId)
}

/** @param {import('../../helpers/subscription-groups').SubscriptionGroup} group */
async function toggleGroup(group) {
  const saved = await store.dispatch('setChannelInSubscriptionGroup', {
    groupId: group.id,
    channelId: props.channelId,
    included: !isInGroup(group)
  })
  if (!saved) {
    showToast({ message: t('Subscription Groups.Save Failed'), icon: ['fas', 'circle-exclamation'] })
  }
}

const isSubscriptionOptionsEnabled = computed(() => {
  return !props.hideProfileDropdownToggle && isSubscribed.value
})

const uploadNotificationsSupported = process.env.IS_ELECTRON || (process.env.IS_CAPACITOR && !process.env.IS_IOS)
const isNotificationBellEnabled = computed(() => (
  uploadNotificationsSupported && isSubscriptionOptionsEnabled.value
))

const isProfileDropdownOpen = ref(false)
// Content outside a fullscreen element is not rendered, so the dropdown must
// open inside the fullscreen player when the button is part of its overlay.
const profileDropdownTarget = shallowRef(document.body)
const buttonList = useTemplateRef('buttonList')
const profileDropdown = useTemplateRef('profileDropdown')
useAnchoredViewportBounds(buttonList, profileDropdown, isProfileDropdownOpen)
const preferencesScroller = useTemplateRef('preferencesScroller')
const preferencesContent = useTemplateRef('preferencesContent')
const profileDropdownScroller = useTemplateRef('profileDropdownScroller')
const profileListContent = useTemplateRef('profileListContent')
const profileDropdownStyle = ref({ left: '8px', top: '8px' })
const profileDropdownAnchoredLeftEdge = ref(false)
const isProfileDropdownPositioned = ref(false)
const profileDropdownOpensAbove = ref(false)
/** @type {import('vue').ShallowRef<Profile | null>} */
const showUnsubscribePopupForProfile = shallowRef(null)

let scrollAreaResizeObserver = null
let profileListObservationGeneration = 0
let profileDropdownPositionMutationObserver = null
let profileDropdownPositionResizeObserver = null
let profileDropdownPositionFrame = null

watch(isProfileDropdownOpen, async (open) => {
  const generation = ++profileListObservationGeneration
  stopObservingScrollAreas()
  removeProfileDropdownPositionTracking()
  if (!open) return

  await nextTick()
  if (generation !== profileListObservationGeneration ||
    !isProfileDropdownOpen.value || profileDropdown.value === null) return

  positionProfileDropdown()
  await nextTick()
  if (generation !== profileListObservationGeneration ||
    !isProfileDropdownOpen.value || profileDropdown.value === null) return

  profileDropdown.value.focus({ preventScroll: true })
  profileDropdownPositionResizeObserver = new ResizeObserver(scheduleProfileDropdownPositionUpdate)
  profileDropdownPositionResizeObserver.observe(profileDropdown.value)
  if (buttonList.value !== null) {
    profileDropdownPositionResizeObserver.observe(buttonList.value)
  }
  if (!supportsAnchorPositioning) {
    profileDropdownPositionMutationObserver = new MutationObserver((records) => {
      const dropdown = profileDropdown.value
      if (dropdown !== null && records.every(({ target }) => (
        target === dropdown || dropdown.contains(target)
      ))) return

      scheduleProfileDropdownPositionUpdate()
    })
    profileDropdownPositionMutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'hidden', 'style'],
      childList: true,
      subtree: true
    })
    window.addEventListener('scroll', scheduleProfileDropdownPositionUpdate, { capture: true, passive: true })
  }
  window.addEventListener('resize', scheduleProfileDropdownPositionUpdate)
  document.addEventListener('fullscreenchange', closeProfileDropdownOnFullscreenChange)

  // Both sections shrink in short windows; hiding or removing rows shortens them.
  const scrollAreas = [
    [preferencesScroller.value, preferencesContent.value],
    [profileDropdownScroller.value, profileListContent.value]
  ].filter(([scroller, content]) => scroller && content)
  const clampScroll = () => {
    for (const [scroller, content] of scrollAreas) clampOverlayScrollTop(scroller, content)
  }
  scrollAreaResizeObserver = new ResizeObserver(clampScroll)
  for (const [scroller, content] of scrollAreas) {
    scrollAreaResizeObserver.observe(scroller)
    scrollAreaResizeObserver.observe(content)
  }
  clampScroll()
})

// The store caches one id set per active profile, so the subscribed channels
// page does not scan the subscriptions once per button.
const isSubscribed = computed(() => store.getters.getActiveSubscribedChannelIdSet.has(props.channelId))
const restrictedPlaybackConfigured = computed(() => (
  hasConfiguredRestrictedPlaybackAuthentication(store.getters)
))

const feedTypes = computed(() => getSubscriptionFeedTypeOptions(t))

const storedChannelSettings = computed(() => {
  const subscription = profileList.value[0].subscriptions.find(channel => channel.id === props.channelId)
  return normalizeSubscriptionChannelSettings(subscription)
})

/** @type {import('vue').Ref<{feedTypes: string[], notificationFeedTypes: string[], dailyVideoLimit: number|null|undefined, showMembersOnly: boolean} | null>} */
const optimisticChannelSettings = ref(null)
const activeChannelSettings = computed(() => (
  optimisticChannelSettings.value ?? storedChannelSettings.value
))
const feedTypeGroups = computed(() => [
  { key: 'feedTypes', label: t('Channel.Show in subscription feed') },
  ...(isNotificationBellEnabled.value && notificationsEnabled.value
    ? [{ key: 'notificationFeedTypes', label: t('Channel.Notify about new uploads') }]
    : [])
])
const notificationsEnabled = computed(() => hasSubscriptionNotifications(activeChannelSettings.value))
const dailyVideoLimitValue = computed(() => (
  formatSubscriptionDailyVideoLimit(activeChannelSettings.value.dailyVideoLimit)
))
const dailyVideoLimitOptions = computed(() => getSubscriptionDailyVideoLimitOptions(t))
const dailyVideoLimitNames = computed(() => dailyVideoLimitOptions.value.map(option => option.label))
const dailyVideoLimitValues = computed(() => dailyVideoLimitOptions.value.map(option => option.value))
let channelSettingsUpdateSequence = 0
let channelSettingsUpdateQueue = Promise.resolve()

const subscriptionOptionsTitle = computed(() => t('Channel.Subscription settings'))

const justToggled = ref(false)
let justToggledTimeoutId = null

watch(isSubscribed, (subscribed) => {
  clearTimeout(justToggledTimeoutId)
  justToggled.value = true
  justToggledTimeoutId = setTimeout(() => {
    justToggled.value = false
  }, 400)

  if (subscribed) {
    optimisticChannelSettings.value = null
  } else {
    isProfileDropdownOpen.value = false
  }
})

onBeforeUnmount(() => {
  clearTimeout(justToggledTimeoutId)
  profileListObservationGeneration += 1
  stopObservingScrollAreas()
  removeProfileDropdownPositionTracking()
})

function stopObservingScrollAreas() {
  scrollAreaResizeObserver?.disconnect()
  scrollAreaResizeObserver = null
}

function positionProfileDropdown() {
  const dropdown = profileDropdown.value
  const trigger = buttonList.value
  if (dropdown === null || trigger === null) return

  // A hidden trigger, such as the Shorts overlay after leaving full window,
  // leaves nothing to anchor to.
  if (trigger.getClientRects().length === 0) {
    isProfileDropdownOpen.value = false
    return
  }

  const viewportMargin = 8
  const gap = 4
  const triggerRect = trigger.getBoundingClientRect()
  const dropdownWidth = dropdown.offsetWidth
  const dropdownHeight = dropdown.offsetHeight
  const horizontalPosition = getProfileDropdownHorizontalPosition(
    trigger,
    triggerRect,
    dropdownWidth
  )
  const below = triggerRect.bottom + gap
  const above = triggerRect.top - dropdownHeight - gap
  const maximumTop = Math.max(viewportMargin, window.innerHeight - dropdownHeight - viewportMargin)
  const opensAbove = below + dropdownHeight > window.innerHeight - viewportMargin &&
    above >= viewportMargin
  const preferredTop = opensAbove ? above : below

  profileDropdownStyle.value = getAnchoredPosition(
    profileDropdownAnchor, triggerRect, snapToDevicePixels(horizontalPosition.left), snapToDevicePixels(preferredTop), {
      minLeft: viewportMargin,
      maxLeft: Math.max(viewportMargin, window.innerWidth - dropdownWidth - viewportMargin),
      minTop: viewportMargin,
      maxTop: maximumTop
    }, { above: opensAbove, gap, bottomMargin: viewportMargin }
  )
  profileDropdownAnchoredLeftEdge.value = horizontalPosition.anchoredLeftEdge
  profileDropdownOpensAbove.value = opensAbove
  isProfileDropdownPositioned.value = true
}

function prepareProfileDropdownPosition() {
  const trigger = buttonList.value
  if (trigger === null) return

  const viewportMargin = 8
  const dropdownWidth = Math.min(240, window.innerWidth - 2 * viewportMargin)
  const triggerRect = trigger.getBoundingClientRect()
  const horizontalPosition = getProfileDropdownHorizontalPosition(
    trigger,
    triggerRect,
    dropdownWidth
  )

  profileDropdownStyle.value = {
    left: `${snapToDevicePixels(Math.max(viewportMargin, Math.min(horizontalPosition.left, window.innerWidth - dropdownWidth - viewportMargin)))}px`,
    top: `${snapToDevicePixels(Math.max(viewportMargin, triggerRect.bottom + 4))}px`
  }
  profileDropdownAnchoredLeftEdge.value = horizontalPosition.anchoredLeftEdge
  profileDropdownOpensAbove.value = false
  isProfileDropdownPositioned.value = false
}

/**
 * @param {HTMLElement} trigger
 * @param {DOMRect} triggerRect
 * @param {number} dropdownWidth
 */
function getProfileDropdownHorizontalPosition(trigger, triggerRect, dropdownWidth) {
  const anchoredLeftEdge = getComputedStyle(trigger).direction === 'rtl'
  const preferredLeft = anchoredLeftEdge
    ? triggerRect.left
    : triggerRect.right - dropdownWidth

  return {
    anchoredLeftEdge,
    left: preferredLeft
  }
}

/**
 * @param {number} value
 */
function snapToDevicePixels(value) {
  const ratio = window.devicePixelRatio || 1
  return Math.round(value * ratio) / ratio
}

function scheduleProfileDropdownPositionUpdate() {
  if (profileDropdownPositionFrame !== null) {
    cancelAnimationFrame(profileDropdownPositionFrame)
  }

  profileDropdownPositionFrame = requestAnimationFrame(() => {
    profileDropdownPositionFrame = null
    positionProfileDropdown()
  })
}

// The dropdown's teleport target only matches the fullscreen state it opened in.
function closeProfileDropdownOnFullscreenChange() {
  isProfileDropdownOpen.value = false
}

function removeProfileDropdownPositionTracking() {
  window.removeEventListener('resize', scheduleProfileDropdownPositionUpdate)
  document.removeEventListener('fullscreenchange', closeProfileDropdownOnFullscreenChange)
  window.removeEventListener('scroll', scheduleProfileDropdownPositionUpdate, true)
  profileDropdownPositionMutationObserver?.disconnect()
  profileDropdownPositionMutationObserver = null
  profileDropdownPositionResizeObserver?.disconnect()
  profileDropdownPositionResizeObserver = null

  if (profileDropdownPositionFrame !== null) {
    cancelAnimationFrame(profileDropdownPositionFrame)
    profileDropdownPositionFrame = null
  }
}

/**
 * @param {FocusEvent} event
 */
function handleProfileDropdownFocusOut(event) {
  const nextTarget = event.relatedTarget
  const focusStaysInControl = nextTarget instanceof Node && (
    subscribeButton.value?.contains(nextTarget) ||
    profileDropdown.value?.contains(nextTarget)
  )

  if (!focusStaysInControl) isProfileDropdownOpen.value = false
}

/**
 * @param {Profile} profile
 */
function handleSubscription(profile) {
  if (props.channelId === '') {
    return
  }

  if (isProfileSubscribed(profile)) {
    if (store.getters.getUnsubscriptionPopupStatus) {
      showUnsubscribePopupForProfile.value = profile
    } else {
      handleUnsubscription(profile)
    }
  } else {
    const profileIds = [profile._id]

    if (profile._id !== MAIN_PROFILE_ID) {
      const primaryProfile = profileList.value.find(prof => {
        return prof._id === MAIN_PROFILE_ID
      })

      if (!isProfileSubscribed(primaryProfile)) {
        profileIds.push(MAIN_PROFILE_ID)
      }
    }

    const channel = {
      id: props.channelId,
      name: props.channelName,
      thumbnail: props.channelThumbnail,
      feedTypes: [...activeChannelSettings.value.feedTypes],
      notificationFeedTypes: [...activeChannelSettings.value.notificationFeedTypes],
      showMembersOnly: activeChannelSettings.value.showMembersOnly
    }
    if (activeChannelSettings.value.dailyVideoLimit !== undefined) {
      channel.dailyVideoLimit = activeChannelSettings.value.dailyVideoLimit
    }

    store.dispatch('addChannelToProfiles', {
      channel,
      profileIds
    })

    showToast({ message: t('Channel.Added channel to your subscriptions'), icon: ['fas', 'subscriptions'] })
    emit('subscribed')
  }

  if ((isProfileDropdownEnabled.value || isGroupListEnabled.value) && props.openDropdownOnSubscribe && !isProfileDropdownOpen.value) {
    toggleProfileDropdown()
  }
}

const subscribeButton = useTemplateRef('subscribeButton')

function toggleProfileDropdown() {
  if (isProfileDropdownOpen.value) {
    isProfileDropdownOpen.value = false
  } else {
    profileDropdownTarget.value = subscribeButton.value?.closest(':fullscreen') ?? document.body
    prepareProfileDropdownPosition()
    isProfileDropdownOpen.value = true
  }
}

function closeProfileDropdown() {
  isProfileDropdownOpen.value = false
  nextTick(() => {
    subscribeButton.value?.querySelector('.profileDropdownToggle')?.focus({ preventScroll: true })
  })
}

/**
 * Only fetched feed types can notify.
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {'feedTypes' | 'notificationFeedTypes'} [key]
 */
function isFeedTypeChecked(feedType, key = 'feedTypes') {
  const { feedTypes, notificationFeedTypes } = activeChannelSettings.value
  return feedTypes.includes(feedType) &&
    (key === 'feedTypes' || notificationFeedTypes.includes(feedType))
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'posts'} feedType
 * @param {boolean} enabled
 * @param {'feedTypes' | 'notificationFeedTypes'} [key]
 */
function updateFeedType(feedType, enabled, key = 'feedTypes') {
  const patch = {
    [key]: getUpdatedSubscriptionFeedTypes(
      activeChannelSettings.value[key],
      feedType,
      enabled
    )
  }
  // The notification group hides with its focused checkbox, which would close the dropdown.
  if (key === 'notificationFeedTypes' && !hasSubscriptionNotifications({ ...activeChannelSettings.value, ...patch })) {
    profileDropdown.value?.focus({ preventScroll: true })
  }
  persistChannelSettings(patch)
}

/**
 * Turning notifications on starts with every feed type.
 * @param {boolean} enabled
 */
function updateNotifications(enabled) {
  persistChannelSettings({
    notificationFeedTypes: enabled ? feedTypes.value.map(feedType => feedType.id) : []
  })
}

/**
 * @param {string} value
 */
function updateDailyVideoLimit(value) {
  persistChannelSettings({
    dailyVideoLimit: parseSubscriptionDailyVideoLimit(value)
  })
}

/**
 * @param {boolean} value
 */
function updateShowMembersOnly(value) {
  persistChannelSettings({ showMembersOnly: value })
}

/**
 * @param {{feedTypes?: string[], notificationFeedTypes?: string[], dailyVideoLimit?: number|null|undefined, showMembersOnly?: boolean}} patch
 */
function persistChannelSettings(patch) {
  const settings = {
    ...activeChannelSettings.value,
    ...patch
  }
  const updateSequence = ++channelSettingsUpdateSequence
  optimisticChannelSettings.value = settings
  if (!isSubscribed.value) return

  channelSettingsUpdateQueue = channelSettingsUpdateQueue.then(async () => {
    let saved = false
    try {
      saved = await store.dispatch('updateChannelSettings', {
        channelId: props.channelId,
        settings: patch
      })
    } catch (error) {
      console.error(error)
    } finally {
      if (updateSequence === channelSettingsUpdateSequence) {
        optimisticChannelSettings.value = null
      }
      if (!saved) {
        showToast({
          message: t('Channel.Failed to save subscription settings'),
          icon: ['fas', 'circle-exclamation']
        })
      }
    }
  })
}

/**
 * @param {'yes' | 'no' | null} value
 */
function handleUnsubscribeConfirmation(value) {
  const profile = showUnsubscribePopupForProfile.value
  showUnsubscribePopupForProfile.value = null

  if (value === 'yes') {
    handleUnsubscription(profile)
  }
}

/**
 * @param {Profile} profile
 */
function handleUnsubscription(profile) {
  const profileIds = [profile._id]

  if (profile._id === MAIN_PROFILE_ID) {
    // Check if a subscription exists in a different profile.
    // Remove from there as well.

    profileList.value.forEach((profileInList) => {
      if (profileInList._id === MAIN_PROFILE_ID) {
        return
      }

      if (isProfileSubscribed(profileInList)) {
        profileIds.push(profileInList._id)
      }
    })
  }

  store.dispatch('removeChannelFromProfiles', { channelId: props.channelId, profileIds })

  showToast({ message: t('Channel.Channel has been removed from your subscriptions'), icon: ['fas', 'trash'] })

  if (profile._id === MAIN_PROFILE_ID && profileIds.length > 1) {
    showToast({
      message: t('Channel.Removed subscription from {count} other channel(s)', { count: profileIds.length - 1 }, profileIds.length - 1),
      icon: ['fas', 'trash'],
    })
  }
}

/**
 * @param {Profile} profile
 */
function isActiveProfile(profile) {
  return profile._id === activeProfile.value._id
}

/**
 * @param {Profile} profile
 */
function isProfileSubscribed(profile) {
  const channelId = props.channelId

  return profile.subscriptions.some((channel) => channel.id === channelId)
}
</script>

<style scoped src="./FtSubscribeButton.css" />
