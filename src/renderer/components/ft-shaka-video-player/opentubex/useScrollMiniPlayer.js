import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import store from '../../../store/index'
import { applyAnimationSpeed, getAnimationSpeedMultiplier } from '../../../helpers/animationSpeed'
import {
  hasCrossTabMiniPlayerOwner,
  isCrossTabMiniPlayerOwner,
  markCrossTabMiniPlayerActive,
  markCrossTabMiniPlayerInactive,
  refreshCrossTabMiniPlayer,
  releaseCrossTabMiniPlayerOwnership,
  unregisterCrossTabMiniPlayer,
} from '../../../helpers/crossTabMiniPlayer'
import { isReducedMotionEnabled } from '../../../helpers/reducedMotion'
import { lightHaptic } from '../../../helpers/mobileHaptics.js'
import { getCapacitorTabService } from '../../../tabs/CapacitorTabService'
import { watchNavigationKey } from '../../../tabs/TabContext'
import { getPreviousBrowsingRoute } from '../../../tabs/playerDockDestination'
import { registerAndroidBackPlayer } from '../../../helpers/androidBackGesture'
import {
  animateScrollMiniPlayerBounce,
  clampScrollMiniPlayerRect,
  DEFAULT_ASPECT_RATIO,
  getAnchorVisibleRatio,
  getDefaultScrollMiniPlayerRect,
  getResizeHandleCorner,
  getSavedScrollMiniPlayerRect,
  getViewportInsets,
  getViewportWidth,
  MARGIN,
  getScrollMiniInlineLayoutHeight,
  getScrollMiniPlayerStashSide,
  getStashedScrollMiniPlayerRect,
  getScrollMiniVerticalAnchor,
  parseScrollMiniPlayerSavedRect,
  pickScrollMiniVerticalAnchor,
  reanchorScrollMiniPlayerRect,
  resizeScrollMiniPlayerFromCorner,
  resolveScrollMiniDragHandleOnLightBg,
  sampleScrollMiniDragHandleLuminance,
  sampleScrollMiniHandleLuminance,
  scrollMiniPlayerRectToStyle,
  serializeScrollMiniPlayerSavedRect,
  setSavedScrollMiniPlayerRect,
  shouldBounceScrollMiniPlayerToEdge,
  snapScrollMiniPlayerToEdge,
  updateScrollMiniPlayerVolumeBarFill,
  ENTER_MINI_RATIO,
  EXIT_MINI_RATIO,
  SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT,
} from '../../../helpers/scrollMiniPlayer'

const SCROLL_MINI_PLAY_PAUSE_HIDE_MS = 3000
const SCROLL_MINI_VOLUME_HIDE_MS = 1000
const SCROLL_MINI_DRAG_HANDLE_CONTRAST_MS = 400
const SCROLL_MINI_POINTER_REVEAL_SUPPRESS_MS = 250
const SCROLL_MINI_POINTER_REVEAL_MIN_DISTANCE = 8
const SCROLL_MINI_LAYOUT_ANIMATION_DURATION_MS = 300

/**
 * OpenTubeX's scroll mini-player integration. Keeping this composable outside the
 * upstream-derived player limits FreeTube merge conflicts to the call site.
 *
 * @param {{
 *   container: import('vue').Ref<HTMLDivElement | null>,
 *   mobileMiniBarOverlay: import('vue').Ref<HTMLDivElement | null>,
 *   fullWindowEnabled: import('vue').Ref<boolean>,
 *   inlineSixteenByNine: import('vue').ComputedRef<boolean>,
 *   getUi: () => import('shaka-player').ui.Overlay | null,
 *   isActiveTab: import('vue').ComputedRef<boolean>,
 *   isPlayerSuspended?: import('vue').Ref<boolean> | null,
 *   pictureInPictureActive: import('vue').Ref<boolean>,
 *   props: { format: string, videoId: string },
 *   tabId?: string | null,
 *   video: import('vue').Ref<HTMLVideoElement | null>
 * }} options
 */
