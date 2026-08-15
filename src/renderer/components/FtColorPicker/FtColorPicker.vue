<template>
  <div class="ftColorPicker">
    <button
      ref="triggerRef"
      type="button"
      class="colorFieldTrigger"
      :aria-label="label"
      :aria-expanded="open"
      @click="togglePicker"
    >
      <span
        class="swatch checkerboard"
        aria-hidden="true"
      >
        <span
          class="swatchColor"
          :style="{ backgroundColor: modelValue }"
        />
      </span>
      <span class="colorFieldLabel">
        <slot name="label">{{ label }}</slot>
      </span>
      <code>{{ modelValue }}</code>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="popoverRef"
        class="colorPickerPopover"
        :style="popoverStyle"
        role="dialog"
        :aria-label="label"
        @keydown.esc.stop="closePicker()"
      >
        <div class="pickerHeader">
          <strong class="pickerTitle">{{ label }}</strong>
          <div class="pickerHeaderActions">
            <button
              type="button"
              class="pickerHeaderAction"
              :title="t('Color Picker.Reset Color')"
              :aria-label="t('Color Picker.Reset Color')"
              :disabled="resetDisabled"
              @click="resetColor"
            >
              <FtIcon :icon="['fas', 'undo']" />
            </button>
            <button
              type="button"
              class="pickerHeaderAction"
              :title="t('Color Picker.Apply Color')"
              :aria-label="t('Color Picker.Apply Color')"
              @click="closePicker(true)"
            >
              <FtIcon :icon="['fas', 'check']" />
            </button>
          </div>
        </div>
        <div
          class="saturationValue"
          role="slider"
          tabindex="0"
          :aria-label="t('Color Picker.Saturation and Brightness')"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-valuenow="Math.round(value)"
          :aria-valuetext="`${Math.round(saturation)}%, ${Math.round(value)}%`"
          :style="{ backgroundColor: `hsl(${hue} 100% 50%)` }"
          @pointerdown="startSaturationValue"
          @keydown="adjustSaturationValue"
        >
          <span
            class="saturationValueThumb"
            :style="{ insetInlineStart: `${saturation}%`, insetBlockStart: `${100 - value}%` }"
          />
        </div>

        <label class="sliderField">
          <span>{{ t('Color Picker.Hue') }}</span>
          <input
            v-model.number="hue"
            class="hueSlider"
            type="range"
            min="0"
            max="359"
            @input="emitCurrentColor"
            @change="emit('change')"
          >
        </label>
        <label
          v-if="allowAlpha"
          class="sliderField"
        >
          <span>{{ t('Color Picker.Opacity') }}</span>
          <span>{{ opacityLabel }}</span>
          <span
            class="alphaSliderBackground checkerboard"
            :style="{ '--opaque-color': opaqueHex }"
          >
            <input
              v-model.number="alpha"
              class="alphaSlider"
              type="range"
              min="0"
              max="255"
              @input="emitCurrentColor"
              @change="emit('change')"
            >
          </span>
        </label>
        <label
          v-if="supportsBlur"
          class="sliderField"
          :class="{ disabled: !isTransparent }"
        >
          <span>{{ t('Color Picker.Backdrop Blur') }}</span>
          <span>{{ blurLabel }}</span>
          <input
            v-model.number="blurStrength"
            class="blurSlider"
            type="range"
            min="0"
            max="40"
            :disabled="!isTransparent"
            @input="emitCurrentBlur"
            @change="emit('change')"
          >
        </label>

        <div class="valueRow">
          <label class="hexField">
            <span>{{ t('Color Picker.Hex Color') }}</span>
            <span class="hexInputControl">
              <input
                v-model="hexInput"
                type="text"
                :maxlength="allowAlpha ? 9 : 7"
                spellcheck="false"
                @focus="$event.target.select()"
                @blur="commitHexInput"
                @keydown.enter.prevent="commitHexInput"
              >
              <button
                type="button"
                class="copyColorButton"
                :title="copyButtonLabel"
                :aria-label="copyButtonLabel"
                @click="copyColor"
              >
                <FtIcon :icon="['fas', copied ? 'check' : 'copy']" />
              </button>
            </span>
          </label>
        </div>
        <div
          v-if="otherColors.length > 0"
          class="copyFromControl"
        >
          <button
            ref="copyFromButtonRef"
            type="button"
            class="copyFromButton"
            :aria-expanded="showColorSources"
            @click="toggleColorSources"
          >
            {{ t('Color Picker.Copy From Another Color') }}
          </button>
          <div
            v-if="showColorSources"
            ref="colorSourceListRef"
            v-overlay-scrollbars
            class="colorSourceList"
            :class="{ above: colorSourcesAbove }"
            :aria-label="t('Color Picker.Copy From Another Color')"
          >
            <div
              ref="colorSourceContentRef"
              class="colorSourceContent"
            >
              <button
                v-for="color in otherColors"
                :key="color.key"
                type="button"
                @click="copyFromColor(color.value)"
              >
                <span class="sourceSwatch checkerboard">
                  <span :style="{ backgroundColor: color.value }" />
                </span>
                <span>{{ color.label }}</span>
                <code>{{ color.value }}</code>
              </button>
            </div>
          </div>
        </div>
        <small
          v-if="status"
          class="pickerStatus"
          role="status"
        >{{ status }}</small>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { clampOverlayScrollTop } from '../../helpers/overlayScrollbars'

