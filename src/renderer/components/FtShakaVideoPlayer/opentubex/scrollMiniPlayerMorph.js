/**
 * Measures and renders the morph between the inline player and the mobile mini
 * bar. The first frame fixes both layout boxes at a base geometry, later frames
 * only update transforms, clipping and opacity.
 *
 * @param {{
 *   container: import('vue').Ref<HTMLDivElement | null>,
 *   video: import('vue').Ref<HTMLVideoElement | null>,
 *   mobileMiniBarOverlay: import('vue').Ref<HTMLDivElement | null>,
 *   scrollMiniPlaceholder: import('vue').Ref<HTMLElement | null>,
 *   inlineSixteenByNine: import('vue').ComputedRef<boolean>,
 *   getMobileMiniBarRect: (revealSideNav?: boolean) => { left: number, top: number, width: number, height: number }
 * }} options
 */
export function createMobileMiniMorph({ container, video, mobileMiniBarOverlay, scrollMiniPlaceholder, inlineSixteenByNine, getMobileMiniBarRect }) {
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

  let mobileMiniMorphBase = null

  function renderMobileMiniMorph(from, to, videoFrom, videoTo, progress, restoring) {
    const element = container.value
    if (!element) return
    const visibleArtwork = element.querySelector('.musicAudioArtwork.retryImagePlaceholder') ?? element.querySelector('.musicAudioArtwork')
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
      const artwork = visibleArtwork
      if (artwork && !artwork.hidden) {
        const bounds = artwork.getBoundingClientRect()
        const surface = artwork.closest('.musicAudioSurface').getBoundingClientRect()
        mobileMiniMorphBase.artwork = {
          element: artwork,
          left: bounds.left - surface.left,
          top: bounds.top - surface.top,
          width: bounds.width,
          height: bounds.height,
          radius: Number.parseFloat(getComputedStyle(artwork).borderTopLeftRadius) || 0
        }
        const morph = mobileMiniMorphBase
        // Capture runs before FtRetryImage handles load. Redraw next frame,
        // after Vue replaces the fallback, even when the finger is held still.
        morph.onImageLoad = () => {
          if (morph.imageLoadFrame != null) cancelAnimationFrame(morph.imageLoadFrame)
          morph.imageLoadFrame = requestAnimationFrame(() => {
            morph.imageLoadFrame = null
            if (mobileMiniMorphBase === morph) morph.redraw()
          })
        }
        element.addEventListener('load', morph.onImageLoad, true)
      }
    }
    mobileMiniMorphBase.redraw = () => renderMobileMiniMorph(from, to, videoFrom, videoTo, progress, restoring)
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
      const poster = surface.classList.contains('countdownPoster')
        ? surface.querySelector('.retryImagePlaceholder') ?? surface.querySelector('img')
        : null
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
    if (artwork && visibleArtwork && !visibleArtwork.hidden) {
      if (artwork.element !== visibleArtwork) {
        artwork.element.style.removeProperty('transform')
        artwork.element.style.removeProperty('border-radius')
        artwork.element = visibleArtwork
      }
      const aspect = visibleArtwork.naturalWidth / visibleArtwork.naturalHeight || 1
      const width = Math.min(artwork.width, artwork.height * aspect)
      const height = width / aspect
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
    if (mobileMiniMorphBase?.onImageLoad) element.removeEventListener('load', mobileMiniMorphBase.onImageLoad, true)
    if (mobileMiniMorphBase?.imageLoadFrame != null) cancelAnimationFrame(mobileMiniMorphBase.imageLoadFrame)
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

  return {
    measureMobileMiniBar,
    measureInlinePlayer,
    renderMobileMiniMorph,
    clearMobileMiniMorph,
  }
}
