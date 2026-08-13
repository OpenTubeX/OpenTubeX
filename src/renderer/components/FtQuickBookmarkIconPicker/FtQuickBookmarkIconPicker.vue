<template>
  <fieldset class="quickBookmarkIconPicker">
    <legend>{{ t('User Playlists.Quick Bookmark Icon') }}</legend>
    <div class="iconGallery">
      <button
        v-for="icon in QUICK_BOOKMARK_ICONS"
        :key="icon"
        type="button"
        class="iconOption"
        :class="{ selected: icon === modelValue }"
        :aria-label="iconLabels[icon]"
        :aria-pressed="icon === modelValue"
        :title="iconLabels[icon]"
        @click="emit('update:modelValue', icon)"
      >
        <FtIcon :icon="['fas', icon]" />
      </button>
    </div>
    <div
      class="emojiGallery"
      role="group"
      :aria-label="t('Profile.Choose an Emoji')"
    >
      <button
        v-for="emoji in EMOJI_OPTIONS"
        :key="emoji"
        type="button"
        class="iconOption emojiOption"
        :class="{ selected: isSelectedEmoji(emoji) }"
        :aria-label="emoji"
        :aria-pressed="isSelectedEmoji(emoji)"
        @click="selectEmoji(emoji)"
      >
        {{ emoji }}
      </button>
    </div>
    <label
      class="customEmojiLabel"
      :for="customEmojiId"
    >
      {{ t('User Playlists.Custom Emoji') }}
    </label>
    <input
      :id="customEmojiId"
      class="customEmojiInput"
      type="text"
      inputmode="text"
      :placeholder="t('Profile.Emoji')"
      :value="selectedEmoji"
      @input="selectCustomEmoji"
    >
    <input
      ref="imageInput"
      class="imageInput"
      type="file"
      accept="image/*,image/svg+xml,.svg"
      :aria-label="t('User Playlists.Choose Image')"
      @change="selectImage"
    >
    <FtFlexBox class="iconActions">
      <FtButton
        :label="t('User Playlists.Choose Image')"
        :icon="['fas', 'file-image']"
        @click="openImagePicker"
      />
      <FtButton
        v-if="typeof modelValue !== 'string'"
        :label="t('User Playlists.Use Bookmark Icon')"
        :icon="['fas', 'undo']"
        @click="emit('update:modelValue', 'bookmark')"
      />
    </FtFlexBox>
  </fieldset>
  <FtPrompt
    v-if="cropDialogOpen"
    autosize
    :label="t('Profile.Crop Image')"
    @click="cancelCrop"
  >
    <div class="cropEditor">
      <div class="cropCanvasWrapper">
        <canvas
          ref="cropCanvas"
          class="cropCanvas"
          width="320"
          height="320"
          @pointerdown="startCropDrag"
          @pointermove="moveCrop"
          @pointerup="stopCropDrag"
          @pointercancel="stopCropDrag"
        />
        <div class="cropOutline" />
      </div>
      <FtSlider
        class="cropZoom"
        :label="t('Profile.Zoom')"
        :default-value="cropZoom"
        :min-value="1"
        :max-value="4"
        :step="0.01"
        @input="cropZoom = $event"
      />
      <FtFlexBox class="cropActions">
        <FtButton
          :label="t('Profile.Apply Crop')"
          :icon="['fas', 'scissors']"
          @click="applyCrop"
        />
        <FtButton
          :label="t('Cancel')"
          :icon="['fas', 'xmark']"
          @click="cancelCrop"
        />
      </FtFlexBox>
    </div>
  </FtPrompt>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, useTemplateRef, watch } from 'vue'
import { FtIcon } from '@opentubex/icons'
import { useI18n } from 'vue-i18n'

import FtButton from '../FtButton/FtButton.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtSlider from '../FtSlider/FtSlider.vue'

import { QUICK_BOOKMARK_ICONS } from '../../helpers/quickBookmarkIcons'
import { getFirstCharacter } from '../../helpers/strings'
import { showToast } from '../../helpers/utils'

const props = defineProps({
  modelValue: {
    type: [String, Object],
    required: true,
  },
})

