<template>
  <div
    class="switch-ctn"
    :data-setting-key="settingKey || undefined"
    :class="{
      compact,
      trailing,
      labelHidden: hideLabel,
      disabled: disabled,
      containsTooltip: tooltip.length > 0
    }"
  >
    <input
      :id="id"
      v-model="currentValue"
      type="checkbox"
      name="set-name"
      class="switch-input"
      :checked="currentValue"
      :indeterminate="indeterminate"
      :aria-checked="indeterminate ? 'mixed' : undefined"
      :aria-describedby="description ? descriptionId : undefined"
      :disabled="disabled"
      @change="change"
    >
    <label
      :for="id"
      class="switch-label"
    >
      <span class="switch-label-main">
        <!-- The icons flow inline after the text, so they follow the last
             word when the label wraps, and never move to a line of their own. -->
        <span
          ref="labelText"
          class="switch-label-text"
          :class="{ hasLeadingIcon: icon !== null }"
        >
          <FtIcon
            v-if="icon !== null"
            class="switch-label-leading-icon"
            :icon="icon"
            aria-hidden="true"
          />
          <span class="switch-label-name">{{ labelParts.start }}</span>
          <span class="switch-label-end">
            <span class="switch-label-name">{{ labelParts.end }}</span>
            <span class="switch-label-icons">
              <FtTooltip
                v-if="tooltip !== ''"
                class="selectTooltip"
                :position="tooltipPosition"
                :tooltip="tooltip"
                :allow-newlines="tooltipAllowNewlines"
              />
              <FtSyncedSettingIndicator
                :setting-key="settingKey"
                :setting-keys="syncSettingKeys"
              />
            </span>
          </span>
          <!-- Hidden from the label's name, which stays short, and read as
               the switch's description instead. -->
          <span
            v-if="description"
            :id="descriptionId"
            class="switch-label-description"
            aria-hidden="true"
          >
            {{ description }}
          </span>
          <span
            class="switch-thumb"
            aria-hidden="true"
          >
            <FtIcon :icon="['fas', currentValue && !indeterminate ? 'check' : 'minus']" />
          </span>
        </span>
      </span>
      <span
        v-if="experimental"
        class="experimentalBadge"
      >
        <FtIcon
          :icon="['fas', 'flask']"
          aria-hidden="true"
        />
        {{ t('Settings.Experimental Badge') }}
      </span>
      <FtPerformanceImpact :setting-key="performanceImpactKey || settingKey" />
    </label>
  </div>
</template>

