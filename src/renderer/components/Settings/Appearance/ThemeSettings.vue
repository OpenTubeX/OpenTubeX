<template>
  <FtSettingsSection
    :title="$t('Settings.Theme Settings.Theme Settings')"
    :icon="['fas', 'palette']"
  >
    <div class="themeControls">
      <div class="themeGalleryEntry">
        <ThemeGallery />
      </div>
      <FtFlexBox class="themeSelectRow">
        <IconPackSelect
          size-to-content
          @change="updateIconPack"
        />
        <FtSelect
          size-to-content
          :placeholder="t('Settings.Theme Settings.Font.App Font')"
          :value="appFont"
          setting-key="appFont"
          :select-names="fontNames"
          :select-values="fontValues"
          :option-groups="fontGroups"
          :option-group-labels="{
            bundled: t('Settings.Theme Settings.Font.Bundled Fonts'),
            system: t('Settings.Theme Settings.Font.System Fonts')
          }"
          :icon="['fas', 'font']"
          searchable
          lazy-options
          :loading="loadingSystemFonts"
          @change="updateAppFont"
          @open="loadSystemFonts"
        >
          <template #option="{ label, value }">
            <span
              class="fontPreview"
              :style="{ fontFamily: getAppFontFamily(value) }"
            >{{ label }}</span>
          </template>
        </FtSelect>
      </FtFlexBox>
    </div>
    <FtFlexBox
      v-if="IS_CAPACITOR || usingElectron"
      class="appIconActions"
    >
      <AppIconSettings v-if="IS_CAPACITOR && !IS_IOS" />
      <TrayIconSettings v-if="usingElectron" />
    </FtFlexBox>
  </FtSettingsSection>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../../FtSettingsSection/FtSettingsSection.vue'
import FtSelect from '../../FtSelect/FtSelect.vue'
import FtFlexBox from '../../ft-flex-box/ft-flex-box.vue'
import AppIconSettings from './AppIconSettings.vue'
import TrayIconSettings from './TrayIconSettings.vue'
import ThemeGallery from './ThemeGallery.vue'
import IconPackSelect from './IconPackSelect.vue'

import store from '../../../store/index'

import { showToast } from '../../../helpers/utils'
import { DEFAULT_APP_FONT, getAppFontFamily, normalizeAppFont, SYSTEM_APP_FONT } from '../../../helpers/appFont'

const { locale, t } = useI18n()
const IS_IOS = !!process.env.IS_IOS
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
/** @type {boolean} */
const usingElectron = process.env.IS_ELECTRON

const systemFonts = ref([])
const loadingSystemFonts = ref(false)
let systemFontsPromise = null

const appFont = computed(() => normalizeAppFont(store.getters.getAppFont))
const bundledFonts = [
  { name: 'Geist', value: DEFAULT_APP_FONT },
  { name: 'Roboto', value: 'Roboto' },
  ...['Figtree', 'Source Sans 3', 'IBM Plex Sans', 'Inter', 'Manrope', 'Plus Jakarta Sans', 'Google Sans']
    .map(name => ({ name, value: `${name} Variable` })),
  { name: 'Libron', value: 'Libron' }
]
const bundledFontValues = bundledFonts.map(({ value }) => value)
const otherFonts = computed(() => [...new Set([
  ...IS_CAPACITOR ? [] : [appFont.value],
  ...systemFonts.value
])]
  .filter(font => font !== SYSTEM_APP_FONT && !bundledFontValues.includes(font))
  .toSorted(new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' }).compare))
const fontValues = computed(() => [...bundledFontValues, SYSTEM_APP_FONT, ...otherFonts.value])
const fontNames = computed(() => [
  ...bundledFonts.map(({ name }) => name),
  t('Settings.Theme Settings.Font.System Default'),
  ...otherFonts.value
])

const fontGroups = computed(() => fontValues.value.map((font, index) =>
  index < bundledFonts.length ? 'bundled' : 'system'))

function updateAppFont(value) {
  store.dispatch('updateAppFont', value)
}

async function loadSystemFonts() {
  if (IS_CAPACITOR || systemFontsPromise !== null) return

  const fontRequest = process.env.IS_ELECTRON
    ? window.ftElectron.getSystemFonts()
    : typeof window.queryLocalFonts === 'function'
      ? window.queryLocalFonts().then(fonts => fonts.map(({ family }) => family))
      : Promise.resolve([])

  loadingSystemFonts.value = true
  systemFontsPromise = fontRequest
    .then(fonts => {
      const families = fonts
        .map(font => font.trim())
        .filter(Boolean)
      systemFonts.value = [...new Set(families)]
    })
    .catch(error => {
      console.error('Failed to load system fonts', error)
      showToast({ message: t('Settings.Theme Settings.Font.Unable to Load'), icon: ['fas', 'circle-exclamation'] })
    })
    .finally(() => {
      loadingSystemFonts.value = false
    })

  await systemFontsPromise
}

/**
 * @param {import('../../../icons/iconPackState').IconPackId} value
 */
function updateIconPack(value) {
  store.dispatch('updateIconPack', value)
}
</script>

<style scoped src="./themeSelectRow.css" />
<style scoped>
/* Loading every installed font to lay out the list stalls the first open, so
   offscreen previews wait until they scroll into view and the menu measures
   the labels in the app font. Unwrapped rows keep the estimated height. */
.optionName > .fontPreview {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  content-visibility: auto;
  contain-intrinsic-size: auto none auto 24px;
}

.measuringOptions .optionName > .fontPreview {
  content-visibility: visible;
  font-family: inherit !important;
}

/* The theme picker is as wide as the selects below it, which set the
   width of the column, and its button spans from the start of the first
   field to the end of the last, with its icons after it like theirs. The
   row keeps as much room before its fields as its icons take after them,
   counting the changed-setting marker gutter, so the fields are centered. */
.themeControls {
  display: grid;
  grid-template-columns: minmax(0, max-content);
  justify-content: center;
  row-gap: calc(16px + 16px * var(--ui-density));

  --theme-select-indicator-space: calc(8px + 22px + 22px);
}

.themeGalleryEntry {
  margin-inline: var(--theme-select-indicator-space);
}

.themeControls > .themeSelectRow {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, max-content));
  margin-inline-start: calc(var(--theme-select-indicator-space) - var(--settings-marker-gutter, 0px));
}

/* Stacked, the selects and the picker share a wider column. */
@container settings-content (width <= 600px) {
  .themeControls > .themeSelectRow {
    grid-template-columns: minmax(0, 20rem);
  }

  .themeControls > .themeSelectRow :deep(.select) {
    box-sizing: border-box;
    inline-size: auto;
  }
}

/* :has() outweighs the select's own room, which depends on its icons. */
.themeControls > .themeSelectRow :deep(.select:has(.selectIndicators)) {
  --select-indicator-space: var(--theme-select-indicator-space);
}

.appIconActions {
  margin-block-start: 24px;
}
</style>
