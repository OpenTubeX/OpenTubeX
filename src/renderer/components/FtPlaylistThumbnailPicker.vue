<template>
  <fieldset
    class="playlistThumbnailPicker"
    :aria-busy="loading"
  >
    <legend>{{ t('User Playlists.Playlist Thumbnail') }}</legend>
    <FtRetryImage
      class="thumbnailPreview"
      :src="modelValue || defaultThumbnail"
      alt=""
    />
    <input
      ref="imageInput"
      class="imageInput"
      type="file"
      accept="image/*"
      :aria-label="t('User Playlists.Choose Image')"
      @change="selectImage"
    >
    <FtFlexBox class="thumbnailActions">
      <FtButton
        :label="t('User Playlists.Choose Image')"
        :icon="['fas', 'file-image']"
        :disabled="loading"
        @click="imageInput?.click()"
      />
      <FtButton
        v-if="modelValue"
        :label="t('User Playlists.Restore Default Thumbnail')"
        :icon="['fas', 'undo']"
        :disabled="loading"
        @click="emit('update:modelValue', '')"
      />
    </FtFlexBox>
  </fieldset>
</template>

<script setup>
import { onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import FtButton from './FtButton/FtButton.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtRetryImage from './FtRetryImage.vue'
import { showToast } from '../helpers/utils'

defineProps({
  modelValue: { type: String, required: true },
  defaultThumbnail: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue', 'loading'])
const { t } = useI18n()
const imageInput = useTemplateRef('imageInput')
const loading = ref(false)
let disposed = false

onBeforeUnmount(() => { disposed = true })

async function selectImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || loading.value) return

  loading.value = true
  emit('loading', true)
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (disposed) return

    // Store a portable, bounded image instead of a path to the original file.
    const scale = Math.min(1, 1280 / image.naturalWidth, 720 / image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    emit('update:modelValue', canvas.toDataURL('image/webp', 0.9))
  } catch (error) {
    if (disposed) return
    console.error('Failed to load playlist thumbnail:', error)
    showToast({
      message: t('Profile.The selected image could not be loaded'),
      icon: ['fas', 'circle-exclamation'],
    })
  } finally {
    URL.revokeObjectURL(url)
    loading.value = false
    if (!disposed) emit('loading', false)
  }
}
</script>

<style scoped>
.playlistThumbnailPicker {
  align-items: center;
  border: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px auto;
  min-inline-size: 0;
  padding: 0;
}

.playlistThumbnailPicker legend {
  color: var(--secondary-text-color);
  font-size: 14px;
  margin-block-end: 6px;
  text-align: center;
}

.thumbnailPreview {
  aspect-ratio: 16 / 9;
  border-radius: calc(8px * var(--ui-roundness));
  inline-size: 240px;
  max-inline-size: 100%;
  object-fit: cover;
}

.imageInput {
  display: none;
}

.thumbnailActions {
  gap: 8px;
  justify-content: center;
}
</style>
