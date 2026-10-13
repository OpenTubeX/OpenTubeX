<template>
  <fieldset
    class="playlistThumbnailPicker"
    :aria-busy="loading"
  >
    <legend>{{ t('User Playlists.Playlist Thumbnail') }}</legend>
    <FtRetryImage
      class="thumbnailPreview"
      :src="thumbnailForDisplay"
      :class="{ blur: store.getters.getBlurThumbnails }"
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
import { computed, onBeforeUnmount, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import FtButton from './FtButton/FtButton.vue'
import FtFlexBox from './ft-flex-box/ft-flex-box.vue'
import FtRetryImage from './FtRetryImage.vue'
import { showToast } from '../helpers/utils'
import { normalizePlaylistThumbnail } from '../helpers/playlist-thumbnails'
import store from '../store/index'
import thumbnailPlaceholder from '../assets/img/thumbnail_placeholder.svg'

const props = defineProps({
  modelValue: { type: String, required: true },
  defaultThumbnail: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue', 'loading'])
const { t } = useI18n()
const imageInput = useTemplateRef('imageInput')
const loading = ref(false)
let disposed = false
const thumbnailForDisplay = computed(() => store.getters.getThumbnailPreference === 'hidden'
  ? thumbnailPlaceholder
  : props.modelValue || props.defaultThumbnail)

onBeforeUnmount(() => { disposed = true })

async function selectImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || loading.value) return

  loading.value = true
  emit('loading', true)
  try {
    const thumbnail = await normalizePlaylistThumbnail(file)
    if (disposed) return
    emit('update:modelValue', thumbnail)
  } catch (error) {
    if (disposed) return
    console.error('Failed to load playlist thumbnail:', error)
    showToast({
      message: t('Profile.The selected image could not be loaded'),
      icon: ['fas', 'circle-exclamation'],
    })
  } finally {
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

.thumbnailPreview.blur {
  clip-path: inset(0 round calc(8px * var(--ui-roundness)));
  filter: blur(20px);
}

.imageInput {
  display: none;
}

.thumbnailActions {
  gap: 8px;
  justify-content: center;
}
</style>
