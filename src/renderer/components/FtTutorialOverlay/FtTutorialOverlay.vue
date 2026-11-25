<template>
  <Teleport to=".app">
    <div
      class="tutorialOverlay"
      :class="{ centered: targetRect === null }"
      role="presentation"
      @keydown="handleKeydown"
    >
      <div
        v-if="targetRect"
        class="tutorialHighlight"
        :style="highlightStyle"
        aria-hidden="true"
      />
      <FtCard
        ref="cardRef"
        class="tutorialCard"
        :class="{ tutorialWideCard: step.id === 'preferences' || currentSubpage !== null, tutorialFlushCard: currentSubpage?.flush }"
        :style="cardStyle"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="currentSubpage ? subpageTitleId : titleId"
        :aria-describedby="currentSubpage ? null : descriptionId"
      >
        <div
          v-show="currentSubpage === null"
          class="tutorialStepHeader"
        >
          <FtIconButton
            class="tutorialSkip"
            :title="t('Tutorial.Skip')"
            :icon="['fas', 'xmark']"
            :padding="8"
            :size="18"
            @click="finishTutorial"
          />
          <div
            class="tutorialProgress"
            aria-hidden="true"
          >
            <span
              v-for="(_, index) in steps"
              :key="index"
              :class="{ active: index === stepIndex }"
            />
          </div>
          <div
            class="tutorialIcon"
            aria-hidden="true"
          >
            <FtIcon :icon="step.icon" />
          </div>
          <h2
            :id="titleId"
            ref="titleRef"
            tabindex="-1"
          >
            {{ step.title }}
          </h2>
        </div>
        <!-- Settings pages opened from a step, like the theme gallery, replace
             it in the card until Back or Done returns to the step. -->
        <div
          v-show="currentSubpage !== null"
          class="tutorialSubpageHeader"
        >
          <FtIconButton
            :title="t('Back')"
            :icon="['fas', 'arrow-left']"
            :padding="8"
            :size="18"
            @click="closeSubpagesFrom(subpageStack.length - 1)"
          />
          <h2
            :id="subpageTitleId"
            ref="subpageTitleRef"
            tabindex="-1"
          >
            {{ currentSubpage?.title }}
          </h2>
          <span
            :id="subpageBreadcrumbTargetId"
            class="tutorialSubpageAction"
          />
        </div>
        <div
          ref="scrollRef"
          v-overlay-scrollbars
          class="tutorialScroll settingsSubpageScroll"
          :class="{ tutorialFlushScroll: currentSubpage?.flush }"
        >
          <div
            v-show="currentSubpage !== null"
            :id="subpageTargetId"
            ref="subpageRef"
            class="tutorialSubpage"
          />
          <div
            v-show="currentSubpage === null"
            ref="contentRef"
            class="tutorialContent"
          >
            <p :id="descriptionId">
              {{ step.description }}
            </p>
            <div
              v-if="step.id === 'preferences'"
              class="tutorialPreferences"
            >
              <ThemeModePicker />
              <ThemeGallery />
              <div class="tutorialSelectRow">
                <FtSelect
                  size-to-content
                  :placeholder="t('Settings.General Settings.Default Landing Page')"
                  :value="landingPage"
                  setting-key="landingPage"
                  :select-names="landingPageNames"
                  :select-values="landingPageValues"
                  :option-icons="landingPageIcons"
                  :icon="['fas', 'location-dot']"
                  @change="updateSetting('LandingPage', $event)"
                />
                <FtSelect
                  v-if="regionValues.length > 0"
                  size-to-content
                  :placeholder="t('Settings.General Settings.Region for Trending')"
                  :value="region"
                  setting-key="region"
                  :select-names="regionNames"
                  :select-values="regionValues"
                  :icon="['fas', 'globe']"
                  @change="updateSetting('Region', $event)"
                />
              </div>
            </div>
            <div
              v-if="step.id === 'playback'"
              class="tutorialControls"
            >
              <FtSelect
                :placeholder="t('Settings.Player Settings.Default Quality.Default Quality')"
                :value="defaultQuality"
                setting-key="defaultQuality"
                :select-names="qualityNames"
                :select-values="qualityValues"
                :icon="['fas', 'photo-film']"
                @change="updateSetting('DefaultQuality', $event)"
              />
              <div class="tutorialSwitches">
                <FtToggleSwitch
                  v-for="toggle in playbackToggles"
                  :key="toggle.settingKey"
                  :label="toggle.label"
                  :tooltip="toggle.tooltip"
                  :default-value="store.getters[`get${toggle.action}`]"
                  :disabled="toggle.disabled"
                  :setting-key="toggle.settingKey"
                  compact
                  @change="updateSetting(toggle.action, $event)"
                />
              </div>
            </div>
            <div
              v-if="step.id === 'tabs'"
              class="tutorialControls"
            >
              <FtSelect
                :placeholder="t('Settings.Theme Settings.Tab Layout.Tab Layout')"
                :value="tabBarPosition"
                setting-key="tabBarPosition"
                :select-names="tabBarPositionNames"
                :select-values="TAB_BAR_POSITIONS"
                :icon="['fac', 'horizontal-tabs']"
                @change="updateTabBarPosition"
              />
            </div>
            <div
              v-if="step.id === 'welcome'"
              class="tutorialActions tutorialChoices"
            >
              <FtButton
                ref="primaryButtonRef"
                :label="t('Tutorial.Welcome.Start Fresh')"
                :icon="['fas', 'arrow-right']"
                @click="advanceTutorial"
              />
              <FtButton
                :label="t('Tutorial.Welcome.Import Data')"
                :text-color="null"
                :background-color="null"
                :icon="['fas', 'database']"
                @click="showImport = true"
              />
              <FtSettingsSubpage
                :open="showImport"
                :title="t('Tutorial.Welcome.Import Data')"
                :icon="['fas', 'database']"
                grow-with-content
                @close="showImport = false"
              >
                <DataSettings import-only />
              </FtSettingsSubpage>
            </div>
            <div
              v-else
              class="tutorialActions"
            >
              <FtButton
                :label="t('Back')"
                :icon="['fas', 'arrow-left']"
                :text-color="null"
                :background-color="null"
                @click="retreatTutorial"
              />
              <FtButton
                ref="primaryButtonRef"
                :label="primaryButtonLabel"
                :icon="isLastStep ? ['fas', 'check'] : ['fas', 'arrow-right']"
                @click="advanceTutorial"
              />
            </div>
          </div>
        </div>
        <!-- Flush pages, like the theme editor, bring their own actions. -->
        <div
          v-show="currentSubpage !== null && !currentSubpage.flush"
          class="tutorialActions tutorialSubpageActions"
        >
          <!-- Importing is the welcome step's choice, so finishing it continues the tutorial -->
          <FtButton
            :label="showImport ? t('Tutorial.Next') : t('Tutorial.Done')"
            :icon="showImport ? ['fas', 'arrow-right'] : ['fas', 'check']"
            @click="finishSubpages"
          />
        </div>
      </FtCard>
    </div>
  </Teleport>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import store from '../../store/index'
