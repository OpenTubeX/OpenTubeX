import { Capacitor, registerPlugin } from '@capacitor/core'
import { shallowReactive, watch } from 'vue'
import { canCaptureCapacitorTab, createCapacitorPreviewCache } from './capacitorPreviewCache.js'

const Screenshot = registerPlugin('Screenshot')
const cache = createCapacitorPreviewCache(capturePage, shallowReactive(new Map()))
let captureCurrent = async () => {}

export function getCapacitorTabPreview(tab) {
  return cache.get(tab)
}

export async function captureBeforeTabOrganizer() {
  let timeout
  // A slow/failed native call must not prevent opening the organizer.
  await Promise.race([
    captureCurrent(),
    new Promise(resolve => { timeout = setTimeout(resolve, 250) })
  ])
  clearTimeout(timeout)
  cache.invalidate()
}

export function initializeCapacitorTabPreviews(store) {
  if (!process.env.IS_CAPACITOR || !Capacitor.isPluginAvailable('Screenshot')) return () => {}
  let timer
  const canCapture = () => canCaptureCapacitorTab(store.getters, document.visibilityState === 'visible') && !hasVisibleOverlay()
  captureCurrent = async () => {
    clearTimeout(timer)
    if (canCapture()) await cache.capture(store.getters.getPresentedTab)
  }
  const schedule = () => {
    cache.invalidate()
    clearTimeout(timer)
    timer = setTimeout(captureCurrent, 600)
  }
  const stop = watch(() => [
    store.getters.getShowTabPreviews,
    store.getters.isAnyPromptOpen,
    store.getters.getSettingsWindowOpen,
    store.getters.getSettingsWindowMorphing,
    store.getters.getActiveTabId,
    store.getters.getPresentedTabId,
    ...store.getters.getTabs.map(tab => `${tab.id}:${tab.route.fullPath}:${tab.isLoading}:${tab.refreshKey}:${tab.loadState}`)
  ], () => {
    if (!store.getters.getShowTabPreviews) cache.clear()
    cache.prune(store.getters.getTabs)
    schedule()
  }, { immediate: true, flush: 'sync' })
  // Video can become ready after the route's initial screenshot.
  // Refresh that cached image before a slow organizer capture needs it.
  const contentEvents = ['scroll', 'loadeddata', 'playing', 'seeked']
  for (const event of contentEvents) document.addEventListener(event, schedule, true)
  document.addEventListener('visibilitychange', schedule)
  window.addEventListener('resize', schedule)
  return () => {
    stop()
    clearTimeout(timer)
    cache.clear()
    captureCurrent = async () => {}
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
  const width = window.innerWidth
  const height = window.innerHeight
  let top = 0
  for (const selector of ['.topNav', '.capacitorTabletTabBar']) {
    const rect = document.querySelector(selector)?.getBoundingClientRect()
    if (rect?.width > 0) top = Math.max(top, rect.bottom)
  }
  top = Math.max(0, Math.min(top, height))
  if (height <= top || width <= 0) return null
  const targetWidth = Math.min(640, Math.round(width))
  const cropHeight = Math.min(height - top, width * 9 / 16)
  const { dataUrl } = await Screenshot.take({
    width: targetWidth,
    height: Math.max(1, Math.round(targetWidth * cropHeight / width)),
    top: top / height,
    cropHeight: cropHeight / height,
  })
  return hasVisibleOverlay() ? null : dataUrl
}
