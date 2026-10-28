import { Capacitor, registerPlugin } from '@capacitor/core'
import { shallowReactive, watch } from 'vue'
import { getCapacitorTabPreviewRegion } from '../helpers/capacitorTabPreviewRegion.js'
import { canCaptureCapacitorTab, createCapacitorPreviewCache } from './capacitorPreviewCache.js'
import { clearCapacitorTabAvatars } from './capacitorTabAvatars.js'
import {
  clearStoredTabImages,
  readStoredTabImages,
  removeStoredTabImage,
  removeStoredTabImages,
  writeStoredTabImage
} from './capacitorTabImageStorage.js'

const Screenshot = registerPlugin('Screenshot')
const PREVIEW_PREFIX = 'preview-'
const cache = createCapacitorPreviewCache(capturePage, shallowReactive(new Map()), 24, {
  write: (id, entry) => writeStoredTabImage(PREVIEW_PREFIX + id, entry),
  remove: id => removeStoredTabImage(PREVIEW_PREFIX + id),
})
let timer
// Bumped whenever previews are discarded, so a slow disk read cannot bring them back.
let discardRevision = 0

function discardPreviews() {
  discardRevision += 1
  cache.clear()
}

/** Clear the stored previews and channel avatars from Storage settings. */
export async function clearCapacitorTabImages() {
  discardPreviews()
  clearCapacitorTabAvatars()
  await clearStoredTabImages()
}

export function getCapacitorTabPreview(tab) {
  return cache.get(tab)
}

export function prepareForTabOrganizer() {
  // Open from the last-seen preview without a native capture on the input path.
  // Discard pending captures before the overlay or live-page animation can paint.
  clearTimeout(timer)
  cache.invalidate()
}

export function initializeCapacitorTabPreviews(store, pageSwipe, tabsReady = Promise.resolve()) {
  if (!process.env.IS_CAPACITOR || !Capacitor.isPluginAvailable('Screenshot')) return () => {}
  let disposed = false
  const canCapture = () => !pageSwipe.value && canCaptureCapacitorTab(store.getters, document.visibilityState === 'visible') && !hasVisibleOverlay()
  const captureCurrent = async () => {
    clearTimeout(timer)
    if (canCapture()) await cache.capture(store.getters.getPresentedTab)
  }
  const schedule = () => {
    cache.invalidate()
    clearTimeout(timer)
    timer = setTimeout(captureCurrent, 600)
  }
  // Invalidate before the pages move, including a swipe cancelled on the same tab.
  const stopSwipe = watch(() => !!pageSwipe.value, schedule, { flush: 'sync' })
  const stopEnabled = watch(() => store.getters.getShowTabPreviews, () => {
    if (store.getters.getShowTabPreviews) return
    discardPreviews()
    removeStoredTabImages(PREVIEW_PREFIX).catch(() => {})
  }, { immediate: true, flush: 'sync' })
  const stop = watch(() => [
    store.getters.getShowTabPreviews,
    store.getters.isAnyPromptOpen,
    store.getters.getSettingsWindowOpen,
    store.getters.getSettingsWindowMorphing,
    store.getters.getActiveTabId,
    store.getters.getPresentedTabId,
    ...store.getters.getTabs.map(tab => `${tab.id}:${tab.route.fullPath}:${tab.isLoading}:${tab.refreshKey}:${tab.loadState}`)
  ], () => {
    cache.prune(store.getters.getTabs)
    schedule()
  }, { immediate: true, flush: 'sync' })
  const restoreRevision = discardRevision
  Promise.all([readStoredTabImages(PREVIEW_PREFIX), tabsReady]).then(([stored]) => {
    if (disposed || restoreRevision !== discardRevision || !store.getters.getShowTabPreviews) return
    cache.restore(new Map([...stored].map(([name, entry]) => [name.slice(PREVIEW_PREFIX.length), entry])), store.getters.getTabs)
  }).catch(error => console.warn('Failed to restore mobile tab previews:', error))
  // Images and video can become ready after the route's initial screenshot.
  // Keep the last-seen image current without capturing when the organizer opens.
  const contentEvents = ['scroll', 'load', 'loadeddata', 'playing', 'seeked']
  for (const event of contentEvents) document.addEventListener(event, schedule, true)
  document.addEventListener('visibilitychange', schedule)
  window.addEventListener('resize', schedule)
  return () => {
    disposed = true
    stop()
    stopEnabled()
    stopSwipe()
    clearTimeout(timer)
    cache.clear()
    for (const event of contentEvents) document.removeEventListener(event, schedule, true)
    document.removeEventListener('visibilitychange', schedule)
    window.removeEventListener('resize', schedule)
  }
}

function hasVisibleOverlay() {
  return [...document.querySelectorAll('[role="dialog"], [role="menu"], .settingsWindow')]
    .some(element => element.getBoundingClientRect().width > 0 && getComputedStyle(element).visibility !== 'hidden')
}

async function capturePage() {
  const { width, top, height } = getCapacitorTabPreviewRegion()
  if (height <= 0 || width <= 0) return null
  const targetWidth = Math.min(640, Math.round(width))
  const cropHeight = Math.min(height, width * 9 / 16)
  const { dataUrl } = await Screenshot.take({
    width: targetWidth,
    height: Math.max(1, Math.round(targetWidth * cropHeight / width)),
    top: top / window.innerHeight,
    cropHeight: cropHeight / window.innerHeight,
  })
  return hasVisibleOverlay() ? null : dataUrl
}
