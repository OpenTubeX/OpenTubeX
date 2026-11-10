<template>
  <div
    class="themeModes"
    role="radiogroup"
    :aria-label="t('Settings.Theme Settings.Base Theme.Base Theme')"
  >
    <label
      v-for="tile in modeTiles"
      :key="tile.mode"
      class="themeOption"
    >
      <input
        type="radio"
        :name="name"
        :checked="mode === tile.mode"
        @change="selectMode(tile.mode)"
      >
      <span class="optionPreview">
        <ThemePreview v-bind="tile.preview" />
      </span>
      <span
        class="optionName"
        :data-name="tile.name"
      ><span>{{ tile.name }}</span></span>
    </label>
  </div>
</template>

<script setup>
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'

import ThemePreview from './ThemePreview.vue'

import { useThemeMode } from '../../../composables/baseThemes'

const { t } = useI18n()
const name = useId()
const { mode, modeTiles, selectMode } = useThemeMode()
</script>

<style scoped src="./themeOption.css" />
<style scoped>
.themeModes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

/* Names keep the size of their bold selected form, so choosing a mode never
   moves the tiles when a name wraps. */
.optionName {
  display: grid;
}

.optionName > span,
.optionName::after {
  grid-area: 1 / 1;
}

.optionName::after {
  content: attr(data-name);
  font-weight: 600;
  visibility: hidden;
}
</style>