const emit = defineEmits(['update:modelValue'])
const { locale, t } = useI18n()

const iconLabels = {
  bookmark: 'Bookmark',
  clock: 'Watch later',
  heart: 'Favorite',
  list: 'List',
  play: 'Play',
  film: 'Film',
}

const EMOJI_OPTIONS = ['⭐', '💖', '🕖', '🎬', '🎧', '🎮', '💡', '📌', '🚀', '🌈']

const customEmojiId = useId()
const imageInput = useTemplateRef('imageInput')
const cropCanvas = useTemplateRef('cropCanvas')
const cropDialogOpen = ref(false)
const cropZoom = ref(1)
const cropOffset = { x: 0, y: 0 }
let cropBitmap = null
let cropPointer = null
let imageSelectionRequest = 0

const selectedEmoji = computed(() => {
  return props.modelValue?.type === 'emoji' ? props.modelValue.value : ''
})

watch(cropZoom, () => {
  constrainCropOffset()
  drawCropPreview()
})

onBeforeUnmount(() => {
  imageSelectionRequest++
  cropBitmap?.close?.()
})

function isSelectedEmoji(emoji) {
  return props.modelValue?.type === 'emoji' && props.modelValue.value === emoji
}

function selectEmoji(emoji) {
  emit('update:modelValue', { type: 'emoji', value: emoji })
}

function selectCustomEmoji(event) {
  const candidate = event.target.value ? getFirstCharacter(event.target.value, locale.value) : ''

  if (candidate && !isEmoji(candidate)) {
    event.target.value = selectedEmoji.value
    return
  }

  event.target.value = candidate
  emit('update:modelValue', candidate
    ? { type: 'emoji', value: candidate }
    : 'bookmark')
}

function isEmoji(value) {
  return /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u20E3)/u.test(value)
}

function openImagePicker() {
  imageInput.value?.click()
}

async function selectImage(event) {
  const request = ++imageSelectionRequest
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  try {
    const bitmap = await loadCropBitmap(file)
    if (request !== imageSelectionRequest) {
      bitmap.close?.()
      return
    }

    cropBitmap?.close?.()
    cropBitmap = bitmap
    cropZoom.value = 1
    cropOffset.x = 0
    cropOffset.y = 0
    cropDialogOpen.value = true
    await nextTick()
    drawCropPreview()
  } catch (error) {
    if (request !== imageSelectionRequest) return

    console.error('Failed to load quick bookmark icon image:', error)
    showToast({
      message: t('Profile.The selected image could not be loaded'),
      icon: ['fas', 'circle-exclamation'],
    })
  }
}

async function loadCropBitmap(file) {
  const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')
  if (!isSvg) return await createImageBitmap(file)

  const svg = await file.text()
  const visibleSvg = svg.replaceAll(/\bcurrentColor\b/gi, '#FFFFFF')
  const objectUrl = URL.createObjectURL(new Blob([visibleSvg], { type: 'image/svg+xml' }))

  try {
    const image = new Image()
    image.src = objectUrl
    await image.decode()

    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if (width === 0 || height === 0) throw new Error('SVG has no intrinsic dimensions')

    const renderScale = Math.min(1024 / Math.max(width, height), 1024)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * renderScale))
    canvas.height = Math.max(1, Math.round(height * renderScale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)

    return canvas
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function getCropScale() {
  if (!cropBitmap) return 1

  return Math.max(320 / cropBitmap.width, 320 / cropBitmap.height) * cropZoom.value
}

function constrainCropOffset() {
  if (!cropBitmap) return

  const scale = getCropScale()
  const maxX = Math.max(0, (cropBitmap.width * scale - 320) / 2)
  const maxY = Math.max(0, (cropBitmap.height * scale - 320) / 2)
  cropOffset.x = Math.min(maxX, Math.max(-maxX, cropOffset.x))
  cropOffset.y = Math.min(maxY, Math.max(-maxY, cropOffset.y))
}

function drawCropPreview() {
  if (!cropBitmap || !cropCanvas.value) return

  const context = cropCanvas.value.getContext('2d')
  const scale = getCropScale()
  const width = cropBitmap.width * scale
  const height = cropBitmap.height * scale
  context.clearRect(0, 0, 320, 320)
  context.drawImage(
    cropBitmap,
    (320 - width) / 2 + cropOffset.x,
    (320 - height) / 2 + cropOffset.y,
    width,
    height,
  )
}

function startCropDrag(event) {
  cropPointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  }
  event.currentTarget.setPointerCapture(event.pointerId)
}