import { normalizeTabBarPosition, TAB_BAR_POSITIONS } from '../../constants/tabBarPosition'
import { getAutoQualityFallback, playbackEngineSupportsAutoQuality } from '../../helpers/player/autoQuality'
import { clampOverlayScrollTop, restoreOverlayScrollTop } from '../../helpers/overlayScrollbars'
import { useLandingPageOptions } from '../../composables/useLandingPageOptions'

import FtButton from '../FtButton/FtButton.vue'
import FtCard from '../ft-card/ft-card.vue'
import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtSelect from '../FtSelect/FtSelect.vue'
import FtSettingsSubpage from '../FtSettingsSubpage/FtSettingsSubpage.vue'
import { settingsSubpageKey } from '../FtSettingsSubpage/settingsSubpage'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import ThemeGallery from '../Settings/Appearance/ThemeGallery.vue'
import ThemeModePicker from '../Settings/Appearance/ThemeModePicker.vue'
import { lockBodyScroll, unlockBodyScroll } from '../FtPrompt/scrollLock'

const props = defineProps({
  initialStep: { type: Number, default: 0 }
})

const DataSettings = defineAsyncComponent(() => import('../Settings/Data/DataSettings.vue'))

const emit = defineEmits(['close'])

const IS_ELECTRON = process.env.IS_ELECTRON

