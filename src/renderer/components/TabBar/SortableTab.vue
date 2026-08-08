<template>
  <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events -->
  <div
    ref="tabRef"
    class="tab"
    :data-tab-id="tab.id"
    :class="tabClasses"
    :style="tabStyle"
    :aria-label="displayTitle"
    :aria-describedby="isTooltipVisible ? tooltipId : undefined"
    :aria-pressed="isSelected"
    role="button"
    tabindex="-1"
    @click="handleClick"
    @pointerenter="handlePointerEnter"
    @pointerleave="handlePointerLeave"
    @focusin="showTooltip"
    @focusout="hideTooltip"
    @pointerdown="handlePointerDown"
    @mousedown.middle.prevent
    @auxclick.prevent="handleAuxClick"
  >
    <FontAwesomeIcon
      v-if="tab.isPinned"
      :icon="['fas', 'thumbtack']"
      class="pinBadge"
      aria-hidden="true"
    />
    <span class="tabTitle">
      <span
        v-if="tab.isLoading"
        class="loadingDot"
        aria-hidden="true"
      />
      <FontAwesomeIcon
        v-else-if="tab.isPlaying"
        :icon="['fas', 'play']"
        class="playingIcon"
        aria-hidden="true"
      />
      <img
        v-else-if="showIcon && tabAvatarUrl"
        :src="tabAvatarUrl"
        class="tabAvatar"
        alt=""
        draggable="false"
      >
      <FontAwesomeIcon
        v-else-if="showIcon && tabPageIcon"
        :icon="tabPageIcon"
        class="tabPageIcon"
        aria-hidden="true"
      />
      <span class="tabTitleText">{{ displayTitle }}</span>
    </span>
    <button
      class="closeButton"
      :aria-label="closeLabel"
      :title="closeLabel"
      @click.stop="$emit('close', tab.id)"
      @pointerdown.stop
    >
      <FontAwesomeIcon
        :icon="['fas', 'times']"
        class="closeIcon"
      />
    </button>
  </div>
  <Teleport to="body">
    <Transition name="tab-tooltip">
      <div
        v-if="isTooltipVisible"
        :id="tooltipId"
        class="tabTooltip"
        data-tab-preview-overlay
        :style="tooltipStyle"
        role="tooltip"
      >
        <div class="tabTooltipTitle">
          {{ displayTitle }}
        </div>
        <div class="tabTooltipPreview">
          <img
            v-if="tooltipPreviewUrl"
            :src="tooltipPreviewUrl"
            :alt="tooltipPreviewAlt"
            draggable="false"
          >
          <img
            v-else-if="channelThumbnailUrl"
            :src="channelThumbnailUrl"
            :alt="tooltipPreviewAlt"
            class="tabTooltipPreviewAvatar"
            draggable="false"
          >
          <div
            v-else
            class="tabTooltipPreviewFallback"
            aria-hidden="true"
          >
            <FontAwesomeIcon
              :icon="['fas', 'display']"
              class="tabTooltipFallbackIcon"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import packageDetails from '@root/package.json'
import { getTabAccentColor } from '../../constants/tabColors'
import { getTabAvatarUrl, getTabPageIcon, getTabPreviewFallbackUrl } from '../../tabs/tabPreview'