export function useScrollMiniPlayer({ container, mobileMiniBarOverlay, fullWindowEnabled, inlineSixteenByNine, getUi, isActiveTab, isPlayerSuspended = null, pictureInPictureActive, props, tabId = null, video }) {
  const watchNavigation = inject(watchNavigationKey, null)
  const playerSuspended = computed(() => isPlayerSuspended?.value === true)
  const scrollMiniVideoAspectRatio = ref(DEFAULT_ASPECT_RATIO)
  const scrollMiniPlayerEnabled = computed(() => store.getters.getScrollMiniPlayerEnabled)
  const scrollMiniPlayerOnAllTabs = computed(() => watchNavigation?.minimized?.value || store.getters.getKeepPlayingOnNavigation || store.getters.getScrollMiniPlayerOnAllTabs)
  const autoPictureInPictureOnTabChange = computed(
    () => !store.getters.getKeepPlayingOnNavigation &&
      !(watchNavigation?.detached.value && watchNavigation.tabPresented.value) &&
      store.getters.getAutoPictureInPictureTriggers.includes('tab')
  )
  const scrollMiniPlayerActive = ref(false)
  const scrollMiniPlayerAnimating = ref(false)
  const scrollMiniPlaceholderHeight = ref(0)
  /** @type {import('vue').Ref<import('../../../helpers/scrollMiniPlayer').ScrollMiniPlayerRect>} */
  const scrollMiniPlayerRect = ref(getDefaultScrollMiniPlayerRect())
  const scrollMiniIsPaused = ref(true)
  const mobileMiniBarProgress = ref(0)
  const mobileMiniBarHasSeekRange = ref(false)
  const scrollMiniVolume = ref(1)
  const scrollMiniPlayPauseVisible = ref(true)
  const scrollMiniVolumeExpanded = ref(false)
  const scrollMiniDragHandleOnLightBg = ref(false)
  const scrollMiniResizeHandleOnLightBg = ref(false)
  const scrollMiniResizeCorner = ref('bottom-right')
  const scrollMiniAnchor = ref(null)
  const scrollMiniPlaceholder = ref(null)
  const scrollMiniVolumeTrack = ref(null)
  const scrollMiniPlayerDismissed = ref(false)
  const scrollMiniPlayerStashedSide = ref(null)
  const scrollMiniPlayerStashed = computed(() => scrollMiniPlayerStashedSide.value !== null)

  const crossTabMiniPlayerCandidate = {
    canShow: () => canShowCrossTabMiniPlayer(),
    hide: () => deactivateScrollMiniPlayer(),
    show: () => { if (!inlineDrag) activateScrollMiniPlayer(false) },
  }

  const scrollMiniPlayerStyle = computed(() => scrollMiniPlayerRectToStyle(scrollMiniPlayerRect.value))

  function usesMobileMiniBar() {
    return Boolean(process.env.IS_CAPACITOR || document.querySelector('.app.capacitorTabs'))
  }

  function getMobileMiniBarRect(revealSideNav = false) {
    const insets = getViewportInsets({ includeSideNav: true, revealSideNav })
    const height = 108
    const left = Math.max(0, insets.left - MARGIN)
    const right = Math.max(0, insets.right - MARGIN)
    return {
      left,
      top: window.innerHeight - height - Math.max(0, insets.bottom - MARGIN),
      width: Math.max(0, getViewportWidth() - left - right),
      height,
      dock: 'left',
    }
  }

  function measureMobileMiniBar() {
    const layer = document.getElementById('cross-tab-mini-player-layer')
    if (!layer) return null
    // The Watch view lives inside a size container, which changes the containing
    // block for fixed children. Measure in the same layer as the settled bar.
    const element = container.value.cloneNode(false)
    const videoElement = video.value.cloneNode(false)
    const { left, top, width, height } = getMobileMiniBarRect(true)
    element.classList.add('scrollMiniPlayer', 'mobileMiniBar')
    element.removeAttribute('id')
    element.removeAttribute('style')
    videoElement.removeAttribute('id')
    videoElement.removeAttribute('src')
    videoElement.removeAttribute('poster')
    element.append(videoElement)
    element.style.setProperty('transition', 'none', 'important')
    // Keep the CSS translation for hidden navigation: it is also the settled
    // bar's position after the browsing page has been restored.
    Object.assign(element.style, {
      position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, margin: '0px'
    })
    layer.append(element)
    const bounds = element.getBoundingClientRect()
    const videoBounds = videoElement.getBoundingClientRect()
    element.remove()
    return {
      rect: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height
      },
      video: {
        left: videoBounds.left - bounds.left,
        top: videoBounds.top - bounds.top,
        width: videoBounds.width,
        height: videoBounds.height
      }
    }
  }

  function measureInlinePlayer() {
    const placeholder = scrollMiniPlaceholder.value
    if (!placeholder || !video.value) return null
    // Measure the inline layout in its original slot while the real video stays
    // in the viewport layer. A detached clone avoids resizing its decode surface.
    const element = container.value.cloneNode(false)
    const videoElement = video.value.cloneNode(false)
    element.classList.remove('scrollMiniPlayer', 'mobileMiniBar', 'scrollMiniPlayerAnimating')
    element.classList.toggle('sixteenByNine', inlineSixteenByNine.value)
    element.style.removeProperty('transform')
    element.removeAttribute('data-mobile-mini-morph')
    Object.assign(element.style, { position: 'absolute', inset: '0 auto auto 0', width: '100%', height: 'auto' })
    element.removeAttribute('id')
    videoElement.removeAttribute('id')
    videoElement.removeAttribute('src')
    videoElement.removeAttribute('poster')
    videoElement.width = video.value.videoWidth
    videoElement.height = video.value.videoHeight
    if (!inlineSixteenByNine.value && videoElement.width > 0 && videoElement.height > 0) {
      videoElement.style.aspectRatio = `${videoElement.width} / ${videoElement.height}`
    }
    videoElement.style.height = inlineSixteenByNine.value ? '100%' : 'auto'
    videoElement.style.setProperty('transition', 'none', 'important')
    element.append(videoElement)
    placeholder.append(element)
    const rect = element.getBoundingClientRect()
    const videoRect = videoElement.getBoundingClientRect()
    element.remove()
    const slot = placeholder.getBoundingClientRect()
    return {
      slotWidth: slot.width,
      rect: { left: slot.left, top: slot.top, width: rect.width, height: rect.height },
      videoRect: {
        left: slot.left + videoRect.left - rect.left,
        top: slot.top + videoRect.top - rect.top,
        width: videoRect.width,
        height: videoRect.height
      }
    }
  }

  const scrollMiniPlayerDetached = computed(() => {
    return scrollMiniPlayerActive.value &&
      !isActiveTab.value &&
      isCrossTabMiniPlayerOwner(crossTabMiniPlayerCandidate)
  })
  const scrollMiniVolumePercent = computed(() => Math.round(scrollMiniVolume.value * 100))
  const scrollMiniVolumeIcon = computed(() => {
    if (scrollMiniVolume.value === 0) {
      return ['fas', 'volume-mute']
    }
    if (scrollMiniVolume.value < 0.5) {
      return ['fas', 'volume-low']
    }
    return ['fas', 'volume-high']
  })

  /** @type {IntersectionObserver | null} */
  let scrollMiniIntersectionObserver = null
  let mobileMiniBarLayoutObserver = null
  /** @type {number | null} */
  let scrollMiniPlayPauseHideTimeout = null
  /** @type {number | null} */
  let scrollMiniVolumeHideTimeout = null
  /** @type {(() => void) | null} */
  let scrollMiniBounceCancel = null
  /** @type {Animation | null} */
  let scrollMiniLayoutAnimation = null
  let scrollMiniLayoutAnimationSequence = 0
  let scrollMiniPlayPauseHiddenByTimer = false
  let scrollMiniDragHandleContrastLastUpdate = 0
  let scrollMiniPointerRevealSuppressedUntil = 0
  /** @type {number | null} */
  let scrollMiniPointerRevealSampleX = null
  /** @type {number | null} */
  let scrollMiniPointerRevealSampleY = null

  /** @type {{ type: 'drag' | 'resize' | 'volume', corner?: string, startX: number, startY: number, startRect: import('../../../helpers/scrollMiniPlayer').ScrollMiniPlayerRect } | null} */
  let scrollMiniPointerSession = null
  let scrollMiniPlayerRestoreRect = null
  let lastKnownInlinePlayerHeight = 0
  /** @type {number | null} */
  let scrollMiniScrollFrame = null

  // Cache geometry once. Pointer moves only write a compositor transform, at
  // most once per frame.
  const scrollMiniPlayerDragStyle = ref(null)
  const mobileMiniBarOverlayStyle = ref(null)
  let mobileMiniMorphBase = null
  const mobileMiniBar = computed(() => Boolean(process.env.IS_CAPACITOR ||
    ((scrollMiniPlayerActive.value || scrollMiniPlayerAnimating.value || scrollMiniPlayerDragStyle.value) && usesMobileMiniBar())))
  const mobileMiniBarCanDismiss = computed(() => Boolean(scrollMiniPlayerDragStyle.value) ||
    (scrollMiniPlayerActive.value && (scrollMiniPlayerDetached.value || Boolean(watchNavigation?.detached.value))))
  let inlineDrag = null
  let inlineDragFrame = null
  let scrollRestoreDrag = false

  function positionMobileMiniBarOverlay(bar) {
    mobileMiniBarOverlayStyle.value = {
      left: `${bar.left}px`,
      top: `${bar.top}px`,
      width: `${bar.width}px`,
      height: `${bar.height}px`
    }
  }

  function beginScrollMiniPlayerDrag(restoring = false) {
    const element = container.value
    if (inlineDrag || scrollRestoreDrag || !element || !watchNavigation?.beginMinimizePreview ||
      scrollMiniPlayerActive.value !== restoring || !canUseScrollMiniPlayerBase(true)) return false
    if (restoring && !watchNavigation.detached.value) {
      // The current Watch page restores by scrolling, without a navigation preview.
      scrollRestoreDrag = true
      return true
    }
    cancelScrollMiniPlayerLayoutAnimation()
    updateScrollMiniVideoAspectRatio()
    const from = element.getBoundingClientRect()
    const saved = getSavedScrollMiniPlayerRect('tab')
    const videoRect = video.value.getBoundingClientRect()
    const mobileBar = usesMobileMiniBar() && !restoring ? measureMobileMiniBar() : null
    if (usesMobileMiniBar() && !restoring && !mobileBar) return false
    const to = usesMobileMiniBar()
      ? (mobileBar?.rect ?? getMobileMiniBarRect())
      : clampScrollMiniPlayerRect(saved
          ? reanchorScrollMiniPlayerRect(saved, scrollMiniVideoAspectRatio.value)
          : getDefaultScrollMiniPlayerRect(scrollMiniVideoAspectRatio.value), scrollMiniVideoAspectRatio.value)
    inlineDrag = {
      from,
      to,
      y: 0,
      progress: 0,
      restoring,
      videoTo: mobileBar?.video,
      videoFrom: {
        left: videoRect.left - from.left,
        top: videoRect.top - from.top,
        width: videoRect.width,
        height: videoRect.height
      }
    }
    if (usesMobileMiniBar()) {
      positionMobileMiniBarOverlay(restoring ? from : to)
    }
    if (!restoring) scrollMiniPlaceholderHeight.value = from.height
    scrollMiniPlayerDragStyle.value = {
      position: 'fixed',
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
      margin: '0',
      zIndex: '150'
    }
    if (restoring) {
      if (!watchNavigation.beginRestorePreview()) {
        inlineDrag = null
        scrollMiniPlayerDragStyle.value = null
        mobileMiniBarOverlayStyle.value = null
        return false
      }
      const drag = inlineDrag
      // The retained Watch page becomes measurable after its overlay is shown.
      drag.ready = nextTick(() => {
        if (inlineDrag !== drag) return
        const bounds = scrollMiniPlaceholder.value.getBoundingClientRect()
        const layout = usesMobileMiniBar() ? measureInlinePlayer() : null
        drag.to = layout?.rect ?? { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
        if (layout) {
          drag.videoTo = {
            left: layout.videoRect.left - drag.to.left,
            top: layout.videoRect.top - drag.to.top,
            width: layout.videoRect.width,
            height: layout.videoRect.height
          }
        }
        renderScrollMiniPlayerDrag()
      })
    } else {
      watchNavigation.beginMinimizePreview()
    }
    element.style.transformOrigin = 'top left'
    element.style.willChange = 'transform'
    element.setAttribute('data-inline-mini-drag', '')
    if (usesMobileMiniBar() && !restoring) renderInlineDragProgress(0)
    return true
  }

  function renderMobileMiniMorph(from, to, videoFrom, videoTo, progress, restoring) {
    const element = container.value
    if (!element) return
    // Use the inline surface in both directions, so expanding a cropped 16:9
    // thumbnail does not carry its shape all the way to the restored player.
    const interpolate = (start, end) => start + (end - start) * progress
    const style = element.style
    if (!element.hasAttribute('data-mobile-mini-morph')) {
      const baseRect = restoring ? to : from
      mobileMiniMorphBase = {
        rect: { left: baseRect.left, top: baseRect.top, width: baseRect.width, height: baseRect.height },
        video: { ...(restoring ? videoTo : videoFrom) }
      }
      const { rect: base, video: baseVideo } = mobileMiniMorphBase
      // Fix both layout boxes before the first frame. Android WebView otherwise
      // resizes the video surface and lays out the player on every frame.
      style.setProperty('--mobile-mini-left', `${base.left}px`)
      style.setProperty('--mobile-mini-top', `${base.top}px`)
      style.setProperty('--mobile-mini-width', `${base.width}px`)
      style.setProperty('--mobile-mini-height', `${base.height}px`)
      style.setProperty('--mobile-mini-video-base-left', `${baseVideo.left}px`)
      style.setProperty('--mobile-mini-video-base-top', `${baseVideo.top}px`)
      style.setProperty('--mobile-mini-video-base-width', `${baseVideo.width}px`)
      style.setProperty('--mobile-mini-video-base-height', `${baseVideo.height}px`)
      element.setAttribute('data-mobile-mini-morph', '')
      const artwork = element.querySelector('.musicAudioArtwork:not(.retryImagePlaceholder)')
      if (artwork && !artwork.hidden) {
        const bounds = artwork.getBoundingClientRect()
        const surface = artwork.closest('.musicAudioSurface').getBoundingClientRect()
        mobileMiniMorphBase.artwork = {
          element: artwork,
          left: bounds.left - surface.left,
          top: bounds.top - surface.top,
          width: bounds.width,
          height: bounds.height,
          aspectRatio: artwork.naturalWidth / artwork.naturalHeight || 1,
          radius: Number.parseFloat(getComputedStyle(artwork).borderTopLeftRadius) || 0
        }
      }
    }
    const { rect: base, video: baseVideo } = mobileMiniMorphBase
    const videoWidth = interpolate(videoFrom.width, videoTo.width)
    const videoHeight = interpolate(videoFrom.height, videoTo.height)
    const videoScale = Math.max(videoWidth / baseVideo.width, videoHeight / baseVideo.height)
    const videoLeft = interpolate(from.left + videoFrom.left, to.left + videoTo.left) +
      (videoWidth - baseVideo.width * videoScale) / 2
    const videoTop = interpolate(from.top + videoFrom.top, to.top + videoTo.top) +
      (videoHeight - baseVideo.height * videoScale) / 2
    const x = videoLeft - base.left - baseVideo.left * videoScale
    const y = videoTop - base.top - baseVideo.top * videoScale
    style.setProperty('transform', `translate(${x}px, ${y}px) scale(${videoScale})`, 'important')
    const minimized = restoring ? 1 - progress : progress
    const mediaAspect = video.value.videoWidth / video.value.videoHeight || baseVideo.width / baseVideo.height
    // Keep animated properties local to their surfaces. Inherited custom
    // properties invalidate styles throughout Shaka's hidden control tree.
    // The same poster surface covers loading, countdown and ended playback.
    for (const surface of element.querySelectorAll(':scope > .player, :scope > .countdownPoster, :scope > .musicAudioSurface')) {
      const poster = surface.classList.contains('countdownPoster') ? surface.querySelector('img:not(.retryImagePlaceholder)') : null
      const aspect = poster?.naturalWidth / poster?.naturalHeight || mediaAspect
      const pictureWidth = Math.min(baseVideo.width, baseVideo.height * aspect)
      const pictureHeight = pictureWidth / aspect
      const coverScale = Math.max(videoWidth / pictureWidth, videoHeight / pictureHeight) / videoScale
      const scale = surface.classList.contains('musicAudioSurface') ? 1 : 1 + (coverScale - 1) * minimized
      const cropX = Math.max(0, (baseVideo.width - videoWidth / (videoScale * scale)) / 2)
      const cropY = Math.max(0, (baseVideo.height - videoHeight / (videoScale * scale)) / 2)
      surface.style.setProperty('--mobile-mini-media-scale', String(scale))
      surface.style.clipPath = cropX < 0.001 && cropY < 0.001 ? 'none' : `inset(${cropY}px ${cropX}px)`
    }
    const artwork = mobileMiniMorphBase.artwork
    if (artwork) {
      const width = Math.min(artwork.width, artwork.height * artwork.aspectRatio)
      const height = width / artwork.aspectRatio
      const cover = Math.max(videoWidth / width, videoHeight / height) / videoScale
      const scale = 1 + (cover - 1) * minimized
      const x = (baseVideo.width / 2 - artwork.left - artwork.width / 2) * minimized
      const y = (baseVideo.height / 2 - artwork.top - artwork.height / 2) * minimized
      artwork.element.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
      artwork.element.style.borderRadius = `${artwork.radius * (1 - minimized)}px`
      for (const metadata of element.querySelectorAll('.musicAudioMetadata')) metadata.style.opacity = String(1 - minimized)
    }
    const opacity = restoring
      ? Math.max(0, 1 - progress / 0.5)
      : Math.min(1, Math.max(0, (progress - 0.2) / 0.4))
    if (mobileMiniBarOverlay.value) mobileMiniBarOverlay.value.style.opacity = String(opacity)
  }

  function clearMobileMiniMorph() {
    const element = container.value
    if (!element) return
    const artwork = mobileMiniMorphBase?.artwork?.element
    artwork?.style.removeProperty('transform')
    artwork?.style.removeProperty('border-radius')
    for (const metadata of element.querySelectorAll('.musicAudioMetadata')) metadata.style.removeProperty('opacity')
    mobileMiniMorphBase = null
    element.removeAttribute('data-mobile-mini-morph')
    element.style.removeProperty('transform')
    for (const surface of element.querySelectorAll(':scope > .player, :scope > .countdownPoster, :scope > .musicAudioSurface')) {
      surface.style.removeProperty('clip-path')
      surface.style.removeProperty('--mobile-mini-media-scale')
    }
    mobileMiniBarOverlay.value?.style.removeProperty('opacity')
    for (const name of [
      '--mobile-mini-left', '--mobile-mini-top', '--mobile-mini-width', '--mobile-mini-height',
      '--mobile-mini-video-base-left', '--mobile-mini-video-base-top',
      '--mobile-mini-video-base-width', '--mobile-mini-video-base-height'
    ]) element.style.removeProperty(name)
  }

  function releaseMobileMiniBarTransition(element) {
    requestAnimationFrame(() => element.style.removeProperty('transition'))
  }

  function getInlineDragDistance(drag) {
    return Math.max(1, Math.abs(drag.to.top - drag.from.y))
  }

  function renderInlineDragProgress(progress) {
    const { from, to, restoring } = inlineDrag
    inlineDrag.progress = progress
    const fade = Math.min(1, progress * getInlineDragDistance(inlineDrag) / 96)
    watchNavigation.updateMinimizePreview(restoring ? 1 - progress : fade)
    if (usesMobileMiniBar()) {
      const videoTo = inlineDrag.videoTo ?? { left: 0, top: 0, width: to.width, height: to.height }
      renderMobileMiniMorph(from, to, inlineDrag.videoFrom, videoTo, progress, restoring)
    } else {
      const x = (to.left - from.x) * progress
      const y = (to.top - from.y) * progress
      const scaleX = 1 + (to.width / from.width - 1) * progress
      const scaleY = 1 + (to.height / from.height - 1) * progress
      const roundness = Math.min(1, (restoring ? 1 - progress : progress) * 5)
      const style = container.value.style
      style.transform = `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`
      style.borderRadius = `calc(10px * var(--ui-roundness) * ${roundness})`
    }
  }

  function renderScrollMiniPlayerDrag() {
    inlineDragFrame = null
    if (!inlineDrag || inlineDrag.settling) return
    renderInlineDragProgress(Math.min(1, Math.abs(inlineDrag.y) / getInlineDragDistance(inlineDrag)))
  }

  function moveScrollMiniPlayerDrag(_x, y) {
    if (!inlineDrag || inlineDrag.finishing) return
    inlineDrag.y = y
    if (inlineDragFrame === null) inlineDragFrame = requestAnimationFrame(renderScrollMiniPlayerDrag)
  }

  function updateScrollMiniPlayerBackProgress(progress) {
    if (!inlineDrag || inlineDrag.finishing) return
    moveScrollMiniPlayerDrag(0, progress * getInlineDragDistance(inlineDrag))
  }

  function settleScrollMiniPlayerDrag(commit) {
    const drag = inlineDrag
    const target = commit ? 1 : 0
    if (isReducedMotionEnabled() || drag.progress === target) {
      renderInlineDragProgress(target)
      return Promise.resolve()
    }
    drag.settling = true
    const from = drag.progress
    const started = performance.now()
    const duration = SCROLL_MINI_LAYOUT_ANIMATION_DURATION_MS / getAnimationSpeedMultiplier(store.getters.getAnimationSpeed)
    return new Promise(resolve => {
      drag.resolveSettle = resolve
      const frame = now => {
        inlineDragFrame = null
        if (inlineDrag !== drag) return resolve()
        const time = Math.max(0, Math.min(1, (now - started) / duration))
        const progress = 1 - (1 - time) ** 3
        renderInlineDragProgress(from + (target - from) * progress)
        if (time === 1) resolve()
        else inlineDragFrame = requestAnimationFrame(frame)
      }
      inlineDragFrame = requestAnimationFrame(frame)
    })
  }

  function cancelScrollMiniPlayerDrag() {
    scrollRestoreDrag = false
    if (inlineDragFrame !== null) cancelAnimationFrame(inlineDragFrame)
    inlineDragFrame = null
    inlineDrag?.resolveSettle?.()
    inlineDrag = null
    scrollMiniPlayerDragStyle.value = null
    mobileMiniBarOverlayStyle.value = null
    watchNavigation?.clearMinimizePreview()
    if (!scrollMiniPlayerActive.value) scrollMiniPlaceholderHeight.value = 0
    const element = container.value
    if (!element) return
    element.style.removeProperty('transform')
    element.style.removeProperty('transform-origin')
    element.style.removeProperty('will-change')
    element.style.removeProperty('border-radius')
    element.removeAttribute('data-inline-mini-drag')
    clearMobileMiniMorph()
  }

  async function finishScrollMiniPlayerDrag(commit) {
    if (scrollRestoreDrag) {
      scrollRestoreDrag = false
      if (commit && scrollMiniPlayerActive.value && isActiveTab.value && !playerSuspended.value) restoreInlinePlayer()
      return
    }
    if (!inlineDrag || inlineDrag.finishing) return
    const drag = inlineDrag
    let restored = false
    drag.finishing = true
    await drag.ready
    if (inlineDrag !== drag || !container.value) return
    if (inlineDragFrame !== null) cancelAnimationFrame(inlineDragFrame)
    renderScrollMiniPlayerDrag()
    try {
      await settleScrollMiniPlayerDrag(commit)
      if (inlineDrag !== drag || !container.value) return
      // Navigation and layout changes happen behind the completed preview, after
      // the video has reached the same endpoint as the normal mini-player motion.
      // Keep the bar active until navigation succeeds. The drag holds the video
      // in its top-level layer while the Watch route changes behind it.
      await watchNavigation.finishMinimizePreview(commit)
      restored = drag.restoring && commit && !watchNavigation.detached.value
      if (inlineDrag !== drag || !container.value) return
      if (restored) deactivateScrollMiniPlayer()
      if (drag.restoring && commit) {
        if (!scrollMiniPlayerActive.value) lightHaptic()
      } else if (commit && watchNavigation.detached.value) {
        activateScrollMiniPlayer(false)
        scrollMiniPlayerStashedSide.value = null
        scrollMiniPlayerRestoreRect = null
        if (usesMobileMiniBar()) {
          scrollMiniPlayerRect.value = getMobileMiniBarRect()
        } else {
          applyScrollMiniPlayerRect(drag.to, false, true)
        }
        if (scrollMiniPlayerActive.value) lightHaptic()
      }
    } finally {
      if (inlineDrag === drag) {
        if (commit && !drag.restoring && scrollMiniPlayerActive.value && usesMobileMiniBar()) {
          const element = container.value
          element.style.setProperty('transition', 'none', 'important')
          releaseMobileMiniBarTransition(element)
        }
        cancelScrollMiniPlayerDrag()
        // Watch is already inline after a committed restore. Its retained
        // layout briefly reports the old anchor position during navigation;
        // probing it here would dock the video again for one frame.
        if (!restored) updateScrollMiniPlayer({ animateActivation: false })
      }
    }
  }

  function updateScrollMiniVideoAspectRatio() {
    const videoElement = video.value
    if (!videoElement?.videoWidth || !videoElement.videoHeight) {
      return
    }

    scrollMiniVideoAspectRatio.value = videoElement.videoWidth / videoElement.videoHeight

    if (scrollMiniPlayerActive.value && !process.env.IS_CAPACITOR) {
      // Resizing to the video's aspect ratio is not the user moving the player,
      // so it must not turn a temporarily clamped position into its anchor.
      if (scrollMiniPlayerStashed.value) {
        handleScrollMiniWindowResize()
      } else {
        applyScrollMiniPlayerRect(scrollMiniPlayerRect.value, false, true)
      }
    }
  }

  function rememberInlinePlayerLayoutHeight() {
    if (scrollMiniPlayerActive.value) {
      return
    }

    const layoutHeight = getScrollMiniInlineLayoutHeight(container.value, lastKnownInlinePlayerHeight)
    if (layoutHeight >= SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT) {
      lastKnownInlinePlayerHeight = layoutHeight
    }
  }

  function getScrollMiniPlaceholderLayoutHeight() {
    // Navigation hides the retained Watch view before it teleports the player.
    // The drag's original measurement remains valid during that handoff.
    if (inlineDrag) return Math.max(inlineDrag.from.height, inlineDrag.from.width * 9 / 16)
    return getScrollMiniInlineLayoutHeight(container.value, lastKnownInlinePlayerHeight)
  }

  function canActivateScrollMiniPlayer() {
    if (!canUseScrollMiniPlayer()) {
      return false
    }

    return getScrollMiniPlaceholderLayoutHeight() >= SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT
  }

  function repairScrollMiniPlaceholderHeight() {
    if (!scrollMiniPlayerActive.value) {
      return
    }

    if (scrollMiniPlaceholderHeight.value >= SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT) {
      return
    }

    const layoutHeight = getScrollMiniPlaceholderLayoutHeight()
    if (layoutHeight < SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT) {
      return
    }

    scrollMiniPlaceholderHeight.value = layoutHeight
  }

  function clearScrollMiniPlayPauseHideTimeout() {
    if (scrollMiniPlayPauseHideTimeout != null) {
      clearTimeout(scrollMiniPlayPauseHideTimeout)
      scrollMiniPlayPauseHideTimeout = null
    }
  }

  function clearScrollMiniVolumeHideTimeout() {
    if (scrollMiniVolumeHideTimeout != null) {
      clearTimeout(scrollMiniVolumeHideTimeout)
      scrollMiniVolumeHideTimeout = null
    }
  }

  function showScrollMiniVolume() {
    clearScrollMiniVolumeHideTimeout()
    scrollMiniVolumeExpanded.value = true
  }

  function scheduleScrollMiniVolumeHide() {
    clearScrollMiniVolumeHideTimeout()

    scrollMiniVolumeHideTimeout = window.setTimeout(() => {
      scrollMiniVolumeHideTimeout = null
      scrollMiniVolumeExpanded.value = false
    }, SCROLL_MINI_VOLUME_HIDE_MS)
  }

  function hideScrollMiniPlayPause() {
    clearScrollMiniPlayPauseHideTimeout()
    scrollMiniPlayPauseVisible.value = false
    scrollMiniPlayPauseHiddenByTimer = true
  }

  function scheduleScrollMiniPlayPauseHide() {
    clearScrollMiniPlayPauseHideTimeout()

    const videoElement = video.value
    if (!videoElement || videoElement.paused) {
      return
    }

    scrollMiniPlayPauseHideTimeout = window.setTimeout(() => {
      scrollMiniPlayPauseHideTimeout = null

      if (video.value && !video.value.paused) {
        hideScrollMiniPlayPause()
      }
    }, SCROLL_MINI_PLAY_PAUSE_HIDE_MS)
  }

  /** @param {boolean} [autoHide] */
  function showScrollMiniPlayPause(autoHide = false) {
    scrollMiniPlayPauseVisible.value = true
    scrollMiniPlayPauseHiddenByTimer = false
    clearScrollMiniPlayPauseHideTimeout()

    if (autoHide) {
      scheduleScrollMiniPlayPauseHide()
    }
  }

  function canRevealScrollMiniPlayPauseFromPointer() {
    return performance.now() >= scrollMiniPointerRevealSuppressedUntil
  }

  function suppressScrollMiniPlayPausePointerReveal() {
    scrollMiniPointerRevealSuppressedUntil = performance.now() + SCROLL_MINI_POINTER_REVEAL_SUPPRESS_MS
  }

  /** @param {MouseEvent | FocusEvent} event */
  function handleScrollMiniPlayerLeave(event) {
    if (!scrollMiniPlayerActive.value) return

    const videoElement = video.value
    if (!videoElement || videoElement.paused) return

    const currentTarget = event.currentTarget
    const relatedTarget = event.relatedTarget
    if (
      currentTarget instanceof Node &&
      relatedTarget instanceof Node &&
      currentTarget.contains(relatedTarget)
    ) {
      return
    }

    scrollMiniPointerRevealSampleX = null
    scrollMiniPointerRevealSampleY = null

    if (scrollMiniPlayPauseVisible.value) {
      scheduleScrollMiniPlayPauseHide()
    }
  }

  function handleScrollMiniPlayerEnter() {
    if (!scrollMiniPlayerActive.value) return

    const videoElement = video.value
    if (!videoElement || videoElement.paused) return

    clearScrollMiniPlayPauseHideTimeout()

    if (scrollMiniPlayPauseVisible.value) {
      scheduleScrollMiniPlayPauseHide()
    }
  }

  function handleScrollMiniPlayPauseMouseEnter() {
    if (!scrollMiniPlayerActive.value) return

    const videoElement = video.value
    if (!videoElement || videoElement.paused) return

    showScrollMiniPlayPause(true)
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniControlsPointerMove(event) {
    const videoElement = video.value
    if (!scrollMiniPlayerActive.value || !videoElement || videoElement.paused) return
    if (scrollMiniPlayPauseVisible.value) return
    if (!canRevealScrollMiniPlayPauseFromPointer()) return
    if (event.pointerType === 'mouse' && event.buttons !== 0) return

    if (scrollMiniPointerRevealSampleX == null || scrollMiniPointerRevealSampleY == null) {
      scrollMiniPointerRevealSampleX = event.clientX
      scrollMiniPointerRevealSampleY = event.clientY
      return
    }

    const dx = event.clientX - scrollMiniPointerRevealSampleX
    const dy = event.clientY - scrollMiniPointerRevealSampleY
    scrollMiniPointerRevealSampleX = event.clientX
    scrollMiniPointerRevealSampleY = event.clientY

    if (Math.hypot(dx, dy) < SCROLL_MINI_POINTER_REVEAL_MIN_DISTANCE) return

    showScrollMiniPlayPause(true)
  }

  function isNativePipActive() {
    return pictureInPictureActive.value || isAndroidPipLayoutActive()
  }

  let androidPipLayoutRestored = false
  function isAndroidPipLayoutActive() {
    return process.env.IS_CAPACITOR && !process.env.IS_IOS &&
      (document.body.classList.contains('androidPictureInPicture') ||
        (document.body.classList.contains('androidPictureInPictureRestoring') && !androidPipLayoutRestored))
  }

  function handleAndroidPictureInPictureChange(event) {
    androidPipLayoutRestored = false
    if (!event.active) return
    cancelScrollMiniPlayerLayoutAnimation()
    cancelPendingScrollMiniScrollFrame()
    cancelScrollMiniPlayerBounce()
    cancelScrollMiniPlayerDrag()
  }

  function handleAndroidPictureInPictureRestored() {
    androidPipLayoutRestored = true
    resnapScrollMiniPlayerToEdge()
    updateScrollMiniPlayer({ animateActivation: false, animateDeactivation: false })
  }

  function isNativeFullscreenActive() {
    return Boolean(getUi()?.getControls?.()?.isFullScreenEnabled?.())
  }

  function restoreScrollMiniPlayerBeforeFullscreen() {
    if (!scrollMiniPlayerActive.value) {
      return
    }

    deactivateScrollMiniPlayer()
    container.value?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }

  function togglePlayerFullScreen() {
    const ui = getUi()
    if (!ui) {
      return
    }

    const controls = ui.getControls()

    if (controls.isFullScreenEnabled()) {
      controls.toggleFullScreen()
      return
    }

    if (scrollMiniPlayerActive.value) {
      restoreScrollMiniPlayerBeforeFullscreen()
      nextTick(() => {
        controls.toggleFullScreen()
      })
      return
    }

    controls.toggleFullScreen()
  }

  /** @param {MouseEvent} event */
  function handleFullscreenButtonClick(event) {
    if (!scrollMiniPlayerActive.value) {
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()
    togglePlayerFullScreen()
  }

  function canUseScrollMiniPlayerBase(explicitGesture = false) {
    if (playerSuspended.value) return false
    // An explicit swipe can minimize through panels and after playback ends.
    if (!explicitGesture && container.value?.hasAttribute('data-phone-panel-video')) return false
    if (props.format === 'audio' && !usesMobileMiniBar()) return false
    if (fullWindowEnabled.value) return false
    if (isNativeFullscreenActive()) return false
    if (isNativePipActive()) return false
    const videoElement = video.value
    if (!videoElement) return false
    if (videoElement.ended &&
      !(usesMobileMiniBar() && (explicitGesture || watchNavigation?.minimized?.value)) &&
      !(scrollMiniPlayerDetached.value && store.getters.getKeepPlayingOnNavigation && watchNavigation?.detached.value)) return false
    return true
  }

  function canShowCrossTabMiniPlayer() {
    const videoElement = video.value
    return !isActiveTab.value &&
      !autoPictureInPictureOnTabChange.value &&
      scrollMiniPlayerOnAllTabs.value &&
      canUseScrollMiniPlayerBase() &&
      ((store.getters.getKeepPlayingOnNavigation && watchNavigation?.detached.value) || watchNavigation?.minimized?.value ||
        isCrossTabMiniPlayerOwner(crossTabMiniPlayerCandidate) || !videoElement.paused)
  }

  function canUseScrollMiniPlayer() {
    if (!canUseScrollMiniPlayerBase()) return false

    if (isActiveTab.value) {
      return scrollMiniPlayerEnabled.value && !hasCrossTabMiniPlayerOwner()
    }

    return !autoPictureInPictureOnTabChange.value &&
      scrollMiniPlayerOnAllTabs.value &&
      isCrossTabMiniPlayerOwner(crossTabMiniPlayerCandidate)
  }

  function getScrollMiniAnchor() {
    return scrollMiniAnchor.value
  }

  /**
   * @param {import('../../../helpers/scrollMiniPlayer').ScrollMiniPlayerRect} rect
   * @param {boolean} [persist]
   * @param {boolean} [keepAnchor] trust the rect's own anchor over its geometry
   */
  function applyScrollMiniPlayerRect(rect, persist = false, keepAnchor = false) {
    const insets = getViewportInsets()
    const clamped = clampScrollMiniPlayerRect(rect, scrollMiniVideoAspectRatio.value)
    // Remember the edge the player is parked at, so a later resize can put it
    // back against that edge instead of leaving it where the old viewport was.
    // Dragging makes the geometry authoritative, but a re-anchored rect brings
    // the distance it is meant to keep: a viewport too short to honour it clamps
    // the rect, and re-deriving from that would forget the distance for good.
    Object.assign(clamped, (keepAnchor && pickScrollMiniVerticalAnchor(rect)) ||
      getScrollMiniVerticalAnchor(clamped, insets))
    scrollMiniPlayerRect.value = clamped
    scrollMiniResizeCorner.value = getResizeHandleCorner(clamped, insets)

    if (persist) {
      persistScrollMiniPlayerPosition(clamped)
    }
  }

  /** @param {import('../../../helpers/scrollMiniPlayer').ScrollMiniPlayerRect} rect */
  function persistScrollMiniPlayerPosition(rect) {
    // Save the visible restore position, never the offscreen tucked coordinates.
    const savedRect = { ...rect, stashedSide: scrollMiniPlayerStashedSide.value ?? undefined }
    setSavedScrollMiniPlayerRect(savedRect, isActiveTab.value ? 'scroll' : 'tab')
    store.dispatch(
      isActiveTab.value ? 'updateScrollMiniPlayerSavedRect' : 'updateCrossTabMiniPlayerSavedRect',
      serializeScrollMiniPlayerSavedRect(savedRect)
    )
  }

  function cancelScrollMiniPlayerBounce() {
    if (!scrollMiniBounceCancel) return

    scrollMiniBounceCancel()
    scrollMiniBounceCancel = null
  }

  function cancelScrollMiniPlayerLayoutAnimation() {
    scrollMiniLayoutAnimationSequence++
    scrollMiniLayoutAnimation?.cancel()
    scrollMiniLayoutAnimation = null
    scrollMiniPlayerAnimating.value = false
    mobileMiniBarOverlayStyle.value = null
  }

  /**
   * Animate the player from its bounds before a layout switch to its new ones.
   *
   * @param {DOMRect} previousRect
   * @param {boolean} expectedActive
   * @param {number} sequence
   * @param {DOMRect | null} [previousVideoRect]
   */
  async function animateScrollMiniPlayerLayout(previousRect, expectedActive, sequence, previousVideoRect = null) {
    const playerContainer = container.value
    if (!playerContainer) return

    await nextTick()
    if (
      scrollMiniLayoutAnimationSequence !== sequence ||
      scrollMiniPlayerActive.value !== expectedActive
    ) return

    const inlineLayout = usesMobileMiniBar() && !expectedActive ? measureInlinePlayer() : null
    let inlineSlotWidth = inlineLayout?.slotWidth
    let nextRect = inlineLayout?.rect ?? playerContainer.getBoundingClientRect()
    if (nextRect.width === 0 || nextRect.height === 0) {
      scrollMiniPlayerAnimating.value = false
      mobileMiniBarOverlayStyle.value = null
      return
    }

    if (usesMobileMiniBar() && previousVideoRect && video.value) {
      positionMobileMiniBarOverlay(expectedActive ? nextRect : previousRect)
      const nextVideoRect = inlineLayout?.videoRect ?? video.value.getBoundingClientRect()
      const videoFrom = {
        left: previousVideoRect.left - previousRect.left,
        top: previousVideoRect.top - previousRect.top,
        width: previousVideoRect.width,
        height: previousVideoRect.height
      }
      const videoTo = {
        left: nextVideoRect.left - nextRect.left,
        top: nextVideoRect.top - nextRect.top,
        width: nextVideoRect.width,
        height: nextVideoRect.height
      }
      const duration = SCROLL_MINI_LAYOUT_ANIMATION_DURATION_MS /
        getAnimationSpeedMultiplier(store.getters.getAnimationSpeed)
      const started = performance.now()
      let frameId = null
      const animation = {
        cancel() {
          if (frameId !== null) cancelAnimationFrame(frameId)
          clearMobileMiniMorph()
          playerContainer.style.removeProperty('transition')
        }
      }
      const frame = now => {
        if (scrollMiniLayoutAnimation !== animation) return
        const time = Math.min(1, Math.max(0, (now - started) / duration))
        const progress = time * time * (3 - 2 * time)
        // Read the stable inline slot before writing the transform. Its bounds
        // follow touch/smooth scrolling and browser scroll anchoring while the
        // video remains in the viewport layer.
        const slot = !expectedActive ? scrollMiniPlaceholder.value?.getBoundingClientRect() : null
        if (slot && slot.width !== inlineSlotWidth) {
          const layout = measureInlinePlayer()
          if (layout) {
            inlineSlotWidth = layout.slotWidth
            nextRect = layout.rect
            Object.assign(videoTo, {
              left: layout.videoRect.left - nextRect.left,
              top: layout.videoRect.top - nextRect.top,
              width: layout.videoRect.width,
              height: layout.videoRect.height
            })
          }
        }
        const target = expectedActive
          ? nextRect
          : {
              left: slot?.left ?? nextRect.left,
              top: slot?.top ?? nextRect.top,
              width: nextRect.width,
              height: nextRect.height
            }
        renderMobileMiniMorph(previousRect, target, videoFrom, videoTo, progress, !expectedActive)
        if (time < 1) {
          frameId = requestAnimationFrame(frame)
        } else {
          scrollMiniLayoutAnimation = null
          clearMobileMiniMorph()
          scrollMiniPlayerAnimating.value = false
          if (!expectedActive) scrollMiniPlaceholderHeight.value = 0
          mobileMiniBarOverlayStyle.value = null
          releaseMobileMiniBarTransition(playerContainer)
        }
      }
      scrollMiniLayoutAnimation = animation
      renderMobileMiniMorph(previousRect, nextRect, videoFrom, videoTo, 0, !expectedActive)
      frameId = requestAnimationFrame(frame)
      return
    }

    const animation = applyAnimationSpeed(playerContainer.animate([
      {
        transform: `translate(${previousRect.left - nextRect.left}px, ${previousRect.top - nextRect.top}px) scale(${previousRect.width / nextRect.width}, ${previousRect.height / nextRect.height})`,
        transformOrigin: 'top left'
      },
      {
        transform: 'none',
        transformOrigin: 'top left'
      }
    ], {
      duration: SCROLL_MINI_LAYOUT_ANIMATION_DURATION_MS,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
    }))

    scrollMiniLayoutAnimation = animation
    animation.addEventListener('finish', () => {
      if (scrollMiniLayoutAnimation === animation) {
        scrollMiniLayoutAnimation = null
        scrollMiniPlayerAnimating.value = false
        nextTick(() => updateScrollMiniDragHandleContrast(true))
      }
    })
  }

  function animateScrollMiniPlayerRectChange(update) {
    const previousRect = container.value?.getBoundingClientRect()
    cancelScrollMiniPlayerLayoutAnimation()
    update()

    if (!previousRect || isReducedMotionEnabled()) return

    const sequence = ++scrollMiniLayoutAnimationSequence
    scrollMiniPlayerAnimating.value = true
    animateScrollMiniPlayerLayout(previousRect, true, sequence)
  }

  function syncScrollMiniPlayerState() {
    const videoElement = video.value
    if (!videoElement) return

    scrollMiniVolume.value = videoElement.muted ? 0 : videoElement.volume
    scrollMiniIsPaused.value = videoElement.paused
    updateMobileMiniBarProgress()
    updateScrollMiniVolumeBarFill()
  }

  function updateMobileMiniBarProgress() {
    const videoElement = video.value
    const seekRange = getUi()?.getControls()?.getPlayer()?.seekRange()
    const start = seekRange?.start ?? 0
    const end = seekRange?.end ?? videoElement?.duration
    const duration = end - start
    const currentTime = videoElement?.currentTime
    mobileMiniBarHasSeekRange.value = Number.isFinite(duration) && duration > 0
    mobileMiniBarProgress.value = mobileMiniBarHasSeekRange.value && Number.isFinite(currentTime)
      ? Math.min(1, Math.max(0, (currentTime - start) / duration))
      : 0
  }

  function updateScrollMiniVolumeBarFill() {
    updateScrollMiniPlayerVolumeBarFill(
      scrollMiniVolumeTrack.value,
      scrollMiniVolumePercent.value
    )
  }

  /** @param {boolean} [force] */
  function updateScrollMiniDragHandleContrast(force = false) {
    // Reading pixels from a hardware-decoded video can synchronously stall the
    // renderer. Keep it out of the first frame and the rest of the transition.
    if (!scrollMiniPlayerActive.value || scrollMiniPlayerAnimating.value || inlineDrag) return

    const now = performance.now()
    if (!force && now - scrollMiniDragHandleContrastLastUpdate < SCROLL_MINI_DRAG_HANDLE_CONTRAST_MS) {
      return
    }

    scrollMiniDragHandleContrastLastUpdate = now

    const rect = scrollMiniPlayerRect.value
    const luminance = sampleScrollMiniDragHandleLuminance(
      video.value,
      rect.width,
      rect.height
    )
    if (luminance == null) return

    scrollMiniDragHandleOnLightBg.value = resolveScrollMiniDragHandleOnLightBg(
      luminance,
      scrollMiniDragHandleOnLightBg.value
    )

    const resizeLuminance = sampleScrollMiniHandleLuminance(
      video.value,
      rect.width,
      rect.height,
      getScrollMiniResizeHandleSampleRect(rect, scrollMiniResizeCorner.value)
    )
    if (resizeLuminance == null) return

    scrollMiniResizeHandleOnLightBg.value = resolveScrollMiniDragHandleOnLightBg(
      resizeLuminance,
      scrollMiniResizeHandleOnLightBg.value
    )
  }

  /**
   * @param {import('../../../helpers/scrollMiniPlayer').ScrollMiniPlayerRect} rect
   * @param {string} corner
   * @returns {{ left: number, top: number, width: number, height: number }}
   */
  function getScrollMiniResizeHandleSampleRect(rect, corner) {
    const size = 18
    return {
      left: corner.endsWith('right') ? rect.width - size : 0,
      top: corner.startsWith('bottom') ? rect.height - size : 0,
      width: size,
      height: size,
    }
  }

  function setupScrollMiniIntersectionObserver() {
    if (scrollMiniIntersectionObserver) {
      scrollMiniIntersectionObserver.disconnect()
      scrollMiniIntersectionObserver = null
    }

    if ((props.format === 'audio' && !usesMobileMiniBar()) || typeof IntersectionObserver === 'undefined') {
      return
    }

    const anchor = getScrollMiniAnchor()
    if (!anchor) return

    scrollMiniIntersectionObserver = new IntersectionObserver(() => {
      updateScrollMiniPlayer()
    }, { threshold: [0, ENTER_MINI_RATIO, EXIT_MINI_RATIO, 1] })

    scrollMiniIntersectionObserver.observe(anchor)
  }

  /** @param {boolean} [animate] */
  function activateScrollMiniPlayer(animate = true) {
    if (scrollMiniPlayerActive.value) return

    const playerContainer = container.value
    if (!playerContainer) return
    const shouldAnimate = animate && !isReducedMotionEnabled()
    const previousRect = shouldAnimate ? playerContainer.getBoundingClientRect() : null
    const previousVideoRect = previousRect ? video.value?.getBoundingClientRect() : null

    const layoutHeight = getScrollMiniPlaceholderLayoutHeight()
    if (layoutHeight < SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT) {
      return
    }

    // Size the placeholder to the container's actual in-flow height so switching
    // the player to fixed positioning does not change the document height. The
    // max-based layout height can overshoot the real rendered height (e.g. for
    // non-16:9 videos), which would shift content below and jump the scroll up.
    const measuredHeight = playerContainer.offsetHeight
    const placeholderHeight = measuredHeight >= SCROLL_MINI_MIN_INLINE_LAYOUT_HEIGHT
      ? measuredHeight
      : layoutHeight

    lastKnownInlinePlayerHeight = layoutHeight
    scrollMiniPlaceholderHeight.value = placeholderHeight

    cancelScrollMiniPlayerLayoutAnimation()
    const animationSequence = scrollMiniLayoutAnimationSequence
    scrollMiniPlayerAnimating.value = previousRect !== null

    if (usesMobileMiniBar()) playerContainer.style.setProperty('transition', 'none', 'important')

    scrollMiniPlayerActive.value = true
    updateScrollMiniVideoAspectRatio()
    restoreScrollMiniPlayerPosition()
    syncScrollMiniPlayerState()

    if (scrollMiniPlayPauseHiddenByTimer) {
      scrollMiniPlayPauseVisible.value = false
    } else {
      showScrollMiniPlayPause(true)
    }

    nextTick(() => {
      updateScrollMiniVolumeBarFill()
      updateScrollMiniDragHandleContrast(true)
      if (usesMobileMiniBar() && !previousRect && !inlineDrag) {
        releaseMobileMiniBarTransition(playerContainer)
      }
    })

    if (previousRect) {
      animateScrollMiniPlayerLayout(previousRect, true, animationSequence, previousVideoRect)
    }
  }

  function restoreScrollMiniPlayerPosition() {
    if (usesMobileMiniBar()) {
      scrollMiniPlayerRect.value = getMobileMiniBarRect()
      return
    }
    const savedRect = getSavedScrollMiniPlayerRect(isActiveTab.value ? 'scroll' : 'tab')
    applyScrollMiniPlayerRect(
      savedRect
        // Restore against the saved edges, since the viewport may have resized.
        ? reanchorScrollMiniPlayerRect(savedRect, scrollMiniVideoAspectRatio.value)
        : getDefaultScrollMiniPlayerRect(scrollMiniVideoAspectRatio.value),
      false,
      true
    )
    if (savedRect?.stashedSide) {
      scrollMiniPlayerStashedSide.value = savedRect.stashedSide
      scrollMiniPlayerRestoreRect = scrollMiniPlayerRect.value
      scrollMiniPlayerRect.value = getStashedScrollMiniPlayerRect(
        scrollMiniPlayerRestoreRect, savedRect.stashedSide, window.innerWidth, getViewportInsets()
      )
    }
  }

  /** @param {boolean} [animate] */
  function deactivateScrollMiniPlayer(animate = false) {
    releaseCrossTabMiniPlayerOwnership(crossTabMiniPlayerCandidate)

    const playerContainer = container.value
    const shouldAnimate = animate && playerContainer !== null && !isReducedMotionEnabled()
    const previousRect = shouldAnimate ? playerContainer.getBoundingClientRect() : null
    const previousVideoRect = previousRect ? video.value?.getBoundingClientRect() : null

    cancelScrollMiniPlayerLayoutAnimation()
    const animationSequence = scrollMiniLayoutAnimationSequence
    if (previousRect && usesMobileMiniBar()) positionMobileMiniBarOverlay(previousRect)
    scrollMiniPlayerAnimating.value = previousRect !== null

    scrollMiniPlayerActive.value = false
    scrollMiniPlayerStashedSide.value = null
    scrollMiniPlayerRestoreRect = null
    if (!previousRect || !usesMobileMiniBar()) scrollMiniPlaceholderHeight.value = 0
    scrollMiniDragHandleOnLightBg.value = false
    scrollMiniResizeHandleOnLightBg.value = false
    scrollMiniPlayPauseHiddenByTimer = false
    clearScrollMiniPlayPauseHideTimeout()

    cancelScrollMiniPlayerBounce()
    endScrollMiniPointerSession()
    clearScrollMiniVolumeHideTimeout()
    scrollMiniVolumeExpanded.value = false

    if (previousRect) {
      animateScrollMiniPlayerLayout(previousRect, false, animationSequence, previousVideoRect)
    }
  }

  /** @param {{ animateActivation?: boolean, animateDeactivation?: boolean }} [options] */
  function updateScrollMiniPlayer({ animateActivation = true, animateDeactivation = true } = {}) {
    // The native PiP viewport makes the inline anchor appear offscreen. Keep
    // its existing layout so returning cannot start a dock/restore animation.
    if (isAndroidPipLayoutActive()) return
    if (inlineDrag) return
    if (!isActiveTab.value) {
      refreshCrossTabMiniPlayer(crossTabMiniPlayerCandidate)
    }

    // Check first: everything below reads layout, which forces a synchronous
    // reflow. Measuring before knowing whether the mini player can run at all
    // would do that on every scroll event even with the feature turned off.
    if (!canUseScrollMiniPlayer()) {
      if (scrollMiniPlayerActive.value) {
        deactivateScrollMiniPlayer()
      }
      return
    }

    rememberInlinePlayerLayoutHeight()

    repairScrollMiniPlaceholderHeight()

    if (!isActiveTab.value) {
      if (scrollMiniPlayerActive.value) {
        syncScrollMiniPlayerState()
        updateScrollMiniDragHandleContrast()
      } else if (canActivateScrollMiniPlayer()) {
        activateScrollMiniPlayer(false)
      }
      return
    }

    const anchor = getScrollMiniAnchor()
    if (!anchor) return

    const ratio = getAnchorVisibleRatio(anchor, getScrollMiniPlaceholderLayoutHeight())

    if (scrollMiniPlayerActive.value) {
      if (ratio >= EXIT_MINI_RATIO) {
        deactivateScrollMiniPlayer(animateDeactivation)
      } else {
        syncScrollMiniPlayerState()
        updateScrollMiniDragHandleContrast()
      }
    } else if (ratio < ENTER_MINI_RATIO && canActivateScrollMiniPlayer()) {
      activateScrollMiniPlayer(animateActivation)
    }
  }

  function handleScrollMiniWindowScroll() {
    suppressScrollMiniPlayPausePointerReveal()

    // Scroll fires far more often than the screen refreshes, so coalesce the
    // layout-reading update into the next frame instead of running it per event.
    if (scrollMiniScrollFrame !== null) {
      return
    }

    scrollMiniScrollFrame = requestAnimationFrame(() => {
      scrollMiniScrollFrame = null
      updateScrollMiniPlayer()
    })
  }

  function cancelPendingScrollMiniScrollFrame() {
    if (scrollMiniScrollFrame !== null) {
      cancelAnimationFrame(scrollMiniScrollFrame)
      scrollMiniScrollFrame = null
    }
  }

  /**
   * Re-dock to the current insets, horizontally and vertically. Needed whenever
   * the usable area changes (window resize, or the vertical tab bar being
   * toggled/resized), otherwise the player is stranded mid-screen at its old edge.
   */
  function resnapScrollMiniPlayerToEdge() {
    if (!scrollMiniPlayerActive.value) return
    if (usesMobileMiniBar()) {
      scrollMiniPlayerRect.value = getMobileMiniBarRect()
      return
    }
    // Only a drag/resize is positioning the player; a volume session must not
    // block re-docking, since its pointer-up path never snaps.
    if (scrollMiniPointerSession?.type === 'drag' || scrollMiniPointerSession?.type === 'resize') return

    if (scrollMiniPlayerStashed.value) {
      handleScrollMiniWindowResize()
      return
    }

    cancelScrollMiniPlayerBounce()
    applyScrollMiniPlayerRect(
      reanchorScrollMiniPlayerRect(scrollMiniPlayerRect.value, scrollMiniVideoAspectRatio.value),
      true,
      true
    )
  }

  function handleScrollMiniWindowResize() {
    if (isAndroidPipLayoutActive()) return
    const stashedSide = scrollMiniPlayerStashedSide.value
    if (stashedSide) {
      const insets = getViewportInsets()
      const restoreRect = reanchorScrollMiniPlayerRect(
        scrollMiniPlayerRestoreRect ?? scrollMiniPlayerRect.value,
        scrollMiniVideoAspectRatio.value
      )
      scrollMiniPlayerRestoreRect = restoreRect
      scrollMiniPlayerRect.value = getStashedScrollMiniPlayerRect(
        restoreRect,
        stashedSide,
        window.innerWidth,
        insets
      )
      updateScrollMiniPlayer()
      return
    }

    resnapScrollMiniPlayerToEdge()
    updateScrollMiniPlayer()
  }

  function restoreInlinePlayer() {
    window.scrollTo({ top: 0, behavior: 'instant' })
    if (scrollMiniPlayerActive.value) deactivateScrollMiniPlayer()
  }

  function scrollMiniScrollToTop(event) {
    event?.preventDefault()
    event?.stopPropagation()

    if (scrollMiniPlayerDetached.value && tabId) {
      if (watchNavigation?.detached.value) {
        if (watchNavigation.tabPresented.value && beginScrollMiniPlayerDrag(true)) {
          finishScrollMiniPlayerDrag(true)
          return
        }
        watchNavigation.returnToVideo()
      }
      if (process.env.IS_CAPACITOR) {
        getCapacitorTabService().activateTab(tabId)
      } else {
        store.dispatch('activateTab', tabId)
      }
      return
    }

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function dismissCrossTabMiniPlayer(event) {
    event?.preventDefault()
    event?.stopPropagation()

    if (!scrollMiniPlayerDetached.value && !(usesMobileMiniBar() && watchNavigation?.detached.value)) return

    if (watchNavigation?.detached.value) {
      watchNavigation.dismiss()
      return
    }
    scrollMiniPlayerDismissed.value = true
  }

  async function scrollMiniTogglePlayPause(event) {
    event?.preventDefault()
    event?.stopPropagation()

    const videoElement = video.value
    if (!videoElement) return

    if (videoElement.ended || videoElement.paused) {
      if (videoElement.ended) videoElement.currentTime = 0
      try {
        await videoElement.play()
      } catch (error) {
        console.warn('Unable to resume mini player playback:', error)
      }
    } else {
      videoElement.pause()
    }

    syncScrollMiniPlayerState()
    showScrollMiniPlayPause(true)
  }

  /** @param {Event} event */
  function updateScrollMiniVolume(event) {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return

    showScrollMiniVolume()

    const nextVolume = Number.parseFloat(target.value) / 100
    const videoElement = video.value
    if (!videoElement || Number.isNaN(nextVolume)) return

    videoElement.volume = nextVolume
    videoElement.muted = nextVolume === 0
    scrollMiniVolume.value = nextVolume
    updateScrollMiniVolumeBarFill()
  }

  function handleScrollMiniVolumeMouseEnter() {
    if (!scrollMiniPlayerActive.value) return

    showScrollMiniVolume()
  }

  function handleScrollMiniVolumeMouseLeave() {
    if (!scrollMiniPlayerActive.value) return
    if (scrollMiniPointerSession?.type === 'volume') return

    scheduleScrollMiniVolumeHide()
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniVolumePointerDown(event) {
    if (!scrollMiniPlayerActive.value) return

    showScrollMiniVolume()
    scrollMiniPointerSession = {
      type: 'volume',
      startX: event.clientX,
      startY: event.clientY,
      startRect: { ...scrollMiniPlayerRect.value },
    }

    window.addEventListener('pointerup', handleScrollMiniVolumePointerUpWindow)
    window.addEventListener('pointercancel', handleScrollMiniVolumePointerUpWindow)
  }

  function handleScrollMiniVolumePointerUpWindow() {
    if (scrollMiniPointerSession?.type === 'volume') {
      scrollMiniPointerSession = null
    }

    window.removeEventListener('pointerup', handleScrollMiniVolumePointerUpWindow)
    window.removeEventListener('pointercancel', handleScrollMiniVolumePointerUpWindow)
    scheduleScrollMiniVolumeHide()
  }

  function endScrollMiniPointerSession() {
    if (scrollMiniPointerSession?.type === 'volume') scheduleScrollMiniVolumeHide()
    scrollMiniPointerSession = null
    document.body.classList.remove('scroll-mini-player-grabbing')
    window.removeEventListener('pointerup', handleScrollMiniVolumePointerUpWindow)
    window.removeEventListener('pointercancel', handleScrollMiniVolumePointerUpWindow)
    window.removeEventListener('pointermove', handleScrollMiniPointerMoveWindow)
    window.removeEventListener('pointerup', handleScrollMiniPointerUpWindow)
    window.removeEventListener('pointercancel', handleScrollMiniPointerUpWindow)
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniPointerMoveWindow(event) {
    if (!scrollMiniPointerSession || !scrollMiniPlayerActive.value) return

    const insets = getViewportInsets()

    if (scrollMiniPointerSession.type === 'drag') {
      const startRect = scrollMiniPointerSession.startRect
      const dx = event.clientX - scrollMiniPointerSession.startX
      const dy = event.clientY - scrollMiniPointerSession.startY

      applyScrollMiniPlayerRect(clampScrollMiniPlayerRect({
        ...startRect,
        left: startRect.left + dx,
        top: startRect.top + dy,
      }, scrollMiniVideoAspectRatio.value))
    } else if (scrollMiniPointerSession.type === 'resize' && scrollMiniPointerSession.corner) {
      const { startRect, startX, corner } = scrollMiniPointerSession
      const edgeX = startRect.left + (corner.endsWith('right') ? startRect.width : 0)
      // Preserve the grab offset, including presses inside the larger touch target.
      applyScrollMiniPlayerRect(resizeScrollMiniPlayerFromCorner(
        startRect,
        /** @type {'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'} */ (corner),
        edgeX + event.clientX - startX,
        event.clientY,
        insets,
        scrollMiniVideoAspectRatio.value
      ))
    }

    updateScrollMiniDragHandleContrast()
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniPointerUpWindow(event) {
    if (!scrollMiniPointerSession) return

    if (scrollMiniPointerSession.type === 'drag') {
      const insets = getViewportInsets()
      const currentRect = scrollMiniPlayerRect.value
      const stashSide = window.matchMedia('(max-width: 767px)').matches
        ? getScrollMiniPlayerStashSide(
            scrollMiniPointerSession.startRect,
            event.clientX - scrollMiniPointerSession.startX,
            window.innerWidth,
            insets
          )
        : null
      if (stashSide) {
        scrollMiniPlayerRestoreRect = {
          ...snapScrollMiniPlayerToEdge({ ...currentRect, dock: stashSide }, insets),
          ...getScrollMiniVerticalAnchor(currentRect, insets)
        }
        animateScrollMiniPlayerRectChange(() => {
          scrollMiniPlayerStashedSide.value = stashSide
          persistScrollMiniPlayerPosition(scrollMiniPlayerRestoreRect)
          scrollMiniPlayerRect.value = getStashedScrollMiniPlayerRect(
            currentRect,
            stashSide,
            window.innerWidth,
            insets
          )
        })
        endScrollMiniPointerSession()
        event.preventDefault()
        return
      }

      if (shouldBounceScrollMiniPlayerToEdge(currentRect, insets)) {
        const targetRect = snapScrollMiniPlayerToEdge(currentRect, insets)
        const fromRect = { ...currentRect }

        if (scrollMiniBounceCancel) {
          scrollMiniBounceCancel()
        }

        scrollMiniBounceCancel = animateScrollMiniPlayerBounce(
          fromRect,
          targetRect,
          (rect) => {
            applyScrollMiniPlayerRect(clampScrollMiniPlayerRect(rect, scrollMiniVideoAspectRatio.value))
          },
          () => {
            applyScrollMiniPlayerRect(clampScrollMiniPlayerRect(targetRect, scrollMiniVideoAspectRatio.value), true)
            scrollMiniBounceCancel = null
          }
        )
      } else {
        applyScrollMiniPlayerRect(snapScrollMiniPlayerToEdge(currentRect, insets), true)
      }
    } else {
      applyScrollMiniPlayerRect(clampScrollMiniPlayerRect(scrollMiniPlayerRect.value, scrollMiniVideoAspectRatio.value), true)
    }

    endScrollMiniPointerSession()
    event.preventDefault()
  }

  function revealScrollMiniPlayerControls(event) {
    if (!scrollMiniPlayerActive.value) return
    if (!scrollMiniPlayerStashed.value) {
      // Reveal after the tap ends so its click cannot hit the newly visible
      // play/pause button underneath the finger.
      if (event?.type === 'pointerdown') return
      showScrollMiniPlayPause(true)
      return
    }

    event?.preventDefault()
    event?.stopPropagation()
    const restoreRect = scrollMiniPlayerRestoreRect ?? getDefaultScrollMiniPlayerRect()
    animateScrollMiniPlayerRectChange(() => {
      scrollMiniPlayerStashedSide.value = null
      scrollMiniPlayerRestoreRect = null
      applyScrollMiniPlayerRect(restoreRect, true)
    })
    showScrollMiniPlayPause(true)
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniDragPointerDown(event) {
    if (!scrollMiniPlayerActive.value) return

    event.preventDefault()
    event.stopPropagation()
    cancelScrollMiniPlayerBounce()

    scrollMiniPointerSession = {
      type: 'drag',
      startX: event.clientX,
      startY: event.clientY,
      startRect: { ...scrollMiniPlayerRect.value },
    }

    document.body.classList.add('scroll-mini-player-grabbing')
    window.addEventListener('pointermove', handleScrollMiniPointerMoveWindow)
    window.addEventListener('pointerup', handleScrollMiniPointerUpWindow)
    window.addEventListener('pointercancel', handleScrollMiniPointerUpWindow)
  }

  /** @param {PointerEvent} event */
  function handleScrollMiniResizePointerDown(event) {
    if (!scrollMiniPlayerActive.value) return

    event.preventDefault()
    event.stopPropagation()
    cancelScrollMiniPlayerBounce()

    scrollMiniPointerSession = {
      type: 'resize',
      corner: getResizeHandleCorner(scrollMiniPlayerRect.value, getViewportInsets()),
      startX: event.clientX,
      startY: event.clientY,
      startRect: { ...scrollMiniPlayerRect.value },
    }

    document.body.classList.add('scroll-mini-player-grabbing')
    window.addEventListener('pointermove', handleScrollMiniPointerMoveWindow)
    window.addEventListener('pointerup', handleScrollMiniPointerUpWindow)
    window.addEventListener('pointercancel', handleScrollMiniPointerUpWindow)
  }

  function teardownScrollMiniPlayer() {
    unregisterCrossTabMiniPlayer(crossTabMiniPlayerCandidate)
    mobileMiniBarLayoutObserver?.disconnect()
    mobileMiniBarLayoutObserver = null

    if (scrollMiniIntersectionObserver) {
      scrollMiniIntersectionObserver.disconnect()
      scrollMiniIntersectionObserver = null
    }

    clearScrollMiniPlayPauseHideTimeout()

    cancelScrollMiniPlayerBounce()
    cancelScrollMiniPlayerLayoutAnimation()
    cancelPendingScrollMiniScrollFrame()
    cancelScrollMiniPlayerDrag()

    endScrollMiniPointerSession()
    clearScrollMiniVolumeHideTimeout()
    window.removeEventListener('pointerup', handleScrollMiniVolumePointerUpWindow)
    window.removeEventListener('pointercancel', handleScrollMiniVolumePointerUpWindow)
    window.removeEventListener('scroll', handleScrollMiniWindowScroll)
    window.removeEventListener('resize', handleScrollMiniWindowResize)

    if (scrollMiniPlayerActive.value) {
      scrollMiniPlayerActive.value = false
    }
  }

  let unregisterAndroidBackPlayer = null
  onMounted(() => {
    const sideNav = document.querySelector('.sideNav')
    if (sideNav) {
      mobileMiniBarLayoutObserver = new ResizeObserver(() => {
        if (scrollMiniPlayerActive.value && usesMobileMiniBar()) handleScrollMiniWindowResize()
      })
      mobileMiniBarLayoutObserver.observe(sideNav)
    }
    if (!process.env.IS_CAPACITOR || process.env.IS_IOS) return
    window.addEventListener('opentubex:android-pip', handleAndroidPictureInPictureChange)
    window.addEventListener('opentubex:android-pip-restored', handleAndroidPictureInPictureRestored)
    if (!tabId) return
    unregisterAndroidBackPlayer = registerAndroidBackPlayer(tabId, {
      begin: () => {
        // Match normal Back's retention policy and destination. A previous
        // Watch entry, fullscreen, or PiP cannot dock here. Paused and loading
        // players use the same retained component as playing videos.
        const tab = store.getters.getTabById(tabId)
        return isActiveTab.value && !watchNavigation?.detached.value &&
          store.getters.getKeepPlayingOnNavigation &&
          Boolean(getPreviousBrowsingRoute(tab)) &&
          !isReducedMotionEnabled() && beginScrollMiniPlayerDrag()
      },
      update: updateScrollMiniPlayerBackProgress,
      finish: commit => {
        if (!isActiveTab.value || playerSuspended.value ||
          !store.getters.getKeepPlayingOnNavigation || watchNavigation?.detached.value) {
          cancelScrollMiniPlayerDrag()
          return Promise.resolve()
        }
        return finishScrollMiniPlayerDrag(commit)
      },
      cancel: cancelScrollMiniPlayerDrag,
    })
  })
  onBeforeUnmount(() => {
    unregisterAndroidBackPlayer?.()
    window.removeEventListener('opentubex:android-pip', handleAndroidPictureInPictureChange)
    window.removeEventListener('opentubex:android-pip-restored', handleAndroidPictureInPictureRestored)
  })

  watch(scrollMiniVolumePercent, updateScrollMiniVolumeBarFill)

  watch(() => props.videoId, () => {
    lastKnownInlinePlayerHeight = 0
    mobileMiniBarProgress.value = 0
    mobileMiniBarHasSeekRange.value = false

    if (scrollMiniPlayerActive.value) {
      deactivateScrollMiniPlayer()
    }
  })

  watch([isActiveTab, playerSuspended], ([active, suspended]) => {
    if (inlineDrag && !inlineDrag.finishing && (!active || suspended)) cancelScrollMiniPlayerDrag()
    if (suspended) {
      unregisterCrossTabMiniPlayer(crossTabMiniPlayerCandidate)
      deactivateScrollMiniPlayer()
      return
    }
    if (scrollMiniPlayerActive.value && !inlineDrag) {
      // A tab switch can change modes without deactivating the mini player.
      // Cancel unfinished gestures so they cannot overwrite the new mode's position.
      cancelScrollMiniPlayerBounce()
      cancelScrollMiniPlayerLayoutAnimation()
      endScrollMiniPointerSession()
      scrollMiniPlayerStashedSide.value = null
      scrollMiniPlayerRestoreRect = null
      restoreScrollMiniPlayerPosition()
    }

    if (active) {
      scrollMiniPlayerDismissed.value = false
      markCrossTabMiniPlayerActive(crossTabMiniPlayerCandidate)
    } else {
      markCrossTabMiniPlayerInactive(crossTabMiniPlayerCandidate)
    }

    nextTick(() => updateScrollMiniPlayer({ animateActivation: false }))
  }, { flush: 'sync' })

  watch(
    () => store.getters.getScrollMiniPlayerSavedRect,
    value => setSavedScrollMiniPlayerRect(parseScrollMiniPlayerSavedRect(value), 'scroll'),
    { immediate: true }
  )
  watch(
    () => store.getters.getCrossTabMiniPlayerSavedRect,
    value => setSavedScrollMiniPlayerRect(parseScrollMiniPlayerSavedRect(value), 'tab'),
    { immediate: true }
  )

  watch(scrollMiniPlayerEnabled, () => updateScrollMiniPlayer())
  watch(() => watchNavigation?.detached.value, detached => {
    if (detached) fullWindowEnabled.value = false
  }, { flush: 'sync' })
  watch(scrollMiniPlayerOnAllTabs, () => updateScrollMiniPlayer())
  watch(autoPictureInPictureOnTabChange, () => updateScrollMiniPlayer())
  watch(fullWindowEnabled, () => {
    refreshCrossTabMiniPlayer(crossTabMiniPlayerCandidate)
    updateScrollMiniPlayer()
  })

  // Toggling or resizing the vertical tab bar changes the usable area without
  // firing a window resize, so re-dock explicitly (after the DOM updates, so the
  // rail's new bounds are measurable).
  watch(
    () => [store.getters.getTabBarPosition, store.getters.getVerticalTabBarWidth],
    () => { nextTick(resnapScrollMiniPlayerToEdge) }
  )

  return {
    scrollMiniPlayerDragStyle,
    mobileMiniBar,
    mobileMiniBarCanDismiss,
    mobileMiniBarOverlayStyle,
    mobileMiniBarProgress,
    mobileMiniBarHasSeekRange,
    updateMobileMiniBarProgress,
    beginScrollMiniPlayerDrag,
    moveScrollMiniPlayerDrag,
    finishScrollMiniPlayerDrag,
    cancelScrollMiniPlayerDrag,
    deactivateScrollMiniPlayer,
    dismissCrossTabMiniPlayer,
    handleFullscreenButtonClick,
    handleScrollMiniControlsPointerMove,
    handleScrollMiniDragPointerDown,
    handleScrollMiniPlayerEnter,
    handleScrollMiniPlayerLeave,
    handleScrollMiniPlayPauseMouseEnter,
    handleScrollMiniResizePointerDown,
    handleScrollMiniVolumeMouseEnter,
    handleScrollMiniVolumeMouseLeave,
    handleScrollMiniVolumePointerDown,
    handleScrollMiniWindowResize,
    handleScrollMiniWindowScroll,
    isNativeFullscreenActive,
    rememberInlinePlayerLayoutHeight,
    repairScrollMiniPlaceholderHeight,
    scrollMiniAnchor,
    scrollMiniDragHandleOnLightBg,
    scrollMiniIsPaused,
    scrollMiniPlaceholder,
    scrollMiniPlaceholderHeight,
    scrollMiniPlayerActive,
    scrollMiniPlayerAnimating,
    scrollMiniPlayerDetached,
    scrollMiniPlayerDismissed,
    scrollMiniPlayerStyle,
    scrollMiniPlayerStashed,
    scrollMiniPlayerStashedSide,
    scrollMiniPlayPauseVisible,
    scrollMiniResizeCorner,
    scrollMiniResizeHandleOnLightBg,
    scrollMiniScrollToTop,
    restoreInlinePlayer,
    scrollMiniTogglePlayPause,
    revealScrollMiniPlayerControls,
    scrollMiniVolume,
    scrollMiniVolumeExpanded,
    scrollMiniVolumeIcon,
    scrollMiniVolumePercent,
    scrollMiniVolumeTrack,
    setupScrollMiniIntersectionObserver,
    showScrollMiniPlayPause,
    suppressScrollMiniPlayPausePointerReveal,
    teardownScrollMiniPlayer,
    togglePlayerFullScreen,
    updateScrollMiniDragHandleContrast,
    updateScrollMiniPlayer,
    updateScrollMiniVideoAspectRatio,
    updateScrollMiniVolume,
  }
}