const { t } = useI18n()
const titleId = useId()
const descriptionId = useId()
const subpageTitleId = useId()
const subpageTargetId = `tutorial-subpage-${useId().replaceAll(':', '')}`
const subpageBreadcrumbTargetId = `tutorial-subpage-breadcrumb-${useId().replaceAll(':', '')}`
const promptId = useId()
const cardRef = useTemplateRef('cardRef')
const primaryButtonRef = useTemplateRef('primaryButtonRef')
const titleRef = useTemplateRef('titleRef')
const subpageTitleRef = useTemplateRef('subpageTitleRef')
const scrollRef = useTemplateRef('scrollRef')
const contentRef = useTemplateRef('contentRef')
const subpageRef = useTemplateRef('subpageRef')
const stepIndex = ref(props.initialStep)
const targetRect = ref(null)
const cardStyle = ref({})
let updateFrame = null
let lastActiveElement = null
let contentResizeObserver = null
let targetResizeObserver = null
let observedTarget = null

const showImport = ref(false)

/**
 * Settings pages that a step opens, like the theme gallery, show in the card
 * instead of the settings window. Each entry keeps its parent's scroll offset.
 * Flush pages, like theme discovery, scroll on their own.
 * @type {import('vue').ShallowRef<{ title: string, icon: string[] | null, flush: boolean, close: () => void, scrollTop: number }[]>}
 */
const subpageStack = shallowRef([])
const currentSubpage = computed(() => subpageStack.value.at(-1) ?? null)

provide(settingsSubpageKey, {
  isActive: computed(() => true),
  targetId: subpageTargetId,
  breadcrumbTargetId: subpageBreadcrumbTargetId,
  isCurrent: close => currentSubpage.value?.close === close,
  open(title, close, icon = null, flush = false) {
    const stack = subpageStack.value
    const index = stack.findIndex(entry => entry.close === close)
    if (index !== -1) {
      subpageStack.value = stack.with(index, { ...stack[index], title, icon, flush })
      return
    }
    subpageStack.value = [...stack, { title, icon, flush, close, scrollTop: scrollRef.value?.scrollTop ?? 0 }]
    showSubpage(0)
  },
  close(close) {
    const index = subpageStack.value.findIndex(entry => entry.close === close)
    if (index !== -1) closeSubpagesFrom(index, true)
  }
})

/**
 * Removes the subpages from `depth` on and asks them to close. `closedSelf`
 * skips the one at `depth`, which is already closing.
 */
function closeSubpagesFrom(depth, closedSelf = false) {
  if (depth < 0 || depth >= subpageStack.value.length) return

  const closing = subpageStack.value.slice(depth + (closedSelf ? 1 : 0))
  const { scrollTop } = subpageStack.value[depth]
  subpageStack.value = subpageStack.value.slice(0, depth)
  closing.reverse().forEach(({ close }) => close())
  showSubpage(scrollTop)
}

function finishSubpages() {
  const continueTutorial = showImport.value
  closeSubpagesFrom(0)
  if (continueTutorial) advanceTutorial()
}

async function showSubpage(scrollTop) {
  await nextTick()
  if (scrollRef.value) restoreOverlayScrollTop(scrollRef.value, scrollTop)
  clampTutorialScroll()
  await updatePosition()
  const heading = currentSubpage.value === null ? titleRef.value : subpageTitleRef.value
  heading?.focus()
}

const RESOLUTION_VALUES = ['2160', '1440', '1080', '720', '480', '360', '240', '144']

