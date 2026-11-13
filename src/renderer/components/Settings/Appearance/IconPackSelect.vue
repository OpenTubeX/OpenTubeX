<template>
  <FtSelect
    :placeholder="t('Settings.Theme Settings.Icon Pack.Icon Pack')"
    :value="store.getters.getIconPack"
    setting-key="iconPack"
    :select-names="iconPackNames"
    :select-values="ICON_PACKS"
    :icon="['fas', 'icons']"
    @open="loadPreviews"
  >
    <template #option="{ label, value }">
      <span class="iconPackOption">
        <span class="iconPackName">{{ label }}</span>
        <!-- Iconify draws only glyphs registered before it renders. -->
        <span
          :key="`${value}:${loadedPacks.has(value)}`"
          class="iconPackPreview"
        >
          <template v-if="value === currentIconPack || loadedPacks.has(value)">
            <FtIcon
              v-for="sample in SAMPLE_ICONS"
              :key="sample"
              :icon="['fas', sample]"
              :pack="value"
            />
          </template>
        </span>
      </span>
    </template>
  </FtSelect>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FtIcon } from '@opentubex/icons'

import FtSelect from '../../FtSelect/FtSelect.vue'

import store from '../../../store/index'
import { currentIconPack, ICON_PACKS } from '../../../icons/iconPackState'
import { registerMappedIcons } from '../../../icons/registerMappedIcons'

const { t } = useI18n()

// Sample glyphs show how the packs differ beside their names.
const SAMPLE_ICONS = ['house', 'magnifying-glass', 'play', 'bell', 'gear']

const iconPackNames = computed(() => [
  t('Settings.Theme Settings.Icon Pack.Material Symbols'),
  t('Settings.Theme Settings.Icon Pack.Remix Icon')
])

/** @type {import('vue').Ref<Set<string>>} */
const loadedPacks = ref(new Set())

// Only the selected pack loads at startup, so load the others once the list opens.
function loadPreviews() {
  for (const pack of ICON_PACKS) {
    if (loadedPacks.value.has(pack)) continue
    registerMappedIcons(pack).then(() => {
      loadedPacks.value = new Set(loadedPacks.value).add(pack)
    }, error => console.error(`[icon-pack] failed to load the ${pack} preview`, error))
  }
}
</script>

<style scoped>
.iconPackOption {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  column-gap: 12px;
}

.iconPackName {
  white-space: nowrap;
}

/* Keeps its size while a pack loads so the list does not resize. */
.iconPackPreview {
  display: inline-flex;
  gap: 2px;
  min-inline-size: calc(5 * 1.25em + 4 * 2px);
  min-block-size: 1em;
  opacity: 0.8;
}

/* The samples only help while choosing, so the selected value omits them. */
.selectedValue .iconPackPreview {
  display: none;
}

/* Phone sheets are too narrow to fit every name beside its samples. */
.phonePicker .iconPackOption {
  flex-direction: column;
  align-items: flex-start;
  row-gap: 4px;
}
</style>
