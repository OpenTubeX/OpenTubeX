<template>
  <div>
    <FtCard class="card">
      <h2>{{ editOrCreateProfileLabel }}</h2>
      <FtFlexBox class="profileEdit">
        <div>
          <h3>{{ $t("Profile.Color Picker") }}</h3>
          <FtFlexBox
            class="colorOptions"
          >
            <div
              v-for="color in COLOR_VALUES"
              :key="color"
              class="colorOption"
              :class="{ selected: profileBgColor.toLowerCase() === color.toLowerCase() }"
              :title="color + ' ' + $t('Profile.Custom Color')"
              :style="{ background: color }"
              tabindex="0"
              role="button"
              @click="profileBgColor = color"
              @keydown.enter.space.prevent="profileBgColor = color"
            />
            <div
              v-if="profileIcon?.type === 'image'"
              class="colorOption transparentColorOption"
              :class="{ selected: profileBgColor === 'transparent' }"
              :title="$t('Profile.Transparent')"
              tabindex="0"
              role="button"
              @click="profileBgColor = 'transparent'"
              @keydown.enter.space.prevent="profileBgColor = 'transparent'"
            />
          </FtFlexBox>
          <div class="customColorSection">
            <label for="colorPicker">{{ $t("Profile.Custom Color") }}</label>
            <input
              id="colorPicker"
              type="color"
              :value="customColorPickerValue"
              @input="profileBgColor = $event.target.value"
            >
          </div>
          <FtInput
            class="colorSelection"
            placeholder=""
            :value="profileBgColor"
            :show-action-button="false"
            :disabled="true"
          />
        </div>
        <div class="secondEditRow">
          <div>
            <h3>{{ editOrCreateProfileNameLabel }}</h3>
            <FtInput
              class="profileName"
              :placeholder="$t('Profile.Profile Name')"
              :disabled="isMainProfile"
              :value="translatedProfileName"
              :show-action-button="false"
              :maxlength="100"
              @input="profileName = $event"
              @keydown.enter="saveProfile"
            />
            <h3 class="profileIconHeading">
              {{ $t("Profile.Profile Icon") }}
            </h3>
            <div class="profileIconOptions">
              <div
                class="emojiOptions"
                role="group"
                :aria-label="$t('Profile.Choose an Emoji')"
              >
                <button
                  v-for="emoji in EMOJI_OPTIONS"
                  :key="emoji"
                  type="button"
                  class="emojiOption"
                  :class="{ selected: profileIcon?.type === 'emoji' && profileIcon.value === emoji }"
                  :aria-pressed="profileIcon?.type === 'emoji' && profileIcon.value === emoji"
                  @click="selectEmoji(emoji)"
                >
                  {{ emoji }}
                </button>
              </div>
              <label
                class="customEmojiLabel"
                for="profileEmoji"
              >
                {{ $t("Profile.Custom Emoji") }}
              </label>
              <input
                id="profileEmoji"
                class="customEmojiInput"
                type="text"
                inputmode="text"
                :placeholder="$t('Profile.Emoji')"
                :value="profileIcon?.type === 'emoji' ? profileIcon.value : ''"
                @input="selectCustomEmoji"
              >
              <input
                ref="imageInput"
                class="imageInput"
                type="file"
                accept="image/*,image/svg+xml,.svg"
                :aria-label="$t('Profile.Choose Image')"
                @change="selectImage"
              >
              <FtFlexBox class="iconActions">
                <FtButton
                  :label="$t('Profile.Choose Image')"
                  :icon="['fas', 'file-image']"
                  @click="openImagePicker"
                />
                <FtButton
                  v-if="profileIcon"
                  :label="$t('Profile.Use Initial')"
                  :icon="['fas', 'undo']"
                  @click="clearProfileIcon"
                />
              </FtFlexBox>
            </div>
          </div>
          <div>
            <h3>{{ $t("Profile.Profile Preview") }}</h3>
            <div class="profilePreviewSection">
              <FtProfileIcon
                class="profilePreviewIcon"
                :profile="profilePreview"
                :fallback="profileInitial"
              />
              <FtFlexBox>
                <FtButton
                  v-if="isNew"
                  :label="$t('Profile.Create Profile')"
                  :icon="['fas', 'user-plus']"
                  @click="saveProfile"
                />
                <template
                  v-else
                >
                  <FtButton
                    :label="$t('Profile.Update Profile')"
                    :icon="['fas', 'user-check']"
                    @click="saveProfile"
                  />
                  <FtButton
                    :label="$t('Profile.Make Default Profile')"
                    :disabled="defaultProfile === profileId"
                    :icon="['fas', 'bookmark']"
                    @click="setDefaultProfile"
                  />
                  <FtButton
                    v-if="!isMainProfile"
                    :label="$t('Profile.Delete Profile')"
                    text-color="var(--destructive-text-color)"
                    background-color="var(--destructive-color)"
                    :icon="['fas', 'trash']"
                    @click="showDeletePrompt = true"
                  />
                </template>
              </FtFlexBox>
            </div>
          </div>
        </div>
      </FtFlexBox>
    </FtCard>
    <FtPrompt
      v-if="cropDialogOpen"
      autosize
      :label="$t('Profile.Crop Image')"
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
          <div class="cropCircle" />
        </div>
        <label
          class="cropZoomLabel"
          for="profileCropZoom"
        >
          {{ $t("Profile.Zoom") }}
        </label>
        <input
          id="profileCropZoom"
          v-model.number="cropZoom"
          class="cropZoom"
          type="range"
          min="1"
          max="4"
          step="0.01"
        >
        <FtFlexBox class="cropActions">
          <FtButton
            :label="$t('Profile.Apply Crop')"
            :icon="['fas', 'scissors']"
            @click="applyCrop"
          />
          <FtButton
            :label="$t('Cancel')"
            :icon="['fas', 'xmark']"
            @click="cancelCrop"
          />
        </FtFlexBox>
      </div>
    </FtPrompt>
    <FtPrompt
      v-if="showDeletePrompt"
      autosize
      :label="deletePromptLabel"
      :option-names="deletePromptNames"
      :option-values="DELETE_PROMPT_VALUES"
      :is-first-option-destructive="true"
      @click="handleDeletePrompt"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtCard from '../ft-card/ft-card.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtInput from '../FtInput/FtInput.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtProfileIcon from '../FtProfileIcon/FtProfileIcon.vue'