const props = defineProps({
  modelValue: {
    type: String,
    required: true
  },
  label: {
    type: String,
    required: true
  },
  otherColors: {
    type: Array,
    default: () => []
  },
  allowAlpha: {
    type: Boolean,
    default: true
  },
  blurValue: {
    type: Number,
    default: null
  }
})
const emit = defineEmits(['update:modelValue', 'update:blurValue', 'change', 'apply', 'cancel', 'reset'])
const { t } = useI18n()
const triggerRef = useTemplateRef('triggerRef')
const popoverRef = useTemplateRef('popoverRef')
const copyFromButtonRef = useTemplateRef('copyFromButtonRef')
const colorSourceListRef = useTemplateRef('colorSourceListRef')
const colorSourceContentRef = useTemplateRef('colorSourceContentRef')
const open = ref(false)
const hue = ref(0)
const saturation = ref(0)
const value = ref(0)
const alpha = ref(255)
const blurStrength = ref(props.blurValue ?? 0)
const hexInput = ref(props.modelValue)
const copied = ref(false)
const status = ref('')
const showColorSources = ref(false)
const colorSourcesAbove = ref(false)
const popoverStyle = ref({})
const colorWhenOpened = ref(props.modelValue)
const blurWhenOpened = ref(props.blurValue ?? 0)
let draggingSaturationValue = false
let statusTimeout = null
let copiedTimeout = null
let lastEmittedColor = null
let colorSourcesResizeObserver = null

const opaqueHex = computed(() => formatHex(hsvToRgb(hue.value, saturation.value, value.value), 255))
const supportsBlur = computed(() => props.blurValue !== null)
const isTransparent = computed(() => alpha.value < 255)
const opacityLabel = computed(() => `${Math.round(alpha.value / 255 * 100)}%`)
const blurLabel = computed(() => `${blurStrength.value} px`)
const copyColorLabel = computed(() => t('Color Picker.Copy Color'))
const colorCopiedLabel = computed(() => t('Color Picker.Color Copied'))
const copyButtonLabel = computed(() => copied.value ? colorCopiedLabel.value : copyColorLabel.value)
const resetDisabled = computed(() =>
  normalizedColor(props.modelValue) === normalizedColor(colorWhenOpened.value) &&
  (!supportsBlur.value || blurStrength.value === blurWhenOpened.value))

watch(() => props.modelValue, syncFromModel, { immediate: true })
watch(() => props.blurValue, blur => {
  if (blur !== null) blurStrength.value = blur
})
watch(open, async value => {
  if (!value) {
    showColorSources.value = false
    removeOpenListeners()
    return
  }
  document.addEventListener('pointerdown', closeFromOutside)
  window.addEventListener('resize', positionPopover)
  window.addEventListener('scroll', positionPopover, true)
  await nextTick()
  positionPopover()
})
watch(showColorSources, async value => {
  stopObservingColorSources()
  if (!value) return

  await nextTick()
  const bounds = copyFromButtonRef.value?.getBoundingClientRect()
  if (bounds !== undefined) {
    colorSourcesAbove.value = window.innerHeight - bounds.bottom < 230 && bounds.top > 230
  }
  observeColorSources()
})
function syncFromModel(color, force = false) {
  if (!force && color === lastEmittedColor) {
    lastEmittedColor = null
    return
  }
  const parsed = parseHex(color)
  if (parsed === null) return
  const hsv = rgbToHsv(parsed)
  hue.value = hsv.h
  saturation.value = hsv.s
  value.value = hsv.v
  alpha.value = props.allowAlpha ? parsed.a : 255
  hexInput.value = formatHex(parsed, alpha.value)
}

