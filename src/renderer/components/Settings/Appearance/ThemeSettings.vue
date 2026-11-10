<template>
  <FtSettingsSection
    :title="$t('Settings.Theme Settings.Theme Settings')"
  >
    <div class="themeGalleryEntry">
      <ThemeGallery />
    </div>
    <FtFlexBox class="themeSelectRow">
      <FtSelect
        size-to-content
        :placeholder="$t('Settings.Theme Settings.Icon Pack.Icon Pack')"
        :value="iconPack"
        setting-key="iconPack"
        :select-names="iconPackNames"
        :select-values="ICON_PACKS"
        :icon="['fas', 'icons']"
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

import store from '../../../store/index'

import { showToast } from '../../../helpers/utils'
import { ICON_PACKS } from '../../../icons/iconPackState'
import { DEFAULT_APP_FONT, getAppFontFamily, normalizeAppFont, SYSTEM_APP_FONT } from '../../../helpers/appFont'

const { locale, t } = useI18n()
const IS_IOS = !!process.env.IS_IOS
const IS_CAPACITOR = !!process.env.IS_CAPACITOR
/** @type {boolean} */
const usingElectron = process.env.IS_ELECTRON

const iconPackNames = computed(() => [
  t('Settings.Theme Settings.Icon Pack.Material Symbols'),
  t('Settings.Theme Settings.Icon Pack.Remix Icon')
])

const systemFonts = ref([])
let systemFontsPromise = null

const appFont = computed(() => normalizeAppFont(store.getters.getAppFont))
const bundledFontNames = ['Figtree', 'Source Sans 3', 'IBM Plex Sans', 'Inter', 'Manrope', 'Plus Jakarta Sans', 'Google Sans']
const bundledFontValues = bundledFontNames.map(name => `${name} Variable`)
const fontValues = computed(() => [
  DEFAULT_APP_FONT,
  'Roboto',
  ...bundledFontValues,
  SYSTEM_APP_FONT,
  ...[...new Set([
    ...IS_CAPACITOR ? [] : [appFont.value],
    ...systemFonts.value
  ])]
    .filter(font => font !== DEFAULT_APP_FONT && font !== 'Roboto' && font !== SYSTEM_APP_FONT && !bundledFontValues.includes(font))
    .toSorted(new Intl.Collator([locale.value, 'en'], { sensitivity: 'base' }).compare)
])
const fontNames = computed(() => [
  'Geist',
  'Roboto',
  ...bundledFontNames,
  t('Settings.Theme Settings.Font.System Default'),
  ...fontValues.value.slice(3 + bundledFontValues.length)
])

const fontGroups = computed(() => fontValues.value.map((font, index) =>
  index < 2 + bundledFontValues.length ? 'bundled' : 'system'))

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

  await systemFontsPromise
}

const iconPack = computed(() => store.getters.getIconPack)

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

.themeGalleryEntry {
  margin-block-end: 16px;
}

.appIconActions {
  margin-block-start: 24px;
}
</style>
