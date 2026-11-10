<template>
  <span
    class="themePreview"
    aria-hidden="true"
  >
    <span
      v-for="(surface, index) in appearances"
      :key="index"
      class="themeScope themePreviewSurface"
      :class="[surface.classes, { followSystemDark: index === 1 }]"
      :data-custom-theme="surface.customTheme"
      :style="surface.style"
    >
      <span class="previewTopBar">
        <span class="previewLogo" />
        <span class="previewSearch" />
        <span class="previewAvatar" />
      </span>
      <span class="previewRail">
        <span class="previewNavItem active" />
        <span class="previewNavItem" />
        <span class="previewNavItem" />
      </span>
      <span class="previewContent">
        <span class="previewChips">
          <span class="previewChip primary" />
          <span class="previewChip accent" />
          <span class="previewChip" />
        </span>
        <span class="previewGrid">
          <span
            v-for="video in 3"
            :key="video"
            class="previewVideo"
          >
            <span class="previewThumbnail">
              <span
                v-if="video === 1"
                class="previewProgress"
              />
            </span>
            <span class="previewTitle" />
            <span class="previewMeta" />
          </span>
        </span>
      </span>
    </span>
  </span>
</template>

<script setup>
import { computed } from 'vue'

import store from '../../../store/index'
import { customThemeIdFromValue } from '../../../../customTheme'
import { getThemeAppearance } from '../../../helpers/customTheme'

const props = defineProps({
  theme: {
    type: String,
    required: true
  },
  /** Splits the preview diagonally, drawing `theme` in light mode and this theme in dark mode. */
  darkTheme: {
    type: String,
    default: ''
  },
  /** The system mode for themes that follow it, such as Dynamic colors. */
  dark: {
    type: Boolean,
    default: false
  }
})

function appearance(theme, dark) {
  const customTheme = store.getters.getCustomThemes.find(({ id }) => id === customThemeIdFromValue(theme)) ?? null
  return getThemeAppearance(
    theme,
    store.getters.getMainColor,
    store.getters.getSecColor,
    customTheme,
    store.getters.getMaterialSeedColor,
    store.getters.getSignalAccentColor,
    dark
  )
}

const appearances = computed(() => props.darkTheme
  ? [appearance(props.theme, false), appearance(props.darkTheme, true)]
  : [appearance(props.theme, props.dark)])
</script>

<style scoped>
/* A miniature app window drawn from the theme's own colors. Sizes follow the
   preview's width, so the same drawing works for thumbnails and gallery cards. */
.themePreview {
  container-type: inline-size;
  display: grid;
  position: relative;
  overflow: hidden;
  aspect-ratio: 16 / 10;
  border-radius: inherit;
}

.themePreviewSurface {
  grid-area: 1 / 1;
  display: grid;
  grid-template: 'top top' 14cqi 'rail content' 1fr / 13cqi 1fr;
  overflow: hidden;
  font-size: 4cqi;
  color: var(--primary-text-color);
  background-color: var(--bg-color);
  background-image: var(--bg-image);
}

/* Split previews show the dark theme's half diagonally over the light one. */
.followSystemDark {
  clip-path: polygon(62% 0, 100% 0, 100% 100%, 38% 100%);
}

.previewTopBar {
  grid-area: top;
  display: flex;
  align-items: center;
  gap: 4cqi;
  padding-inline: 4cqi;
  background-color: var(--card-bg-color);
}

.previewLogo,
.previewAvatar {
  flex-shrink: 0;
  inline-size: 5cqi;
  block-size: 5cqi;
  border-radius: 50%;
  background-color: var(--primary-text-color);
}

.previewAvatar {
  background-color: var(--accent-color);
}

.previewSearch {
  flex: 1;
  block-size: 6cqi;
  margin-inline: 8cqi;
  border-radius: 3cqi;
  background-color: var(--search-bar-color);
}

.previewRail {
  grid-area: rail;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4cqi;
  padding-block: 4cqi;
  background-color: var(--side-nav-color);
}

.previewNavItem {
  inline-size: 5cqi;
  block-size: 5cqi;
  border-radius: 1.5cqi;
  background-color: var(--tertiary-text-color);
  opacity: 0.6;
}

.previewNavItem.active {
  inline-size: 9cqi;
  border-radius: 2.5cqi;
  background-color: var(--side-nav-active-color);
  opacity: 1;
}

.previewContent {
  grid-area: content;
  display: flex;
  flex-direction: column;
  gap: 4cqi;
  min-inline-size: 0;
  padding: 4cqi;
}

.previewChips {
  display: flex;
  gap: 2cqi;
}

.previewChip {
  inline-size: 12cqi;
  block-size: 5cqi;
  border-radius: 2.5cqi;
  background-color: var(--secondary-card-bg-color);
}

.previewChip.primary {
  background-color: var(--primary-color);
}

.previewChip.accent {
  background-color: var(--accent-color);
}

.previewGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 3cqi;
}

.previewVideo {
  display: flex;
  flex-direction: column;
  gap: 1.5cqi;
  min-inline-size: 0;
}

.previewThumbnail {
  position: relative;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border-radius: 2cqi;
  background-color: var(--card-bg-color);
}

.previewProgress {
  position: absolute;
  inset-block-end: 0;
  inset-inline-start: 0;
  inline-size: 60%;
  block-size: 1.2cqi;
  background-color: var(--primary-color);
}

.previewTitle,
.previewMeta {
  block-size: 2.2cqi;
  border-radius: 1.1cqi;
  background-color: var(--primary-text-color);
}

.previewMeta {
  inline-size: 60%;
  background-color: var(--secondary-text-color);
}
</style>