function togglePicker() {
  if (open.value) closePicker()
  else {
    colorWhenOpened.value = props.modelValue
    blurWhenOpened.value = props.blurValue ?? 0
    open.value = true
  }
}

function closePicker(apply = false) {
  if (!apply && !resetDisabled.value) resetColor()
  if (apply) emit('apply')
  else emit('cancel')
  open.value = false
}

function emitCurrentColor() {
  const color = formatHex(
    hsvToRgb(hue.value, saturation.value, value.value),
    props.allowAlpha ? alpha.value : 255
  )
  hexInput.value = color
  lastEmittedColor = color
  emit('update:modelValue', color)
}

function emitCurrentBlur() {
  emit('update:blurValue', blurStrength.value)
}

function startSaturationValue(event) {
  if (event.button !== 0) return
  draggingSaturationValue = true
  updateSaturationValue(event)
  window.addEventListener('pointermove', updateSaturationValue)
  window.addEventListener('pointerup', stopSaturationValue, { once: true })
  event.preventDefault()
}

function updateSaturationValue(event) {
  if (!draggingSaturationValue) return
  const bounds = event.currentTarget?.classList?.contains('saturationValue')
    ? event.currentTarget.getBoundingClientRect()
    : popoverRef.value?.querySelector('.saturationValue')?.getBoundingClientRect()
  if (bounds === undefined) return
  saturation.value = clamp((event.clientX - bounds.left) / bounds.width * 100, 0, 100)
  value.value = 100 - clamp((event.clientY - bounds.top) / bounds.height * 100, 0, 100)
  emitCurrentColor()
}

function stopSaturationValue() {
  draggingSaturationValue = false
  window.removeEventListener('pointermove', updateSaturationValue)
  emit('change')
}

function adjustSaturationValue(event) {
  const step = event.shiftKey ? 10 : 1
  if (event.key === 'ArrowLeft') saturation.value = clamp(saturation.value - step, 0, 100)
  else if (event.key === 'ArrowRight') saturation.value = clamp(saturation.value + step, 0, 100)
  else if (event.key === 'ArrowUp') value.value = clamp(value.value + step, 0, 100)
  else if (event.key === 'ArrowDown') value.value = clamp(value.value - step, 0, 100)
  else return
  event.preventDefault()
  emitCurrentColor()
  emit('change')
}

function commitHexInput() {
  const parsed = parseHex(hexInput.value)
  if (parsed === null) {
    hexInput.value = props.modelValue
    showStatus(t('Color Picker.Invalid Color'))
    return
  }
  if (!props.allowAlpha) parsed.a = 255
  const color = formatHex(parsed, parsed.a)
  lastEmittedColor = color
  emit('update:modelValue', color)
  emit('change')
  syncFromModel(color, true)
}

async function copyColor() {
  try {
    await navigator.clipboard.writeText(hexInput.value)
    copied.value = true
    if (copiedTimeout !== null) clearTimeout(copiedTimeout)
    copiedTimeout = setTimeout(() => {
      copied.value = false
      copiedTimeout = null
    }, 2000)
  } catch (error) {
    console.error('Unable to copy custom theme color:', error)
    showStatus(t('Color Picker.Clipboard Unavailable'))
  }
}

function resetColor() {
  const parsed = parseHex(colorWhenOpened.value)
  if (parsed === null) return
  if (!props.allowAlpha) parsed.a = 255
  const color = formatHex(parsed, parsed.a)
  lastEmittedColor = color
  emit('update:modelValue', color)
  syncFromModel(color, true)
  if (supportsBlur.value) {
    blurStrength.value = blurWhenOpened.value
    emit('update:blurValue', blurStrength.value)
  }
  emit('change')
  emit('reset')
}

