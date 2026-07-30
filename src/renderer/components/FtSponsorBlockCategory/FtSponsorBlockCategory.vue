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
      :setting-key="settingKey"
      :is-changed="isValueChanged('color')"
      :select-names="colorNames"
      :select-values="COLOR_VALUES"
      :icon="['fas', 'palette']"
      :class="'sec' + sponsorBlockValues.color"
      icon-color="rgb(var(--accent-color-rgb))"
      @change="updateColor"
      @reset="resetValue('color')"
    />
    <FtSelect
      :describe-by-id="id"
      :placeholder="$t('Settings.SponsorBlock Settings.Skip Options.Skip Option')"
      :value="sponsorBlockValues.skip"
      :setting-key="settingKey"
      :is-changed="isValueChanged('skip')"
      :select-names="skipNames"
      :select-values="selectableSkipValues"
      :icon="['fas', 'forward']"
      @change="updateSkipOption"
      @reset="resetValue('skip')"
    />
  </div>
</template>

<script setup>
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSelect from '../FtSelect/FtSelect.vue'

import store from '../../store/index'
import { DEFAULT_SETTINGS } from '../../store/modules/settings'

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
const storedSponsorBlockValues = computed(() => {
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
    case 'highlight':
      return store.getters.getSponsorBlockHighlight
    default:
      return ''
  }
})

/** @type {import('vue').ComputedRef<{ color: string, skip: string }>} */
const sponsorBlockValues = computed(() => ({
  ...storedSponsorBlockValues.value,
  skip: props.categoryName === 'highlight' && storedSponsorBlockValues.value.skip === 'autoSkip'
    ? 'promptToSkip'
    : storedSponsorBlockValues.value.skip
}))

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

const settingKey = computed(() => {
  const suffixes = {
    sponsor: 'Sponsor',
    'self-promotion': 'SelfPromo',
    interaction: 'Interaction',
    intro: 'Intro',
    outro: 'Outro',
    recap: 'Recap',
    hook: 'Hook',
    'music offtopic': 'MusicOffTopic',
    filler: 'Filler',
    highlight: 'Highlight'
  }
  return `sponsorBlock${suffixes[props.categoryName]}`
})

/**
 * @param {'color' | 'skip'} property
 * @returns {boolean}
 */
function isValueChanged(property) {
  return !Object.is(
    sponsorBlockValues.value[property],
    DEFAULT_SETTINGS[settingKey.value][property]
  )
}

/**
 * @param {'color' | 'skip'} property
 */
function resetValue(property) {
  updateSponsorCategory({
    ...storedSponsorBlockValues.value,
    [property]: DEFAULT_SETTINGS[settingKey.value][property]
  })
}

/**
 * @param {string} color
 */
function updateColor(color) {
  updateSponsorCategory({
    ...storedSponsorBlockValues.value,
    color,
  })
}

/**
 * @param {string} skipOption
 */
function updateSkipOption(skipOption) {
  updateSponsorCategory({
    ...storedSponsorBlockValues.value,
    skip: skipOption
  })
}

/**
 * @param {{ color: string, skip: string }} payload
 */
function updateSponsorCategory(payload) {
  switch (props.categoryName) {
    case 'sponsor':
      store.dispatch('updateSponsorBlockSponsor', payload)
      break
    case 'self-promotion':
      store.dispatch('updateSponsorBlockSelfPromo', payload)
      break
    case 'interaction':
      store.dispatch('updateSponsorBlockInteraction', payload)
      break
    case 'intro':
      store.dispatch('updateSponsorBlockIntro', payload)
      break
    case 'outro':
      store.dispatch('updateSponsorBlockOutro', payload)
      break
    case 'recap':
      store.dispatch('updateSponsorBlockRecap', payload)
      break
    case 'hook':
      store.dispatch('updateSponsorBlockHook', payload)
      break
    case 'music offtopic':
      store.dispatch('updateSponsorBlockMusicOffTopic', payload)
      break
    case 'filler':
      store.dispatch('updateSponsorBlockFiller', payload)
      break
    case 'highlight':
      store.dispatch('updateSponsorBlockHighlight', payload)
      break
  }
}
</script>

<style scoped src="./FtSponsorBlockCategory.css" />
