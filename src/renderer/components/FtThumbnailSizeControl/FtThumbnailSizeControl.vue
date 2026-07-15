<template>
  <FtIconButton
    class="thumbnailSizeButton"
    :title="t('Settings.Theme Settings.Thumbnail Size')"
    :icon="['fas', 'border-all']"
    theme="base-no-default"
    :use-shadow="false"
    :force-dropdown="true"
    dropdown-position-x="left"
  >
    <div class="sliderContainer">
      <FtSlider
        class="thumbnailSizeSlider"
        :label="t('Settings.Theme Settings.Thumbnail Size')"
        :default-value="thumbnailSize"
        :min-value="MIN_THUMBNAIL_SIZE"
        :max-value="MAX_THUMBNAIL_SIZE"
        :step="THUMBNAIL_SIZE_STEP"
        value-extension="%"
        @input="previewThumbnailSize"
        @change="updateThumbnailSize"
      />
    </div>
  </FtIconButton>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtIconButton from '../FtIconButton/FtIconButton.vue'
import FtSlider from '../FtSlider/FtSlider.vue'

import store from '../../store/index'

import {
  MAX_THUMBNAIL_SIZE,
  MIN_THUMBNAIL_SIZE,
  THUMBNAIL_SIZE_STEP
} from '../../constants/thumbnailSize'

const { t } = useI18n()

/** @type {import('vue').ComputedRef<number>} */
const thumbnailSize = computed(() => store.getters.getThumbnailSize)

/**
 * @param {number} value
 */
function previewThumbnailSize(value) {
  store.commit('setThumbnailSize', value)
}

/**
 * @param {number} value
 */
function updateThumbnailSize(value) {
  store.dispatch('updateThumbnailSize', value)
}
</script>

<style scoped src="./FtThumbnailSizeControl.css" />