function normalizedColor(color) {
  const parsed = parseHex(color)
  if (parsed === null) return color
  return formatHex(parsed, props.allowAlpha ? parsed.a : 255)
}

function copyFromColor(color) {
  const parsed = parseHex(color)
  if (parsed === null) return
  if (!props.allowAlpha) parsed.a = 255
  const normalized = formatHex(parsed, parsed.a)
  lastEmittedColor = normalized
  emit('update:modelValue', normalized)
  emit('change')
  syncFromModel(normalized, true)
  showColorSources.value = false
}

function toggleColorSources() {
  showColorSources.value = !showColorSources.value
}

function clampColorSourcesScroll() {
  if (colorSourceListRef.value !== null && colorSourceContentRef.value !== null) {
    clampOverlayScrollTop(colorSourceListRef.value, colorSourceContentRef.value)
  }
}

function observeColorSources() {
  if (colorSourceListRef.value === null || colorSourceContentRef.value === null) return

  colorSourcesResizeObserver = new ResizeObserver(clampColorSourcesScroll)
  colorSourcesResizeObserver.observe(colorSourceListRef.value)
  colorSourcesResizeObserver.observe(colorSourceContentRef.value)
  clampColorSourcesScroll()
}

function stopObservingColorSources() {
  colorSourcesResizeObserver?.disconnect()
  colorSourcesResizeObserver = null
}

function showStatus(message) {
  status.value = message
  if (statusTimeout !== null) clearTimeout(statusTimeout)
  statusTimeout = setTimeout(() => {
    status.value = ''
    statusTimeout = null
  }, 2000)
}

function positionPopover() {
  const trigger = triggerRef.value
  const popover = popoverRef.value
  if (trigger === null || popover === null) return
  const triggerBounds = trigger.getBoundingClientRect()
  const margin = 12
  const left = clamp(triggerBounds.left, margin, window.innerWidth - popover.offsetWidth - margin)
  const below = triggerBounds.bottom + 8
  const top = below + popover.offsetHeight <= window.innerHeight - margin
    ? below
    : Math.max(margin, triggerBounds.top - popover.offsetHeight - 8)
  popoverStyle.value = { left: `${left}px`, top: `${top}px` }
}

function closeFromOutside(event) {
  if (triggerRef.value?.contains(event.target) || popoverRef.value?.contains(event.target)) return
  closePicker()
}

function removeOpenListeners() {
  document.removeEventListener('pointerdown', closeFromOutside)
  window.removeEventListener('resize', positionPopover)
  window.removeEventListener('scroll', positionPopover, true)
}

function parseHex(input) {
  let hex = input.trim().toLowerCase()
  if (!hex.startsWith('#')) hex = `#${hex}`
  if (/^#[\da-f]{3,4}$/.test(hex)) {
    hex = '#' + [...hex.slice(1)].map(character => character.repeat(2)).join('')
  }
  if (!/^#[\da-f]{6}(?:[\da-f]{2})?$/.test(hex)) return null
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
    a: hex.length === 9 ? Number.parseInt(hex.slice(7, 9), 16) : 255
  }
}

function formatHex({ r, g, b }, alphaValue) {
  const rgb = [r, g, b].map(component => Math.round(component).toString(16).padStart(2, '0')).join('')
  const alphaHex = Math.round(alphaValue).toString(16).padStart(2, '0')
  return `#${rgb}${alphaValue < 255 ? alphaHex : ''}`
}

function rgbToHsv({ r, g, b }) {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let calculatedHue = 0
  if (delta !== 0) {
    if (max === red) calculatedHue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) calculatedHue = 60 * ((blue - red) / delta + 2)
    else calculatedHue = 60 * ((red - green) / delta + 4)
  }
  return {
    h: Math.round((calculatedHue + 360) % 360),
    s: max === 0 ? 0 : delta / max * 100,
    v: max * 100
  }
}

function hsvToRgb(h, s, v) {
  const saturationValue = s / 100
  const brightness = v / 100
  const chroma = brightness * saturationValue
  const section = h / 60
  const x = chroma * (1 - Math.abs(section % 2 - 1))
  const match = brightness - chroma
  let rgb
  if (section < 1) rgb = [chroma, x, 0]
  else if (section < 2) rgb = [x, chroma, 0]
  else if (section < 3) rgb = [0, chroma, x]
  else if (section < 4) rgb = [0, x, chroma]
  else if (section < 5) rgb = [x, 0, chroma]
  else rgb = [chroma, 0, x]
  return {
    r: (rgb[0] + match) * 255,
    g: (rgb[1] + match) * 255,
    b: (rgb[2] + match) * 255
  }
}

