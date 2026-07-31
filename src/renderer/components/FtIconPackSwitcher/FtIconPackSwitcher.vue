<template>
  <!-- Temporary #388 icon-pack comparison control; not for permanent i18n. -->
  <!-- eslint-disable @intlify/vue-i18n/no-raw-text -->
  <div class="iconPackPreview">
    <FtSelect
      placeholder="Icon Pack"
      :value="currentIconPack"
      :select-names="packNames"
      :select-values="packValues"
      :icon="['fas', 'palette']"
      @change="setIconPack"
    />
    <div
      v-overlay-scrollbars
      class="previewGrid"
      role="list"
      aria-label="Icon pack preview"
    >
      <div
        v-for="sample in previewIcons"
        :key="`${sample[0]}:${sample[1]}`"
        class="previewItem"
        role="listitem"
        :title="`${sample[0]} ${sample[1]}`"
      >
        <FontAwesomeIcon
          class="previewIcon"
          :icon="sample"
          fixed-width
        />
        <span class="previewName">{{ sample[0] }} {{ sample[1] }}</span>
      </div>
    </div>
  </div>
  <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
</template>

<script setup>
import { computed } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'

import FtSelect from '../FtSelect/FtSelect.vue'

import faIconMap from '../../icons/faIconMap.json'
import { ICON_PACKS, currentIconPack, setIconPack } from '../../icons/iconPackState'

const CUSTOM_NAMES = new Set([
  'vertical-tabs',
  'horizontal-tabs',
  'playlist-add',
  'playlist-check'
])

const BRAND_NAMES = new Set(['github', 'youtube'])

/**
 * @param {string} name
 * @returns {'fas' | 'far' | 'fab' | 'fac'}
 */
function prefixFor(name) {
  if (CUSTOM_NAMES.has(name)) {
    return 'fac'
  }
  if (BRAND_NAMES.has(name)) {
    return 'fab'
  }
  if (name === 'dot-circle') {
    return 'far'
  }
  return 'fas'
}

/** Full mapped set so pack mismatches are easy to spot. */
const previewIcons = Object.keys(faIconMap)
  .sort((a, b) => a.localeCompare(b))
  .flatMap((name) => {
    /** @type {[string, string][]} */
    const entries = [[prefixFor(name), name]]
    // Also show the regular (outline) bookmark used in the UI.
    if (name === 'bookmark') {
      entries.push(['far', 'bookmark'])
    }
    return entries
  })

const packNames = computed(() => ICON_PACKS.map((pack) => pack.label))
const packValues = computed(() => ICON_PACKS.map((pack) => pack.id))
</script>

<style scoped src="./FtIconPackSwitcher.css" />
