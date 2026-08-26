<template>
  <div
    v-if="translationAvailable"
    class="commentTranslation"
  >
    <button
      type="button"
      class="commentTranslationButton"
      :disabled="loading"
      :aria-busy="loading"
      @click="emit('translate-comment', comment)"
    >
      <FtSpinner
        v-if="loading"
        inline
        size="14px"
        border-width="2px"
        :label="$t('Comments.Translating comment, please wait')"
      />
      <template v-else-if="comment.showTranslated && comment.translatedLanguage === targetLanguage">
        {{ $t('Comments.Show original') }}
      </template>
      <template v-else>
        {{ $t('Comments.Translate to {language}', { language: targetLanguageName }) }}
      </template>
    </button>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

import FtSpinner from '../FtSpinner/FtSpinner.vue'
import { shouldOfferCommentTranslation } from '../../helpers/comment-translations'

const props = defineProps({
  comment: {
    type: Object,
    required: true
  },
  loading: {
    type: Boolean,
    required: true
  },
  targetLanguage: {
    type: String,
    required: true
  },
  targetLanguageName: {
    type: String,
    required: true
  },
  ignoredLanguages: {
    type: Array,
    required: true
  }
})

const translationAvailable = ref(false)
let detectionGeneration = 0
const emit = defineEmits(['translate-comment', 'translation-unavailable'])

watch(
  [() => props.comment.translationText, () => props.targetLanguage, () => props.ignoredLanguages],
  async ([text, targetLanguage, ignoredLanguages]) => {
    const generation = ++detectionGeneration
    translationAvailable.value = false

    try {
      const available = await shouldOfferCommentTranslation(text, targetLanguage, ignoredLanguages)
      if (generation === detectionGeneration) {
        translationAvailable.value = available
        if (!available && props.comment.showTranslated) {
          emit('translation-unavailable', props.comment)
        }
      }
    } catch (error) {
      console.error('Comment language detection failed', error)
    }
  },
  { immediate: true }
)
</script>

<style scoped src="./CommentSection.css" />
