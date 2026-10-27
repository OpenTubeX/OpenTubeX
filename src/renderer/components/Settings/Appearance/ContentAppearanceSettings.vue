<template>
  <FtSettingsSection
    :title="t('Settings.Categories.Content appearance')"
  >
    <div class="switchColumnGrid switchFlowGrid appearanceSwitchGrid">
      <FtToggleSwitch
        :label="t('Settings.General Settings.Show Video Menu Button')"
        :default-value="showVideoMenuButton"
        setting-key="showVideoMenuButton"
        :compact="true"
        @change="store.dispatch('updateShowVideoMenuButton', $event)"
      />
      <FtToggleSwitch
        :label="t('Settings.General Settings.Show Thumbnail Previews')"
        :default-value="showThumbnailPreviews"
        setting-key="showThumbnailPreviews"
        :compact="true"
        :tooltip="t('Tooltips.General Settings.Show Thumbnail Previews')"
        @change="updateShowThumbnailPreviews"
      />
      <FtToggleSwitch
        :label="t('Settings.General Settings.Data Saver Thumbnails')"
        :default-value="thumbnailDataSaver"
        setting-key="thumbnailDataSaver"
        compact
        :tooltip="t('Tooltips.General Settings.Data Saver Thumbnails')"
        @change="store.dispatch('updateThumbnailDataSaver', $event)"
      />
    </div>
    <div class="switchGrid generalSelectGrid">
      <FtSelect
        size-to-content
        :placeholder="t('Settings.General Settings.Video View Type.Video View Type')"
        :value="listType"
        setting-key="listType"
        :select-names="viewTypeNames"
        :select-values="VIEW_TYPE_VALUES"
        :icon="VIEW_TYPE_ICONS[listType]"
        @change="updateListType"
      />
      <FtSelect
        v-if="listType === 'grid'"
        size-to-content
        :placeholder="t('Settings.General Settings.Grid Columns.Grid Columns')"
        :value="gridColumns"
        setting-key="gridColumns"
        :select-names="gridColumnNames"
        :select-values="GRID_COLUMN_VALUES"
        :icon="['fas', 'table-columns']"
        @change="updateGridColumns"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.General Settings.Playlist View Type.Playlist View Type')"
        :value="playlistViewType"
        setting-key="playlistViewType"
        :select-names="viewTypeNames"
        :select-values="VIEW_TYPE_VALUES"
        :icon="VIEW_TYPE_ICONS[playlistViewType]"
        @change="updatePlaylistViewType"
      />
      <FtSelect
        v-if="playlistViewType === 'grid'"
        size-to-content
        :placeholder="t('Settings.General Settings.Grid Columns.Playlist Grid Columns')"
        :value="playlistGridColumns"
        setting-key="playlistGridColumns"
        :select-names="gridColumnNames"
        :select-values="GRID_COLUMN_VALUES"
        :icon="['fas', 'table-columns']"
        @change="updatePlaylistGridColumns"
      />
      <FtSelect
        size-to-content
        :placeholder="t('Settings.General Settings.Thumbnail Preference.Thumbnail Preference')"
        :value="thumbnailPreference"
        setting-key="thumbnailPreference"
        :is-changed="thumbnailPreferenceChanged"
        :select-names="thumbnailTypeNames"
        :select-values="THUMBNAIL_TYPE_VALUES"
        :tooltip="t('Tooltips.General Settings.Thumbnail Preference')"
        :icon="['fas', 'images']"
        @change="handleThumbnailPreferenceChange"
        @reset="resetThumbnailPreference"
      />
    </div>
    <FtSliderGrid>
      <FtSlider
        :label="t('Settings.Theme Settings.Thumbnail Size')"
        :tooltip="t('Tooltips.Theme Settings.Thumbnail Size')"
        :default-value="thumbnailSize"
        setting-key="thumbnailSize"
        :min-value="MIN_THUMBNAIL_SIZE"
        :max-value="maxThumbnailSize"
        :step="THUMBNAIL_SIZE_STEP"
        value-extension="%"
        @input="previewThumbnailSize"
        @change="updateThumbnailSize"
      />
      <FtSlider
        :label="t('Settings.Theme Settings.Playlist Thumbnail Size')"
        :tooltip="t('Tooltips.Theme Settings.Playlist Thumbnail Size')"
        :default-value="playlistThumbnailSize"
        setting-key="playlistThumbnailSize"
        :min-value="MIN_THUMBNAIL_SIZE"
        :max-value="maxPlaylistThumbnailSize"
        :step="THUMBNAIL_SIZE_STEP"
        value-extension="%"
        @input="previewPlaylistThumbnailSize"
        @change="updatePlaylistThumbnailSize"
      />
    </FtSliderGrid>
  </FtSettingsSection>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtSlider from '../../FtSlider/FtSlider.vue'
import FtSliderGrid from '../../FtSliderGrid/FtSliderGrid.vue'
import FtToggleSwitch from '../../FtToggleSwitch/FtToggleSwitch.vue'

import store from '../../../store/index'
import { DEFAULT_SETTINGS } from '../../../store/modules/settings'
import { useThumbnailSizeSlider } from '../../../composables/useThumbnailSizeSlider'
import { MIN_THUMBNAIL_SIZE, THUMBNAIL_SIZE_STEP } from '../../../constants/thumbnailSize'