import store from '../../store/index'

import { MAIN_PROFILE_ID } from '../../../constants'
import { calculateColorLuminance, colors, getRandomColor } from '../../helpers/colors'
import { deepCopy, showToast } from '../../helpers/utils'
import { getFirstCharacter } from '../../helpers/strings'

/**
 * @typedef {object} Profile
 * @property {string} _id
 * @property {string} name
 * @property {string} bgColor
 * @property {string} textColor
 * @property {{type: 'emoji'|'image', value: string}|null|undefined} icon
 * @property {object[]} subscriptions
 * @property {string} subscriptions[].id
 * @property {string|undefined} subscriptions[].name
 * @property {string|undefined} subscriptions[].thumbnail
 */

const { locale, t } = useI18n()

const props = defineProps({
  isMainProfile: {
    type: Boolean,
    required: true
  },
  isNew: {
    type: Boolean,
    required: true
  },
  profile: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['new-profile-created', 'profile-deleted'])

const COLOR_VALUES = colors.map(color => color.value)

/** @type {import('vue').ComputedRef<Profile>} */
const activeProfile = computed(() => store.getters.getActiveProfile)

/** @type {import('vue').Ref<string | undefined>} */
const profileId = ref(props.profile._id)

/** @type {import('vue').Ref<string>} */
const profileName = ref(props.profile.name)

/** @type {import('vue').Ref<string>} */
const profileBgColor = ref(props.profile.bgColor)
const lastOpaqueProfileBgColor = ref(
  props.profile.bgColor === 'transparent' ? getRandomColor().value : props.profile.bgColor
)

/** @type {import('vue').Ref<string>} */
const profileTextColor = ref(props.profile.textColor)

const profileIcon = ref(deepCopy(props.profile.icon ?? null))

const imageInput = useTemplateRef('imageInput')
const cropCanvas = useTemplateRef('cropCanvas')
const cropDialogOpen = ref(false)
const cropZoom = ref(1)
const cropOffset = { x: 0, y: 0 }
let cropBitmap = null
let cropPointer = null
let imageSelectionRequest = 0

const EMOJI_OPTIONS = ['😀', '😎', '🤓', '🥳', '🤠', '👻', '🐱', '🐶', '🌈', '⭐']

watch(profileBgColor, (value) => {
  profileTextColor.value = calculateColorLuminance(value)
  if (value !== 'transparent') lastOpaqueProfileBgColor.value = value
})

watch(profileIcon, (icon) => {
  if (icon?.type !== 'image') restoreOpaqueProfileColor()
})

watch(cropZoom, () => {
  constrainCropOffset()
  drawCropPreview()
})

onBeforeUnmount(() => {
  imageSelectionRequest++
  cropBitmap?.close?.()
})

const customColorPickerValue = computed(() => {
  return profileBgColor.value === 'transparent' ? '#000000' : profileBgColor.value
})

const translatedProfileName = computed(() => {
  return props.isMainProfile ? t('Profile.All Channels') : profileName.value
})

const profileInitial = computed(() => {
  return profileName.value
    ? getFirstCharacter(translatedProfileName.value, locale.value)
    : ''
})

const profilePreview = computed(() => ({
  bgColor: profileBgColor.value,
  textColor: profileTextColor.value,
  icon: profileIcon.value
}))

const editOrCreateProfileLabel = computed(() => {
  return props.isNew ? t('Profile.Create Profile') : t('Profile.Edit Profile')
})

const editOrCreateProfileNameLabel = computed(() => {
  return props.isNew ? t('Profile.Create Profile Name') : t('Profile.Edit Profile Name')
})

function saveProfile() {
  if (profileName.value === '') {
    showToast({ message: t('Profile.Your profile name cannot be empty'), icon: ['fas', 'circle-exclamation'] })
    return
  }

  const profile = {
    name: profileName.value,
    bgColor: profileBgColor.value,
    textColor: profileTextColor.value,
    icon: deepCopy(profileIcon.value),
    subscriptions: deepCopy(props.profile.subscriptions)
  }

  if (!props.isNew) {
    profile._id = profileId.value
  }

  if (props.isNew) {
    store.dispatch('createProfile', profile)
    showToast({ message: t('Profile.Profile has been created'), icon: ['fas', 'user-plus'] })
    emit('new-profile-created')
  } else {
    store.dispatch('updateProfile', profile)
    showToast({ message: t('Profile.Profile has been updated'), icon: ['fas', 'user-check'] })
  }
}

function selectEmoji(emoji) {
  profileIcon.value = { type: 'emoji', value: emoji }
  restoreOpaqueProfileColor()
}

function selectCustomEmoji(event) {
  const value = event.target.value
  const candidate = value ? getFirstCharacter(value, locale.value) : ''
  const currentEmoji = profileIcon.value?.type === 'emoji' ? profileIcon.value.value : ''

  if (candidate && !isEmoji(candidate)) {
    event.target.value = currentEmoji
    return
  }

  event.target.value = candidate
  profileIcon.value = candidate ? { type: 'emoji', value: candidate } : null
  restoreOpaqueProfileColor()
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

    console.error('Failed to load profile icon image:', error)
    showToast({
      message: t('Profile.The selected image could not be loaded'),
      icon: ['fas', 'circle-exclamation']
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
    height
  )
}

function startCropDrag(event) {
  cropPointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY
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
    canvas.height
  )

  profileIcon.value = {
    type: 'image',
    value: canvas.toDataURL('image/webp', 0.9)
  }
  profileBgColor.value = 'transparent'
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

function clearProfileIcon() {
  profileIcon.value = null
  restoreOpaqueProfileColor()
}

function restoreOpaqueProfileColor() {
  if (profileBgColor.value === 'transparent') {
    profileBgColor.value = lastOpaqueProfileBgColor.value
  }
}

function setDefaultProfile() {
  store.dispatch('updateDefaultProfile', profileId.value)
  showToast({
    message: t('Profile.Your default profile has been set to {profile}', { profile: translatedProfileName.value }),
    icon: ['fas', 'user-check'],
  })
}

const DELETE_PROMPT_VALUES = ['delete', 'cancel']

const deletePromptNames = computed(() => [
  t('Yes, Delete'),
  t('Cancel')
])

const deletePromptLabel = computed(() => {
  return `${t('Profile.Are you sure you want to delete this profile?')} ${t('Profile["All subscriptions will also be deleted."]')}`
})

const showDeletePrompt = ref(false)

/** @type {import('vue').ComputedRef<string>} */
const defaultProfile = computed(() => store.getters.getDefaultProfile)

/**
 * @param {'delete' | 'cancel' | null} response
 */
function handleDeletePrompt(response) {
  if (response === 'delete') {
    if (activeProfile.value._id === profileId.value) {
      store.dispatch('updateActiveProfile', MAIN_PROFILE_ID)
    }

    store.dispatch('removeProfile', profileId.value)

    showToast({
      message: t('Profile.Removed {profile} from your profiles', { profile: translatedProfileName.value }),
      icon: ['fas', 'trash'],
    })

    if (defaultProfile.value === profileId.value) {
      store.dispatch('updateDefaultProfile', MAIN_PROFILE_ID)
      showToast({
        message: t('Profile.Your default profile has been changed to your primary profile'),
        icon: ['fas', 'user-check'],
      })
    }

    emit('profile-deleted')
  } else {
    showDeletePrompt.value = false
  }
}
</script>

<style scoped src="./FtProfileEdit.css" />