<script setup>
import { computed, onActivated, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtTooltip from '../FtTooltip/FtTooltip.vue'
import FtPerformanceImpact from '../FtPerformanceImpact/FtPerformanceImpact.vue'
import FtSyncedSettingIndicator from '../FtSyncedSettingIndicator/FtSyncedSettingIndicator.vue'

const props = defineProps({
  label: {
    type: String,
    required: true
  },
  defaultValue: {
    type: Boolean,
    default: false
  },
  controlled: {
    type: Boolean,
    default: false
  },
  indeterminate: {
    type: Boolean,
    default: false
  },
  compact: {
    type: Boolean,
    default: false
  },
  // Keeps the label for assistive technology only, for a switch whose name
  // is shown by a control beside it
  hideLabel: {
    type: Boolean,
    default: false
  },
  trailing: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  tooltip: {
    type: String,
    default: ''
  },
  // A short line under the label that explains the setting
  description: {
    type: String,
    default: ''
  },
  // Icon before the label, such as the icon of the control the setting shows
  icon: {
    type: Array,
    default: null
  },
  tooltipPosition: {
    type: String,
    default: 'bottom-left'
  },
  tooltipAllowNewlines: {
    type: Boolean,
    default: false,
  },
  // Marks a setting that works but hasn't been tested much yet
  experimental: {
    type: Boolean,
    default: false
  },
  settingKey: {
    type: String,
    default: ''
  },
  // Synced setting keys for a switch outside the settings, which has no `settingKey`
  syncSettingKeys: {
    type: Array,
    default: () => []
  },
  // Performance impact key for a switch that is not backed by a setting, which has no `settingKey`
  performanceImpactKey: {
    type: String,
    default: ''
  },
})

const emit = defineEmits(['change'])

const { t } = useI18n()

const id = useId()
const descriptionId = `${id}-description`

const currentValue = ref(props.defaultValue)

watch(() => props.defaultValue, (value) => {
  currentValue.value = value
})

function change() {
  const value = currentValue.value
  if (props.controlled) currentValue.value = props.defaultValue
  emit('change', value)
}

/**
 * The last word stays on one line with the icons after it. A label without
 * spaces, such as a Chinese or Japanese one, stays whole and wraps inside
 * that box when it does not fit.
 */
const labelParts = computed(() => {
  const match = props.label.match(/^(.*\s)(\S+)$/s)
  return match ? { start: match[1], end: match[2] } : { start: '', end: props.label }
})

const labelText = useTemplateRef('labelText')
let labelResizeObserver = null

/**
 * A wrapped label's box keeps the full width it was allowed, leaving empty
 * space beside its longest line. In a settings switch grid, where columns
 * meet in the middle, that space would push the column away from the center,
 * so the box is narrowed to its longest line.
 * @param {HTMLElement} text with its maximum width cleared
 * @returns {string} the maximum width to set, empty when none is needed
 */
function measureFittedLabelWidth(text) {
  const names = text.querySelectorAll('.switch-label-name')
  const range = document.createRange()
  range.setStartBefore(names[0])
  range.setEndAfter(names[names.length - 1])
  const textRects = [...range.getClientRects()].filter(rect => rect.width > 0)
  const box = text.getBoundingClientRect()
  const style = getComputedStyle(text)
  // Client rects include transforms, such as the settings window's opening
  // morph from its button, while lines and the maximum width are in layout
  // pixels. Scaled down that far, two lines are less than a pixel apart. The
  // rounded offsetWidth would skew the scale enough to cut the width short.
  const layoutWidth = ['width', 'paddingInlineStart', 'paddingInlineEnd', 'borderInlineStartWidth', 'borderInlineEndWidth']
    .reduce((sum, property) => sum + Number.parseFloat(style[property]), 0)
  const scale = box.width / layoutWidth
  if (!(scale > 0)) return ''
  const lineCount = new Set(textRects.map(rect => Math.round((rect.top - box.top) / scale))).size
  if (lineCount < 2) return ''
  const icons = text.querySelector('.switch-label-icons').getBoundingClientRect()
  const rects = icons.width > 0 ? [...textRects, icons] : textRects
  const width = style.direction === 'rtl'
    ? box.right - Math.min(...rects.map(rect => rect.left))
    : Math.max(...rects.map(rect => rect.right)) - box.left
  return width < box.width - scale ? `${Math.ceil(width / scale)}px` : ''
}

/** Labels waiting to be fitted together, so they share one layout. */
const pendingLabels = new Set()

/** @param {HTMLElement} text */
function fitLabelToLines(text) {
  if (pendingLabels.size === 0) queueMicrotask(fitPendingLabels)
  pendingLabels.add(text)
}

function fitPendingLabels() {
  const texts = [...pendingLabels].filter(text => text.isConnected)
  pendingLabels.clear()
  for (const text of texts) text.style.maxInlineSize = ''
  const widths = texts.map(measureFittedLabelWidth)
  texts.forEach((text, index) => { text.style.maxInlineSize = widths[index] })
}

let refitLabel = null
let refitLabelNow = null
let refitFrame = 0
let labelMutationObserver = null

onMounted(() => {
  const text = labelText.value
  const grid = text?.closest('.switchColumnGrid')
  if (!grid) return
  // Fitting resizes the observed label, so it runs in the next frame instead
  // of during the observer's delivery, once for any number of requests.
  refitLabel = () => {
    if (refitFrame) return
    refitFrame = requestAnimationFrame(() => {
      refitFrame = 0
      fitLabelToLines(text)
    })
  }
  // Fit before the first paint, so a newly shown settings page doesn't
  // shift its columns a frame later.
  fitLabelToLines(text)
  // New content, such as other text after a language change or an indicator
  // that appears once its state has loaded, and a font that finishes loading
  // are fitted before the next paint too. Fitting a frame later would show
  // the column at its old width first and then jump.
  refitLabelNow = () => fitLabelToLines(text)
  labelMutationObserver = new MutationObserver(refitLabelNow)
  labelMutationObserver.observe(text, { childList: true, characterData: true, subtree: true })
  document.fonts.addEventListener('loadingdone', refitLabelNow)
  // The grid follows the available width, and the label can still resize
  // without changing its content, such as when the font size changes.
  labelResizeObserver = new ResizeObserver(refitLabel)
  labelResizeObserver.observe(grid)
  labelResizeObserver.observe(text)
})

// A kept-alive page, such as the closed settings window, can come back in
// another width, which the observer would only refit a frame after it shows.
// Settings settles its layout during activation, so the fit waits for the
// next frame, which is still before the reopened window first paints.
onActivated(() => refitLabel?.())

onBeforeUnmount(() => {
  labelResizeObserver?.disconnect()
  labelMutationObserver?.disconnect()
  cancelAnimationFrame(refitFrame)
  if (refitLabelNow) document.fonts.removeEventListener('loadingdone', refitLabelNow)
})
</script>

<style scoped lang="scss" src="./FtToggleSwitch.scss" />
