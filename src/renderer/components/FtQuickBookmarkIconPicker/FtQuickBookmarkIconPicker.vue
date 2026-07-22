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
        <FontAwesomeIcon :icon="['fas', icon]" />
      </button>
    </div>
  </fieldset>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { QUICK_BOOKMARK_ICONS } from '../../helpers/quickBookmarkIcons'

defineProps({
  modelValue: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()

const iconLabels = computed(() => ({
  bookmark: t('User Playlists.Quick Bookmark Icons.bookmark'),
  clock: t('User Playlists.Quick Bookmark Icons.clock'),
  heart: t('User Playlists.Quick Bookmark Icons.heart'),
  list: t('User Playlists.Quick Bookmark Icons.list'),
  play: t('User Playlists.Quick Bookmark Icons.play'),
  film: t('User Playlists.Quick Bookmark Icons.film'),
}))
</script>

<style scoped>
.quickBookmarkIconPicker {
  border: 0;
  margin: 8px 0;
  padding: 0;
}

.quickBookmarkIconPicker legend {
  color: var(--secondary-text-color);
  font-size: 14px;
  margin-block-end: 6px;
}

.iconGallery {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.iconOption {
  align-items: center;
  background: var(--card-bg-color);
  border: 2px solid transparent;
  border-radius: 6px;
  color: var(--primary-text-color);
  cursor: pointer;
  display: flex;
  font-size: 18px;
  block-size: 40px;
  inline-size: 40px;
  justify-content: center;
}

.iconOption:hover,
.iconOption:focus-visible {
  background: var(--side-nav-hover-color);
}

.iconOption.selected {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
</style>