const steps = computed(() => [
  {
    id: 'welcome',
    icon: ['fas', 'play'],
    title: t('Tutorial.Welcome.Title'),
    description: t('Tutorial.Welcome.Description'),
    target: null
  },
  {
    id: 'preferences',
    icon: ['fas', 'palette'],
    title: t('Tutorial.Preferences.Title'),
    description: t('Tutorial.Preferences.Description'),
    target: null
  },
  {
    id: 'playback',
    icon: ['fas', 'circle-play'],
    title: t('Tutorial.Playback.Title'),
    description: t('Tutorial.Playback.Description'),
    target: null
  },
  {
    id: 'navigation',
    icon: ['fas', 'rss'],
    title: t('Tutorial.Navigation.Title'),
    description: t('Tutorial.Navigation.Description'),
    // Watch pages can slide the side bar out of view; the menu button opens it there
    target: ['[data-tutorial="navigation"]', '[data-tutorial="navigation-toggle"]']
  },
  {
    id: 'search',
    icon: ['fas', 'search'],
    title: t('Tutorial.Search.Title'),
    description: t('Tutorial.Search.Description'),
    target: '.searchContainer[data-tutorial="search"] .ft-input, .navSearchButton[data-tutorial="search"]'
  },
  ...(IS_ELECTRON
    ? [{
        id: 'tabs',
        icon: ['fas', 'clone'],
        title: t('Tutorial.Tabs.Title'),
        description: t('Tutorial.Tabs.Description'),
        target: '[data-tutorial="tabs"]'
      }]
    : []),
  {
    id: 'profile',
    icon: ['fas', 'sliders-h'],
    title: t('Tutorial.Profile Menu.Title'),
    description: process.env.IS_CAPACITOR ? t('Tutorial.Profile Menu.Touch Description') : t('Tutorial.Profile Menu.Description'),
    target: '[data-tutorial="quick-settings"]'
  }
])

const step = computed(() => steps.value[stepIndex.value])
const isLastStep = computed(() => stepIndex.value === steps.value.length - 1)
const primaryButtonLabel = computed(() => {
  return isLastStep.value ? t('Tutorial.Finish') : t('Tutorial.Next')
})
const tabBarPositionNames = computed(() => [
  t('Settings.Theme Settings.Tab Layout.Horizontal Top'),
  t('Settings.Theme Settings.Tab Layout.Horizontal Bottom'),
  t('Settings.Theme Settings.Tab Layout.Vertical Left'),
  t('Settings.Theme Settings.Tab Layout.Vertical Right')
])
const tabBarPosition = computed(() => normalizeTabBarPosition(store.getters.getTabBarPosition))
const autoQualityAvailable = computed(() => playbackEngineSupportsAutoQuality(store.getters.getVideoPlaybackEngine, store.getters.getBuiltInStreams))
const qualityValues = computed(() => autoQualityAvailable.value ? [...RESOLUTION_VALUES, 'auto'] : RESOLUTION_VALUES)
const qualityNames = computed(() => [
  t('Settings.Player Settings.Default Quality.4k'),
  t('Settings.Player Settings.Default Quality.1440p'),
  t('Settings.Player Settings.Default Quality.1080p'),
  t('Settings.Player Settings.Default Quality.720p'),
  t('Settings.Player Settings.Default Quality.480p'),
  t('Settings.Player Settings.Default Quality.360p'),
  t('Settings.Player Settings.Default Quality.240p'),
  t('Settings.Player Settings.Default Quality.144p'),
  ...(autoQualityAvailable.value ? [t('Settings.Player Settings.Default Quality.Auto')] : [])
])
const { landingPageNames, landingPageValues, landingPageIcons } = useLandingPageOptions()
const landingPage = computed(() => store.getters.getLandingPage)
const regionNames = computed(() => store.getters.getRegionNames)
const regionValues = computed(() => store.getters.getRegionValues)
const region = computed(() => store.getters.getRegion)

// Each action names both the store getter (get<Action>) and its update action (update<Action>)
const playbackToggles = computed(() => [
  {
    settingKey: 'playNextVideo',
    action: 'PlayNextVideo',
    label: t('Settings.Player Settings.Play Next Video'),
    disabled: store.getters.getHideRecommendedVideos
  },
  { settingKey: 'enableSubtitlesByDefault', action: 'EnableSubtitlesByDefault', label: t('Settings.Player Settings.Turn on Subtitles by Default') },
  { settingKey: 'rememberHistory', action: 'RememberHistory', label: t('Settings.Privacy Settings.Remember History') },
  { settingKey: 'useSponsorBlock', action: 'UseSponsorBlock', label: t('Settings.SponsorBlock Settings.Enable SponsorBlock') },
  {
    settingKey: 'useDeArrowTitles',
    action: 'UseDeArrowTitles',
    label: t('Settings.SponsorBlock Settings.UseDeArrowTitles'),
    tooltip: t('Tooltips.SponsorBlock Settings.UseDeArrowTitles')
  },
  {
    settingKey: 'useDeArrowThumbnails',
    action: 'UseDeArrowThumbnails',
    label: t('Settings.SponsorBlock Settings.UseDeArrowThumbnails'),
    tooltip: t('Tooltips.SponsorBlock Settings.UseDeArrowThumbnails')
  }
].map(toggle => ({ tooltip: '', disabled: false, ...toggle })))