const { t } = useI18n()

const VIEW_TYPE_VALUES = ['grid', 'fullWidth', 'list']
const VIEW_TYPE_ICONS = { grid: ['fas', 'grip'], fullWidth: ['fas', 'grip-lines'], list: ['fas', 'list'] }

const viewTypeNames = computed(() => [
  t('Settings.General Settings.Video View Type.Grid'),
  t('Settings.General Settings.Video View Type.Full Width'),
  t('Settings.General Settings.Video View Type.List')
])

/** @type {import('vue').ComputedRef<'grid' | 'fullWidth' | 'list'>} */
const listType = computed(() => store.getters.getListType)

/**
 * @param {'grid' | 'list'} value
 */
function updateListType(value) {
  store.dispatch('updateListType', value)
}

/** @type {import('vue').ComputedRef<'grid' | 'list'>} */
const playlistViewType = computed(() => store.getters.getPlaylistViewType)

/**
 * @param {'grid' | 'list'} value
 */
function updatePlaylistViewType(value) {
  store.dispatch('updatePlaylistViewType', value)
}

// 0 lets the window width and thumbnail size decide; one column is Full Width.
const GRID_COLUMN_VALUES = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const gridColumnNames = computed(() => GRID_COLUMN_VALUES.map(columns => (
  columns === 0 ? t('Settings.General Settings.Grid Columns.Auto') : String(columns)
)))

/** @type {import('vue').ComputedRef<number>} */
const gridColumns = computed(() => store.getters.getGridColumns)

/**
 * @param {number} value
 */
function updateGridColumns(value) {
  store.dispatch('updateGridColumns', value)
}

/** @type {import('vue').ComputedRef<number>} */
const playlistGridColumns = computed(() => store.getters.getPlaylistGridColumns)

/**
 * @param {number} value
 */
function updatePlaylistGridColumns(value) {
  store.dispatch('updatePlaylistGridColumns', value)
}

const { thumbnailSize, maxThumbnailSize } = useThumbnailSizeSlider()
const { thumbnailSize: playlistThumbnailSize, maxThumbnailSize: maxPlaylistThumbnailSize } = useThumbnailSizeSlider('playlistThumbnailSize')

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

function previewPlaylistThumbnailSize(value) {
  store.commit('setPlaylistThumbnailSize', value)
}

function updatePlaylistThumbnailSize(value) {
  store.dispatch('updatePlaylistThumbnailSize', value)
}

/** @type {import('vue').ComputedRef<boolean>} */
const showVideoMenuButton = computed(() => store.getters.getShowVideoMenuButton)

/** @type {import('vue').ComputedRef<boolean>} */
const showThumbnailPreviews = computed(() => store.getters.getShowThumbnailPreviews)

const thumbnailDataSaver = computed(() => store.getters.getThumbnailDataSaver)

/**
 * @param {boolean} value
 */
function updateShowThumbnailPreviews(value) {
  store.dispatch('updateShowThumbnailPreviews', value)
}

const THUMBNAIL_TYPE_VALUES = ['', 'start', 'middle', 'end', 'hidden', 'blur']

const thumbnailTypeNames = computed(() => [
  t('Settings.General Settings.Thumbnail Preference.Default'),
  t('Settings.General Settings.Thumbnail Preference.Beginning'),
  t('Settings.General Settings.Thumbnail Preference.Middle'),
  t('Settings.General Settings.Thumbnail Preference.End'),
  t('Settings.General Settings.Thumbnail Preference.Hidden'),
  t('Settings.General Settings.Thumbnail Preference.Blur')
])

/** @type {import('vue').ComputedRef<boolean>} */
const blurThumbnails = computed(() => store.getters.getBlurThumbnails)

/** @type {import('vue').ComputedRef<'' | 'start' | 'middle' | 'end' | 'hidden' | 'blur'>} */
const thumbnailPreference = computed(() => {
  if (blurThumbnails.value) return 'blur'
  // Quick settings can turn blurring off independently of the thumbnail style.
  const preference = store.getters.getThumbnailPreference
  return preference === 'blur' ? '' : preference
})

const thumbnailPreferenceChanged = computed(() => (
  blurThumbnails.value !== DEFAULT_SETTINGS.blurThumbnails ||
  store.getters.getThumbnailPreference !== DEFAULT_SETTINGS.thumbnailPreference
))

/**
 * @param {'' | 'start' | 'middle' | 'end' | 'hidden' | 'blur'} value
 */
function handleThumbnailPreferenceChange(value) {
  store.dispatch('updateBlurThumbnails', value === 'blur')
  store.dispatch('updateThumbnailPreference', value)
}

function resetThumbnailPreference() {
  store.dispatch('updateBlurThumbnails', DEFAULT_SETTINGS.blurThumbnails)
  store.dispatch('updateThumbnailPreference', DEFAULT_SETTINGS.thumbnailPreference)
}
</script>

<style scoped src="../generalSelectGrid.css" />
<style scoped>
.appearanceSwitchGrid.appearanceSwitchGrid {
  grid-template-columns: auto;
  justify-content: center;
}
</style>
