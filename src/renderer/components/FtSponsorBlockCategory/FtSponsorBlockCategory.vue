<template>
  <div class="sponsorBlockCategory">
    <div
      :id="id"
      class="sponsorTitle"
    >
      {{ translatedCategoryName }}
    </div>
    <FtSelect
      :describe-by-id="id"
      :placeholder="$t('Settings.SponsorBlock Settings.Category Color')"
      :value="sponsorBlockValues.color"
      :select-names="colorNames"
      :select-values="COLOR_VALUES"
      :icon="['fas', 'palette']"
      :class="'sec' + sponsorBlockValues.color"
      icon-color="rgb(var(--accent-color-rgb))"
      @change="updateColor"
    />
    <FtSelect
      :describe-by-id="id"
      :placeholder="$t('Settings.SponsorBlock Settings.Skip Options.Skip Option')"
      :value="sponsorBlockValues.skip"
      :select-names="skipNames"
      :select-values="selectableSkipValues"
      :icon="['fas', 'forward']"
      @change="updateSkipOption"
    />
  </div>
</template>

<script setup>
import { computed, useId } from 'vue'
import { useI18n } from '../../composables/use-i18n-polyfill'

import FtSelect from '../FtSelect/FtSelect.vue'

import store from '../../store/index'

import { colors } from '../../helpers/colors'
import { useColorTranslations } from '../../composables/colors'

const props = defineProps({
  categoryName: {
    type: String,
    required: true
  }
})

const { t } = useI18n()

const SKIP_VALUES = [
  'autoSkip',
  'promptToSkip',
  'showInSeekBar',
  'doNothing'
]

const HIGHLIGHT_SKIP_VALUES = [
  'promptToSkip',
  'showInSeekBar',
  'doNothing'
]

const skipOptionNamesByValue = computed(() => ({
  autoSkip: t('Settings.SponsorBlock Settings.Skip Options.Auto Skip'),
  promptToSkip: t('Settings.SponsorBlock Settings.Skip Options.Prompt To Skip'),
  showInSeekBar: t('Settings.SponsorBlock Settings.Skip Options.Show In Seek Bar'),
  doNothing: t('Settings.SponsorBlock Settings.Skip Options.Do Nothing')
}))

const selectableSkipValues = computed(() => {
  return props.categoryName === 'highlight' ? HIGHLIGHT_SKIP_VALUES : SKIP_VALUES
})

const skipNames = computed(() => selectableSkipValues.value.map(value => skipOptionNamesByValue.value[value]))

const COLOR_VALUES = colors.map(color => color.name)
const colorNames = useColorTranslations()

const id = useId()

/** @type {import('vue').ComputedRef<{ color: string, skip: string }>} */
const sponsorBlockValues = computed(() => {
  switch (props.categoryName) {
    case 'sponsor':
      return store.getters.getSponsorBlockSponsor
    case 'self-promotion':
      return store.getters.getSponsorBlockSelfPromo
    case 'interaction':
      return store.getters.getSponsorBlockInteraction
    case 'intro':
      return store.getters.getSponsorBlockIntro
    case 'outro':
      return store.getters.getSponsorBlockOutro
    case 'recap':
      return store.getters.getSponsorBlockRecap
    case 'hook':
      return store.getters.getSponsorBlockHook
    case 'music offtopic':
      return store.getters.getSponsorBlockMusicOffTopic
    case 'filler':
      return store.getters.getSponsorBlockFiller
    case 'highlight': {
      const highlightValues = store.getters.getSponsorBlockHighlight
      return {
        ...highlightValues,
        skip: highlightValues.skip === 'autoSkip' ? 'promptToSkip' : highlightValues.skip
      }
    }
    default:
      return ''
  }
})

const translatedCategoryName = computed(() => {
  switch (props.categoryName) {
    case 'sponsor':
      return t('Video.Sponsor Block category.sponsor')
    case 'self-promotion':
      return t('Video.Sponsor Block category.self-promotion')
    case 'interaction':
      return t('Video.Sponsor Block category.interaction')
    case 'intro':
      return t('Video.Sponsor Block category.intro')
    case 'outro':
      return t('Video.Sponsor Block category.outro')
    case 'recap':
      return t('Video.Sponsor Block category.recap')
    case 'hook':
      return t('Video.Sponsor Block category.hook')
    case 'music offtopic':
      return t('Video.Sponsor Block category.music offtopic')
    case 'filler':
      return t('Video.Sponsor Block category.filler')
    case 'highlight':
      return t('Video.Sponsor Block category.highlight')
    default:
      return ''
  }
})

/**
 * @param {string} color
 */
function updateColor(color) {
  updateSponsorCategory({
    color,
    skip: sponsorBlockValues.value.skip
  })
}

/**
 * @param {string} skipOption
 */
function updateSkipOption(skipOption) {
  updateSponsorCategory({
    color: sponsorBlockValues.value.color,
    skip: skipOption
  })
}

/**
 * @param {{ color: string, skip: string }} payload
 */
function updateSponsorCategory(payload) {
  const nextPayload = props.categoryName === 'highlight' && payload.skip === 'autoSkip'
    ? { ...payload, skip: 'promptToSkip' }
    : payload

  switch (props.categoryName) {
    case 'sponsor':
      store.dispatch('updateSponsorBlockSponsor', nextPayload)
      break
    case 'self-promotion':
      store.dispatch('updateSponsorBlockSelfPromo', nextPayload)
      break
    case 'interaction':
      store.dispatch('updateSponsorBlockInteraction', nextPayload)
      break
    case 'intro':
      store.dispatch('updateSponsorBlockIntro', nextPayload)
      break
    case 'outro':
      store.dispatch('updateSponsorBlockOutro', nextPayload)
      break
    case 'recap':
      store.dispatch('updateSponsorBlockRecap', nextPayload)
      break
    case 'hook':
      store.dispatch('updateSponsorBlockHook', nextPayload)
      break
    case 'music offtopic':
      store.dispatch('updateSponsorBlockMusicOffTopic', nextPayload)
      break
    case 'filler':
      store.dispatch('updateSponsorBlockFiller', nextPayload)
      break
    case 'highlight':
      store.dispatch('updateSponsorBlockHighlight', nextPayload)
      break
  }
}
</script>

<style scoped src="./FtSponsorBlockCategory.css" />