function clamp(number, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, number))
}

onBeforeUnmount(() => {
  removeOpenListeners()
  stopObservingColorSources()
  window.removeEventListener('pointermove', updateSaturationValue)
  if (statusTimeout !== null) clearTimeout(statusTimeout)
  if (copiedTimeout !== null) clearTimeout(copiedTimeout)
})
</script>

<style scoped>
.ftColorPicker {
  min-inline-size: 0;
}

.checkerboard {
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #bbb 25%, transparent 25%),
    linear-gradient(-45deg, #bbb 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #bbb 75%),
    linear-gradient(-45deg, transparent 75%, #bbb 75%);
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-size: 12px 12px;
}

.colorFieldTrigger {
  inline-size: 100%;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-block-size: 46px;
  border: 0;
  border-radius: calc(8px * var(--ui-roundness));
  padding: 6px 10px;
  color: var(--primary-text-color);
  background: var(--card-bg-color);
  backdrop-filter: var(--card-bg-blur, none);
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.colorFieldTrigger code {
  color: var(--tertiary-text-color);
  font-size: 0.78rem;
}

.colorFieldLabel {
  min-inline-size: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.colorFieldTrigger:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.swatch {
  position: relative;
  display: block;
  inline-size: 38px;
  block-size: 32px;
  overflow: hidden;
  border: 0;
  border-radius: calc(4px * var(--ui-roundness));
}

.swatchColor {
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.swatch::after,
.sourceSwatch::after {
  content: '';
  position: absolute;
  z-index: 1;
  inset: 0;
  box-sizing: border-box;
  border: 1px solid var(--border-color);
  border-radius: inherit;
  pointer-events: none;
}

.colorPickerPopover {
  position: fixed;
  z-index: 1001;
  box-sizing: border-box;
  inline-size: min(300px, calc(100vw - 24px));
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  border: 1px solid var(--border-color);
  border-radius: calc(10px * var(--ui-roundness));
  padding: 14px;
  color: var(--primary-text-color);
  background: var(--card-bg-color);
  backdrop-filter: var(--card-bg-blur, none);
  box-shadow: 0 12px 36px rgb(0 0 0 / 45%);
  font-family: Roboto, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
}

.colorPickerPopover button,
.colorPickerPopover input {
  font: inherit;
}

.pickerTitle {
  min-inline-size: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pickerHeader {
  min-inline-size: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pickerHeaderActions {
  flex: none;
  display: flex;
  gap: 2px;
}

.pickerHeaderAction {
  flex: none;
  inline-size: 32px;
  block-size: 32px;
  border: 0;
  border-radius: calc(5px * var(--ui-roundness));
  padding: 0;
  color: var(--primary-text-color);
  background: transparent;
  cursor: pointer;
}

.pickerHeaderAction:not(:disabled):hover,
.pickerHeaderAction:not(:disabled):focus-visible {
  background: var(--side-nav-hover-color);
}

.pickerHeaderAction:disabled {
  opacity: 0.5;
  cursor: default;
}

.saturationValue {
  position: relative;
  block-size: 150px;
  border-radius: calc(6px * var(--ui-roundness));
  cursor: crosshair;
  touch-action: none;
  background-image:
    linear-gradient(to top, #000, transparent),
    linear-gradient(to right, #fff, transparent);
}

.saturationValue:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}

.saturationValueThumb {
  position: absolute;
  inline-size: 14px;
  block-size: 14px;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px #000;
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.sliderField {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px 8px;
  font-size: 0.82rem;
}

.sliderField input[type='range'] {
  inline-size: 100%;
  margin: 0;
  cursor: pointer;
}

.sliderField.disabled {
  opacity: 0.5;
}

.sliderField input[type='range']:disabled {
  cursor: default;
}

.hueSlider {
  grid-column: 1 / -1;
  block-size: 16px;
  appearance: none;
  background: transparent;
  accent-color: var(--primary-color);
}

.hueSlider::-webkit-slider-runnable-track {
  block-size: 10px;
  border-radius: 999px;
  background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
}

.blurSlider {
  grid-column: 1 / -1;
  block-size: 16px;
  appearance: none;
  background: transparent;
}

.blurSlider::-webkit-slider-runnable-track {
  block-size: 10px;
  border-radius: 999px;
  background: var(--subtle-surface-color);
}

.alphaSliderBackground {
  grid-column: 1 / -1;
  position: relative;
  block-size: 10px;
  border-radius: 999px;
}

.alphaSliderBackground::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(to right, transparent, var(--opaque-color));
  pointer-events: none;
}

.alphaSlider {
  position: absolute;
  z-index: 1;
  inset: 50% 0 auto;
  transform: translateY(-50%);
  appearance: none;
  background: transparent;
}

.hueSlider::-webkit-slider-thumb,
.alphaSlider::-webkit-slider-thumb,
.blurSlider::-webkit-slider-thumb {
  appearance: none;
  inline-size: 16px;
  block-size: 16px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: #222;
  box-shadow: 0 0 0 1px #000;
}

.hueSlider::-webkit-slider-thumb {
  margin-block-start: -3px;
  background: transparent;
}

.blurSlider::-webkit-slider-thumb {
  margin-block-start: -3px;
}

.valueRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: end;
  gap: 6px;
}

.hexField {
  grid-column: 1 / -1;
  display: grid;
  gap: 4px;
  min-inline-size: 0;
  font-size: 0.78rem;
}

.hexField input,
.valueRow button {
  box-sizing: border-box;
  min-block-size: 34px;
  border: 1px solid var(--border-color);
  border-radius: calc(5px * var(--ui-roundness));
  color: var(--primary-text-color);
  background: var(--search-bar-color);
  backdrop-filter: var(--search-bar-blur, none);
}

.hexField input {
  min-inline-size: 0;
  inline-size: 100%;
  padding-inline: 8px;
  font-family: monospace;
}

.hexInputControl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
}

.hexInputControl input {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}

.hexInputControl .copyColorButton {
  border-inline-start: 0;
  border-start-start-radius: 0;
  border-end-start-radius: 0;
  padding: 0;
}

.valueRow button {
  padding-inline: 9px;
  cursor: pointer;
}

.valueRow button:disabled {
  opacity: 0.5;
  cursor: default;
}

.valueRow button:not(:disabled):hover,
.valueRow button:not(:disabled):focus-visible {
  background: var(--side-nav-hover-color);
}

.copyFromControl {
  position: relative;
}

.copyFromButton {
  inline-size: 100%;
  min-block-size: 36px;
  border: 1px solid var(--border-color);
  border-radius: calc(5px * var(--ui-roundness));
  color: var(--primary-text-color);
  background: var(--search-bar-color);
  backdrop-filter: var(--search-bar-blur, none);
  cursor: pointer;
}

.copyFromButton:hover,
.copyFromButton:focus-visible {
  background: var(--side-nav-hover-color);
}

.colorSourceList {
  position: absolute;
  z-index: 1;
  inset-block-start: calc(100% + 4px);
  inset-inline: 0;
  box-sizing: border-box;
  block-size: min(220px, calc(100vh - 24px));
  max-block-size: 220px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: calc(6px * var(--ui-roundness));
  padding: 4px;
  background: var(--side-nav-color);
  box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
}

.colorSourceContent {
  display: grid;
  gap: 2px;
}

.colorSourceList.above {
  inset-block-start: auto;
  inset-block-end: calc(100% + 4px);
}

.colorSourceList button {
  min-inline-size: 0;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: calc(4px * var(--ui-roundness));
  padding: 6px;
  color: var(--primary-text-color);
  background: transparent;
  text-align: start;
  cursor: pointer;
}

.colorSourceList button:hover,
.colorSourceList button:focus-visible {
  background: var(--side-nav-hover-color);
}

.colorSourceList button > span:nth-child(2) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.colorSourceList code {
  color: var(--tertiary-text-color);
  font-size: 0.72rem;
}

.sourceSwatch {
  position: relative;
  display: block;
  inline-size: 22px;
  block-size: 22px;
  overflow: hidden;
  border: 0;
  border-radius: calc(4px * var(--ui-roundness));
}

.sourceSwatch > span {
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.pickerStatus {
  color: var(--secondary-text-color);
}
</style>
