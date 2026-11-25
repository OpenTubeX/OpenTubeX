<template>
  <button
    type="button"
    class="translationButton"
    :disabled="loading"
    :aria-busy="loading"
  >
    <FtLoader
      v-if="loading"
      inline
      size="14px"
      :label="loadingLabel"
      :tab-loading-indicator="false"
    />
    <template v-else>
      <FtIcon
        :icon="['fas', 'language']"
        aria-hidden="true"
      />
      <template v-if="translated">
        {{ $t('Comments.Show original') }}
      </template>
      <template v-else>
        {{ $t('Comments.Translate to {language}', { language: languageName }) }}
      </template>
    </template>
  </button>
</template>

<script setup>
import { FtIcon } from '@opentubex/icons'

import FtLoader from '../FtLoader/FtLoader.vue'

defineProps({
  loading: {
    type: Boolean,
    required: true
  },
  /** Whether the translation is shown, so the button switches back to the original. */
  translated: {
    type: Boolean,
    required: true
  },
  languageName: {
    type: String,
    required: true
  },
  loadingLabel: {
    type: String,
    required: true
  }
})
</script>

<style scoped src="./FtTranslationButton.css" />