const defaultQuality = computed(() => {
  const value = store.getters.getDefaultQuality
  return value === 'auto' && !autoQualityAvailable.value ? getAutoQualityFallback() : value
})

// The tabs step highlights the tab bar, which moves when its layout changes
watch(tabBarPosition, schedulePositionUpdate, { flush: 'post' })

const highlightStyle = computed(() => {
  if (targetRect.value === null) return {}

  return {
    insetBlockStart: `${targetRect.value.top}px`,
    left: `${targetRect.value.left}px`,
    inlineSize: `${targetRect.value.width}px`,
    blockSize: `${targetRect.value.height}px`
  }
})

function focusPrimaryButton() {
  primaryButtonRef.value?.$el.focus()
}

onMounted(() => {
  lastActiveElement = document.activeElement
  lockBodyScroll()
  store.commit('addOpenPrompt', promptId)
  window.addEventListener('resize', schedulePositionUpdate)
  window.addEventListener('scroll', schedulePositionUpdate, true)
  document.addEventListener('keydown', handleDocumentKeydown, true)
  document.addEventListener('startup-splash-hidden', focusPrimaryButton)
  updatePosition()
  nextTick(() => {
    focusPrimaryButton()
    observeTutorialContent()
  })
})

onBeforeUnmount(() => {
  if (updateFrame !== null) cancelAnimationFrame(updateFrame)
  window.removeEventListener('resize', schedulePositionUpdate)
  window.removeEventListener('scroll', schedulePositionUpdate, true)
  document.removeEventListener('keydown', handleDocumentKeydown, true)
  document.removeEventListener('startup-splash-hidden', focusPrimaryButton)
  contentResizeObserver?.disconnect()
  targetResizeObserver?.disconnect()
  store.commit('removeOpenPrompt', promptId)
  unlockBodyScroll()
  nextTick(() => lastActiveElement?.focus({ preventScroll: true }))
})

function schedulePositionUpdate() {
  if (updateFrame !== null) cancelAnimationFrame(updateFrame)
  updateFrame = requestAnimationFrame(() => {
    updateFrame = null
    updatePosition()
  })
}

function clampTutorialScroll() {
  // Hidden subpages and the hidden step leave only the shown view in the viewport
  const content = currentSubpage.value === null ? contentRef.value : subpageRef.value
  if (scrollRef.value && content) {
    clampOverlayScrollTop(scrollRef.value, content)
  }
}

function observeTutorialContent() {
  contentResizeObserver?.disconnect()
  if (!contentRef.value) return

  contentResizeObserver = new ResizeObserver(clampTutorialScroll)
  contentResizeObserver.observe(contentRef.value)
  contentResizeObserver.observe(subpageRef.value)
  clampTutorialScroll()
}

function observeTarget(target) {
  if (observedTarget === target) return

  targetResizeObserver?.disconnect()
  observedTarget = target

  if (target) {
    targetResizeObserver ??= new ResizeObserver(schedulePositionUpdate)
    targetResizeObserver.observe(target)
  }
}

/**
 * Whether the element takes up space and isn't hidden, like the side bar that watch pages slide out of view
 * @param {Element} element
 */
function isTargetVisible(element) {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && element.checkVisibility?.({ visibilityProperty: true }) !== false
}

/** Returns the first visible match, trying the step's selectors in priority order */
function findTarget(selectors) {
  for (const selector of [selectors].flat()) {
    const target = Array.from(document.querySelectorAll(selector)).find(isTargetVisible)
    if (target) return target
  }
  return null
}

