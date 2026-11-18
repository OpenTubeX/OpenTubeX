import { computed, onBeforeUnmount, ref, shallowReactive } from 'vue'

import store from '../store/index'
import {
  MAX_THUMBNAIL_SIZE,
  PHONE_THUMBNAIL_MAX_SIZE,
  PHONE_THUMBNAIL_VIEWPORT_WIDTH
} from '../constants/thumbnailSize'

export const thumbnailSizeSettingKey = Symbol('thumbnailSizeSetting')

/** The view type setting that pairs with each thumbnail size setting. */
export const VIEW_TYPE_SETTINGS = {
  thumbnailSize: 'listType',
  playlistThumbnailSize: 'playlistViewType'
}

/** The grid column setting that pairs with each thumbnail size setting. */
export const GRID_COLUMNS_SETTINGS = {
  thumbnailSize: 'gridColumns',
  playlistThumbnailSize: 'playlistGridColumns'
}

const visibleGrids = shallowReactive(new Map())

// Some views, including YouTube-style Shorts, force a grid even when the
// global preference is list. Track rendered grids using their resize observer.
export function setThumbnailGridVisible(element, visible, settingKey = 'thumbnailSize') {
  if (visible) visibleGrids.set(element, settingKey)
  else visibleGrids.delete(element)
}

export function useThumbnailSizeSlider(settingKey = 'thumbnailSize') {
  const query = window.matchMedia(`(width <= ${PHONE_THUMBNAIL_VIEWPORT_WIDTH}px)`)
  const phoneWidth = ref(query.matches)
  const updatePhoneWidth = () => { phoneWidth.value = query.matches }
  query.addEventListener('change', updatePhoneWidth)
  onBeforeUnmount(() => query.removeEventListener('change', updatePhoneWidth))

  const maxThumbnailSize = computed(() => {
    const prefersGrid = store.state.settings[VIEW_TYPE_SETTINGS[settingKey]] !== 'list'
    const hasVisibleGrid = [...visibleGrids.values()].includes(settingKey)
    return phoneWidth.value && (prefersGrid || hasVisibleGrid)
      ? PHONE_THUMBNAIL_MAX_SIZE
      : MAX_THUMBNAIL_SIZE
  })
  // Larger cards cannot fit two per row on a phone; the full width view type
  // covers that layout. Display a size chosen in a wider window at the phone
  // endpoint without overwriting the saved desktop preference.
  const thumbnailSize = computed(() => Math.min(store.state.settings[settingKey], maxThumbnailSize.value))

  return { thumbnailSize, maxThumbnailSize }
}