function moveCrop(event) {
  if (cropPointer?.id !== event.pointerId) return

  const displayScale = 320 / event.currentTarget.getBoundingClientRect().width
  cropOffset.x += (event.clientX - cropPointer.x) * displayScale
  cropOffset.y += (event.clientY - cropPointer.y) * displayScale
  cropPointer.x = event.clientX
  cropPointer.y = event.clientY
  constrainCropOffset()
  drawCropPreview()
}

function stopCropDrag(event) {
  if (cropPointer?.id === event.pointerId) cropPointer = null
}

function applyCrop() {
  if (!cropBitmap) return

  const scale = getCropScale()
  const sourceSize = 320 / scale
  const sourceX = (cropBitmap.width - sourceSize) / 2 - cropOffset.x / scale
  const sourceY = (cropBitmap.height - sourceSize) / 2 - cropOffset.y / scale
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  canvas.getContext('2d').drawImage(
    cropBitmap,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    canvas.width,
    canvas.height,
  )

  emit('update:modelValue', {
    type: 'image',
    value: canvas.toDataURL('image/webp', 0.9),
  })
  closeCropEditor()
}

function cancelCrop() {
  closeCropEditor()
}

function closeCropEditor() {
  cropDialogOpen.value = false
  cropPointer = null
  cropBitmap?.close?.()
  cropBitmap = null
}
</script>

<style scoped>
.quickBookmarkIconPicker {
  align-items: center;
  border: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px auto;
  padding: 0;
}

.quickBookmarkIconPicker legend {
  color: var(--secondary-text-color);
  font-size: 14px;
  margin-block-end: 6px;
  text-align: center;
}

.iconGallery,
.emojiGallery {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  max-inline-size: 280px;
}

.iconOption {
  align-items: center;
  background: var(--card-bg-color);
  border: 2px solid transparent;
  border-radius: calc(6px * var(--ui-roundness));
  color: var(--primary-text-color);
  cursor: pointer;
  display: flex;
  font-size: 18px;
  block-size: 40px;
  inline-size: 40px;
  justify-content: center;
  padding: 0;
}

.emojiOption {
  font-size: 22px;
}

.iconOption:hover,
.iconOption:focus-visible {
  background: var(--side-nav-hover-color);
}

.iconOption.selected {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.customEmojiLabel {
  font-size: 14px;
}

.customEmojiInput {
  background: var(--search-bar-color);
  border: 1px solid var(--scrollbar-color);
  border-radius: calc(4px * var(--ui-roundness));
  color: var(--primary-text-color);
  font-size: 24px;
  inline-size: 80px;
  padding: 6px;
  text-align: center;
}

.imageInput {
  display: none;
}

.iconActions,
.cropActions {
  justify-content: center;
}

.cropEditor {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cropCanvasWrapper {
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #bbb 25%, transparent 25%),
    linear-gradient(-45deg, #bbb 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #bbb 75%),
    linear-gradient(-45deg, transparent 75%, #bbb 75%);
  background-position: 0 0, 0 12px, 12px -12px, -12px 0;
  background-size: 24px 24px;
  block-size: min(320px, calc(100vw - 80px));
  inline-size: min(320px, calc(100vw - 80px));
  overflow: hidden;
  position: relative;
}

.cropCanvas {
  block-size: 100%;
  cursor: grab;
  inline-size: 100%;
  touch-action: none;
}

.cropCanvas:active {
  cursor: grabbing;
}

.cropOutline {
  border: 2px solid #fff;
  box-shadow: 0 0 0 999px rgb(0 0 0 / 25%);
  inset: 0;
  pointer-events: none;
  position: absolute;
}

.cropZoom {
  inline-size: min(320px, calc(100vw - 80px));
  margin-block: 0;
  margin-inline: 0;
}
</style>