async function updatePosition() {
  const target = step.value.target === null ? null : findTarget(step.value.target)
  observeTarget(target)
  const rect = target?.getBoundingClientRect()
  targetRect.value = rect
    ? {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      }
    : null

  cardStyle.value = {}
  await nextTick()

  if (targetRect.value === null) return

  const card = cardRef.value?.$el
  if (!card) return

  const cardRect = card.getBoundingClientRect()
  const gap = 14
  const cardViewportPadding = 12
  const availableOnRight = window.innerWidth - targetRect.value.left - targetRect.value.width
  const availableOnLeft = targetRect.value.left
  const minimumSideCardWidth = 240
  const placeBesideTarget = targetRect.value.height > window.innerHeight / 2 &&
    Math.max(availableOnLeft, availableOnRight) - gap - cardViewportPadding >= minimumSideCardWidth

  if (placeBesideTarget) {
    const placeOnRight = availableOnRight >= availableOnLeft
    const availableWidth = (placeOnRight ? availableOnRight : availableOnLeft) - gap - cardViewportPadding
    const width = Math.min(cardRect.width, availableWidth)
    const left = placeOnRight
      ? targetRect.value.left + targetRect.value.width + gap
      : targetRect.value.left - gap - width

    cardStyle.value = {
      inlineSize: `${width}px`,
      left: `${left}px`
    }
    await nextTick()

    const resizedCardRect = card.getBoundingClientRect()
    const top = Math.min(
      window.innerHeight - resizedCardRect.height - cardViewportPadding,
      Math.max(
        cardViewportPadding,
        targetRect.value.top + targetRect.value.height / 2 - resizedCardRect.height / 2
      )
    )
    cardStyle.value = {
      ...cardStyle.value,
      insetBlockStart: `${top}px`
    }
    return
  }

  const availableBelow = window.innerHeight - targetRect.value.top - targetRect.value.height
  const top = availableBelow >= cardRect.height + gap
    ? targetRect.value.top + targetRect.value.height + gap
    : Math.max(cardViewportPadding, targetRect.value.top - cardRect.height - gap)
  const idealLeft = targetRect.value.left + targetRect.value.width / 2 - cardRect.width / 2
  const left = Math.min(
    window.innerWidth - cardRect.width - cardViewportPadding,
    Math.max(cardViewportPadding, idealLeft)
  )

  cardStyle.value = {
    insetBlockStart: `${top}px`,
    left: `${left}px`
  }
}

function handleDocumentKeydown(event) {
  if (event.key === 'Escape') {
    // A subpage's own popups close first; handleKeydown closes the subpage itself
    if (event.target.closest?.('.tutorialCard .select.open') || currentSubpage.value !== null) return

    event.preventDefault()
    event.stopPropagation()
  }
}

function handleKeydown(event) {
  event.stopPropagation()

  if (event.key === 'Escape' && currentSubpage.value !== null && !event.defaultPrevented &&
    !event.target.closest?.('.select.open')) {
    event.preventDefault()
    closeSubpagesFrom(subpageStack.value.length - 1)
    return
  }

  // Select pickers open inside the card and handle their own Tab
  if (event.key !== 'Tab' || event.target.closest?.('.mobileSheet, .selectDropdown')) return

  // A radio group is one stop at its checked radio, and a tab list one at its
  // selected tab; arrow keys move within them. Hidden views keep their controls.
  const buttons = Array.from(cardRef.value?.$el.querySelectorAll(
    'button:not(:disabled, [tabindex="-1"]), a[href], input[type="radio"]:checked, ' +
    'input:not([type="radio"], [type="hidden"]):not(:disabled), textarea:not(:disabled)'
  ) ?? []).filter(element => element.checkVisibility({ visibilityProperty: true }))
  if (buttons.length === 0) return

  const currentIndex = buttons.indexOf(document.activeElement)
  const nextIndex = event.shiftKey
    ? (currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1)
    : (currentIndex === -1 || currentIndex === buttons.length - 1 ? 0 : currentIndex + 1)

  event.preventDefault()
  buttons[nextIndex].focus()
  store.dispatch('showOutlines')
}

async function updateTabBarPosition(value) {
  await store.dispatch('updateTabBarPosition', value)
}

function updateSetting(action, value) {
  store.dispatch(`update${action}`, value)
}

async function advanceTutorial() {
  if (isLastStep.value) {
    finishTutorial()
    return
  }

  await setTutorialStep(stepIndex.value + 1)
}

async function retreatTutorial() {
  await setTutorialStep(stepIndex.value - 1)
}

async function setTutorialStep(index) {
  stepIndex.value = index
  await nextTick()
  if (scrollRef.value) restoreOverlayScrollTop(scrollRef.value, 0)
  clampTutorialScroll()
  await updatePosition()
  titleRef.value?.focus()
}

function finishTutorial() {
  emit('close')
}
</script>

<style scoped src="./FtTutorialOverlay.css" />
