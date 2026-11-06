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
      :value="colorSelectValue"
      :setting-key="settingKey"
      :is-changed="isValueChanged('color')"
      :select-names="colorNames"
      :select-values="COLOR_SELECT_VALUES"
      :icon="['fas', 'palette']"
      :class="colorSelectClass"
      :icon-color="colorIconColor"
      @change="updateColor"
      @reset="resetValue('color')"
    />
    <FtColorPicker
      v-if="customColorSelected"
      class="sponsorBlockColorPicker"
      :label="t('Settings.SponsorBlock Settings.Custom Color')"
      :model-value="sponsorBlockValues.color"
      :allow-alpha="false"
      @update:model-value="updateColor"
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

import FtColorPicker from '../FtColorPicker/FtColorPicker.vue'
import FtSelect from '../FtSelect/FtSelect.vue'

import store from '../../store/index'
import { DEFAULT_SETTINGS } from '../../store/modules/settings'

import { colors, isHexColor } from '../../helpers/colors'
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

const CUSTOM_COLOR_VALUE = 'custom'
const COLOR_VALUES = colors.map(color => color.name)
const COLOR_VALUE_SET = new Set(COLOR_VALUES)
const COLOR_SELECT_VALUES = [CUSTOM_COLOR_VALUE, ...COLOR_VALUES]
const presetColorNames = useColorTranslations()
const colorNames = computed(() => [
  t('Settings.SponsorBlock Settings.Custom Color'),
  ...presetColorNames.value
])

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

const customColorSelected = computed(() => isHexColor(sponsorBlockValues.value.color))
const colorSelectValue = computed(() => {
  if (customColorSelected.value) return CUSTOM_COLOR_VALUE
  if (COLOR_VALUE_SET.has(sponsorBlockValues.value.color)) return sponsorBlockValues.value.color
  return DEFAULT_SETTINGS[settingKey.value].color
})
const colorSelectClass = computed(() => (
  customColorSelected.value ? null : `sec${colorSelectValue.value}`
))
const colorIconColor = computed(() => (
  customColorSelected.value
    ? sponsorBlockValues.value.color
    : 'rgb(var(--accent-color-rgb))'
))

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
    color: color === CUSTOM_COLOR_VALUE ? resolveDefaultCustomColor() : color,
  })
}

function resolveDefaultCustomColor() {
  const defaultColorName = DEFAULT_SETTINGS[settingKey.value].color
  const probe = document.createElement('span')
  probe.className = `main${defaultColorName}`
  probe.hidden = true
  document.body.append(probe)
  const color = getComputedStyle(probe).getPropertyValue('--primary-color').trim()
  probe.remove()

  if (isHexColor(color)) return color.toLowerCase()
  return colors.find(({ name }) => name === defaultColorName)?.value.toLowerCase() ?? '#000000'
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