const props = defineProps({
  tab: {
    type: Object,
    required: true
  },
  closeLabel: {
    type: String,
    default: 'Close Tab'
  },
  index: {
    type: Number,
    required: true
  },
  offset: {
    type: Number,
    default: 0
  },
  vertical: {
    type: Boolean,
    default: false
  },
  isDragging: {
    type: Boolean,
    default: false
  },
  isSettling: {
    type: Boolean,
    default: false
  },
  suppressTransition: {
    type: Boolean,
    default: false
  },
  disableTooltips: {
    type: Boolean,
    default: false
  },
  closeTooltipsSignal: {
    type: Number,
    default: 0
  },
  showIcon: {
    type: Boolean,
    default: true
  },
  isSelected: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['activate', 'close', 'middleClick'])

const TOOLTIP_MAX_WIDTH_PX = 340
const TOOLTIP_ESTIMATED_HEIGHT_PX = 240
const TOOLTIP_MARGIN_PX = 8
const TOOLTIP_OFFSET_PX = 6
const TOOLTIP_SHOW_DELAY_MS = 80

const tabRef = useTemplateRef('tabRef')
const isTooltipVisible = ref(false)
const tooltipPreviewUrl = ref(null)
const tooltipStyle = ref({})
const tooltipRequestId = ref(0)
let showTooltipTimeoutId = null
let suppressTooltipUntilPointerLeave = false

const tabColor = computed(() => getTabAccentColor(props.tab.color))

const tabClasses = computed(() => ({
  active: props.tab.isActive,
  loading: props.tab.isLoading,
  unloaded: props.tab.isUnloaded,
  playing: props.tab.isPlaying,
  pinned: props.tab.isPinned,
  colored: tabColor.value != null,
  selected: props.isSelected,
  dragging: props.isDragging,
  settling: props.isSettling,
  noTransition: props.suppressTransition,
  vertical: props.vertical
}))

const tabStyle = computed(() => {
  const translation = props.vertical ? `0, ${props.offset}px` : `${props.offset}px, 0`
  const transform = props.offset !== 0 ? `translate3d(${translation}, 0)` : ''
  /** @type {Record<string, string | undefined>} */
  const style = {
    transform: transform || undefined,
    '--tab-accent-color': tabColor.value || undefined
  }

  return style
})

const displayTitle = computed(() => {
  const title = props.tab.title
  if (!title) return title
  const suffix = ` - ${packageDetails.productName}`
  if (title.endsWith(suffix)) {
    return title.slice(0, -suffix.length)
  }
  return title
})

const tooltipId = computed(() => `tab-tooltip-${props.tab.id}`)
const tooltipPreviewAlt = computed(() => `${displayTitle.value} preview`)

// When a tab points at a channel page and no screenshot has been captured yet,
// fall back to the channel's profile picture (cached by the Channel view).
const channelThumbnailUrl = computed(() => getTabPreviewFallbackUrl(props.tab))
const tabAvatarUrl = computed(() => getTabAvatarUrl(props.tab))
const tabPageIcon = computed(() => getTabPageIcon(props.tab))

function handleClick(event) {
  emit('activate', event, props.tab.id)
}

/**
 * @param {MouseEvent} event
 */
function handleAuxClick(event) {
  if (event.button === 1) {
    emit('middleClick', event, props.tab.id)
  }
}

function showTooltip() {
  if (props.disableTooltips || props.isDragging || suppressTooltipUntilPointerLeave) {
    return
  }

  clearShowTooltipTimeout()
  showTooltipTimeoutId = window.setTimeout(() => {
    showTooltipTimeoutId = null
    if (props.disableTooltips || props.isDragging || suppressTooltipUntilPointerLeave) {
      return
    }

    updateTooltipPosition()
    isTooltipVisible.value = true
    addTooltipDismissListeners()
    window.addEventListener('resize', updateTooltipPosition)
    loadTooltipPreview()
  }, TOOLTIP_SHOW_DELAY_MS)
}

function handlePointerEnter() {
  suppressTooltipUntilPointerLeave = false
  showTooltip()
}

function handlePointerLeave() {
  if (document.hasFocus()) {
    suppressTooltipUntilPointerLeave = false
  }
  hideTooltip()
}

function handlePointerDown() {
  suppressTooltipUntilPointerLeave = true
  hideTooltip()
}

function handleWindowBlur() {
  suppressTooltipUntilPointerLeave = true
  hideTooltip()
}

function hideTooltip() {
  clearShowTooltipTimeout()
  isTooltipVisible.value = false
  tooltipPreviewUrl.value = null
  tooltipRequestId.value++
  removeTooltipDismissListeners()
  window.removeEventListener('resize', updateTooltipPosition)
}

function clearShowTooltipTimeout() {
  if (showTooltipTimeoutId != null) {
    clearTimeout(showTooltipTimeoutId)
    showTooltipTimeoutId = null
  }
}

function addTooltipDismissListeners() {
  document.addEventListener('pointerdown', hideTooltip, true)
  document.addEventListener('wheel', hideTooltip, true)
  document.addEventListener('visibilitychange', hideTooltip, true)
  document.addEventListener('keydown', handleTooltipKeydown, true)
}

function removeTooltipDismissListeners() {
  document.removeEventListener('pointerdown', hideTooltip, true)
  document.removeEventListener('wheel', hideTooltip, true)
  document.removeEventListener('visibilitychange', hideTooltip, true)
  document.removeEventListener('keydown', handleTooltipKeydown, true)
}

/**
 * @param {KeyboardEvent} event
 */
function handleTooltipKeydown(event) {
  if (event.key === 'Escape') {
    hideTooltip()
  }
}

function updateTooltipPosition() {
  const element = tabRef.value
  if (!(element instanceof HTMLElement)) {
    return
  }

  const rect = element.getBoundingClientRect()
  const tooltipWidth = Math.min(
    TOOLTIP_MAX_WIDTH_PX,
    Math.max(120, window.innerWidth - TOOLTIP_MARGIN_PX * 2)
  )

  if (props.vertical) {
    // Place the tooltip beside the tab, keeping it inside the viewport.
    const top = Math.max(
      TOOLTIP_MARGIN_PX,
      Math.min(window.innerHeight - TOOLTIP_ESTIMATED_HEIGHT_PX, rect.top)
    )

    tooltipStyle.value = {
      inlineSize: `${Math.round(tooltipWidth)}px`,
      insetInlineStart: `${Math.round(rect.right + TOOLTIP_OFFSET_PX)}px`,
      insetBlockStart: `${Math.round(top)}px`
    }
    return
  }

  const left = Math.max(
    TOOLTIP_MARGIN_PX,
    Math.min(
      window.innerWidth - tooltipWidth - TOOLTIP_MARGIN_PX,
      rect.left + rect.width / 2 - tooltipWidth / 2
    )
  )

  tooltipStyle.value = {
    inlineSize: `${Math.round(tooltipWidth)}px`,
    insetInlineStart: `${Math.round(left)}px`,
    insetBlockStart: `${Math.round(rect.bottom + TOOLTIP_OFFSET_PX)}px`
  }
}

async function loadTooltipPreview() {
  const requestId = ++tooltipRequestId.value
  tooltipPreviewUrl.value = null

  if (
    !process.env.IS_ELECTRON ||
    typeof window.ftElectron?.tabs?.capturePreview !== 'function'
  ) {
    return
  }

  try {
    const dataUrl = await window.ftElectron.tabs.capturePreview(props.tab.id)
    if (requestId !== tooltipRequestId.value || !isTooltipVisible.value) {
      return
    }
    tooltipPreviewUrl.value = typeof dataUrl === 'string' && dataUrl.length > 0
      ? dataUrl
      : null
  } catch {
    if (requestId === tooltipRequestId.value) {
      tooltipPreviewUrl.value = null
    }
  }
}

onMounted(() => {
  window.addEventListener('blur', handleWindowBlur)
})

onBeforeUnmount(() => {
  window.removeEventListener('blur', handleWindowBlur)
  hideTooltip()
})

watch(() => props.closeTooltipsSignal, () => {
  hideTooltip()
})

watch(() => props.tab.isActive, (isActive) => {
  if (isActive) {
    hideTooltip()
  }
})

watch(() => props.isDragging, (isDragging) => {
  if (isDragging) {
    hideTooltip()
  }
})

watch(() => props.disableTooltips, (disableTooltips) => {
  if (disableTooltips) {
    hideTooltip()
  }
})
</script>

<style scoped>
.tab {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-inline: 10px;
  padding-block: 6px;
  background-color: var(--tab-surface-color, var(--bg-color));
  border-radius: calc(6px * var(--ui-roundness)) calc(6px * var(--ui-roundness)) 0 0;
  cursor: pointer;
  block-size: 30px;

  /* Without a configured fixed width, tabs size to their content within these
     bounds. `--fixed-tab-width` (set by the tab bar) pins both ends together. */
  min-inline-size: var(--fixed-tab-width, 100px);
  max-inline-size: var(--fixed-tab-width, 200px);
  flex-shrink: 0;
  border: 1px solid transparent;
  border-block-end: 0;
  transition: background-color 0.15s ease, transform 0.2s ease;
  position: relative;
  user-select: none;
  touch-action: none;
  will-change: transform;
  --tab-accent-mix: 18%;
  --tab-accent-border-mix: 55%;
}

.tab.noTransition {
  transition: background-color 0.15s ease;
}

.tab.vertical {
  inline-size: calc(100% - 1px);
  min-inline-size: 0;
  max-inline-size: none;
  border-radius: calc(6px * var(--ui-roundness));
  border-block-end: 1px solid transparent;
}

.tab.vertical.active {
  border-color: var(--tab-border-color, var(--tertiary-text-color));
}

.tab.vertical.colored {
  box-shadow: inset 2px 0 0 var(--tab-accent-color);
}

.tab.vertical.pinned {
  inline-size: calc(100% - 1px);
  min-inline-size: 0;
  max-inline-size: none;
}

.tab:hover {
  background-color: var(--tab-hover-color, var(--card-bg-color));
}

.tab.active {
  background-color: var(--tab-active-color, var(--card-bg-color));
  border-color: var(--tab-border-color, var(--tertiary-text-color));
}

.tab.selected {
  background-color: color-mix(in srgb, var(--accent-color) 22%, var(--card-bg-color));
  outline: 2px solid var(--accent-color, var(--primary-text-color));
  outline-offset: -2px;
}

.tab.selected:hover {
  background-color: color-mix(in srgb, var(--accent-color) 28%, var(--card-bg-color));
}

.tab.colored {
  --tab-surface-color: color-mix(in srgb, var(--tab-accent-color) var(--tab-accent-mix), var(--bg-color));
  --tab-hover-color: color-mix(in srgb, var(--tab-accent-color) 22%, var(--card-bg-color));
  --tab-active-color: color-mix(in srgb, var(--tab-accent-color) 26%, var(--card-bg-color));
  --tab-border-color: color-mix(in srgb, var(--tab-accent-color) var(--tab-accent-border-mix), var(--tertiary-text-color));

  box-shadow: inset 0 2px 0 var(--tab-accent-color);
}

.tab.pinned {
  inline-size: var(--fixed-tab-width, 72px);
  min-inline-size: var(--fixed-tab-width, 72px);
  max-inline-size: var(--fixed-tab-width, 72px);
  padding-inline: 9px 7px;
  gap: 4px;
}

.tab.loading {
  opacity: 0.8;
}

.tab.unloaded .tabTitle {
  color: var(--secondary-text-color);
  opacity: 0.72;
}

.tab.unloaded:hover .tabTitle,
.tab.unloaded.active .tabTitle,
.tab.unloaded.loading .tabTitle {
  opacity: 1;
}

.tab.dragging {
  z-index: 10;
  cursor: grabbing;
  transition: background-color 0.15s ease;
  box-shadow: 0 4px 12px rgb(0 0 0 / 18%);
}

.tab.settling {
  z-index: 10;
}

.tabTitle {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  block-size: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
  color: var(--primary-text-color);
}

.tabAvatar {
  inline-size: 16px;
  block-size: 16px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.tabPageIcon {
  inline-size: 13px;
  font-size: 12px;
  color: var(--secondary-text-color);
  flex-shrink: 0;
}

.tabTitleText {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab.pinned .tabTitle {
  padding-inline-start: 9px;
  font-size: 11px;
}

.pinBadge {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-start: 5px;
  transform: translateY(-50%);
  font-size: 8px;
  color: var(--tab-accent-color, var(--secondary-text-color));
  opacity: 0.92;
  pointer-events: none;
}

.loadingDot {
  display: inline-block;
  inline-size: 6px;
  block-size: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background-color: var(--accent-color, var(--primary-text-color));
  animation: tab-loading-pulse 0.9s ease-in-out infinite;
  vertical-align: middle;
}

@keyframes tab-loading-pulse {
  0% {
    transform: scale(0.7);
    opacity: 0.5;
  }

  50% {
    transform: scale(1);
    opacity: 1;
  }

  100% {
    transform: scale(0.7);
    opacity: 0.5;
  }
}

.playingIcon {
  font-size: 8px;
  color: var(--accent-color, var(--primary-text-color));
  flex-shrink: 0;
}

.closeButton {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 0;
  cursor: pointer;
  padding: 2px;
  border-radius: calc(4px * var(--ui-roundness));
  color: var(--tertiary-text-color);
  opacity: 0;
  transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.tab.pinned .closeButton {
  position: absolute;
  inset-inline-end: 3px;
  inset-block-start: 50%;
  transform: translateY(-50%);
  background-color: var(--tab-active-color, var(--card-bg-color));
}

.tab.pinned:hover .tabTitle {
  padding-inline-end: 12px;
}

.closeButton:hover {
  background-color: var(--destructive-color);
  color: var(--destructive-text-color);
}

.tab.pinned .closeButton:hover {
  background-color: var(--destructive-color);
  color: var(--destructive-text-color);
}

.tab:hover .closeButton,
.tab.active .closeButton {
  opacity: 1;
}

.tab.pinned.active:not(:hover) .closeButton {
  opacity: 0;
  pointer-events: none;
}

.closeIcon {
  font-size: 10px;
}

.tabTooltip {
  position: fixed;
  z-index: 10000;
  padding: 8px;
  border: 1px solid var(--tertiary-text-color);
  border-radius: calc(8px * var(--ui-roundness));
  background-color: var(--card-bg-color);
  box-shadow: 0 8px 26px rgb(0 0 0 / 32%);
  color: var(--primary-text-color);
  font-family: Roboto, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
  font-weight: 400;
  letter-spacing: 0;
  pointer-events: none;
  -webkit-app-region: no-drag;
}

.tab-tooltip-enter-active,
.tab-tooltip-leave-active {
  transition: opacity 0.14s ease, transform 0.14s ease;
}

.tab-tooltip-enter-from,
.tab-tooltip-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.985);
}

.tabTooltipPreview {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 16 / 9;
  inline-size: 100%;
  overflow: hidden;
  border-radius: calc(5px * var(--ui-roundness));
  background-color: var(--secondary-card-bg-color);
}

.tabTooltipPreview img {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
}

.tabTooltipPreview .tabTooltipPreviewAvatar {
  inline-size: auto;
  block-size: 72%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 50%;
}

.tabTooltipPreviewFallback {
  display: flex;
  align-items: center;
  justify-content: center;
  inline-size: 100%;
  block-size: 100%;
  color: var(--tertiary-text-color);
}

.tabTooltipFallbackIcon {
  font-size: 24px;
  opacity: 0.72;
}

.tabTooltipTitle {
  margin-block-end: 7px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 1.35;
}
</style>
