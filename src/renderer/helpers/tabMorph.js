import { nextTick } from 'vue'
import { applyAnimationSpeed } from './animationSpeed.js'
import { isReducedMotionEnabled } from './reducedMotion.js'

const MORPH_DURATION_MS = 320
const TAB_ICON_SIZE_PX = 16
const TAB_WAIT_TIMEOUT_MS = 1000

/**
 * @typedef {object} TabMorphSnapshot
 * @property {string} src
 * @property {DOMRect} from
 * @property {string} fromBorderRadius
 */

/**
 * Capture the thumbnail's on-screen geometry before a new tab is created.
 * Must run while the source tab is still presented: activating the new tab
 * hides the old content (`v-show`), which would zero out the rect.
 *
 * @param {EventTarget | null | undefined} sourceEl clicked link or thumbnail
 * @returns {TabMorphSnapshot | null}
 */
export function captureTabMorphSnapshot(sourceEl) {
  if (!process.env.IS_ELECTRON || isReducedMotionEnabled()) {
    return null
  }

  const thumbnail = findThumbnailImage(sourceEl)
  if (!(thumbnail instanceof HTMLImageElement)) {
    return null
  }

  const src = thumbnail.currentSrc || thumbnail.src
  if (!src) {
    return null
  }

  const from = thumbnail.getBoundingClientRect()
  if (from.width < 1 || from.height < 1) {
    return null
  }

  return {
    src,
    from: DOMRect.fromRect(from),
    fromBorderRadius: getComputedStyle(thumbnail).borderRadius || '0px'
  }
}

/**
 * Morph a previously captured video thumbnail into the new tab's icon slot.
 *
 * @param {TabMorphSnapshot | null | undefined} snapshot
 * @param {string} tabId id of the tab that was just created
 * @returns {Promise<void>}
 */
export async function morphThumbnailIntoTab(snapshot, tabId) {
  if (!snapshot || typeof tabId !== 'string' || tabId.length === 0) {
    return
  }

  const { src, from, fromBorderRadius } = snapshot

  const tabEl = await waitForTabElement(tabId)
  if (!tabEl) {
    return
  }

  tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  await nextTick()
  await waitForAnimationFrame()

  // Re-measure after scroll / layout settling
  const { rect: to, borderRadius: toBorderRadius, hideEl } = resolveTabMorphTarget(tabEl)
  if (to.width < 1 || to.height < 1) {
    return
  }

  const clone = document.createElement('img')
  clone.src = src
  clone.alt = ''
  clone.className = 'tabThumbnailMorph'
  clone.draggable = false
  Object.assign(clone.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    borderRadius: fromBorderRadius
  })
  document.body.appendChild(clone)

  if (hideEl) {
    hideEl.style.visibility = 'hidden'
  }

  const animation = applyAnimationSpeed(clone.animate([
    {
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
      borderRadius: fromBorderRadius,
      opacity: 1
    },
    {
      left: `${to.left}px`,
      top: `${to.top}px`,
      width: `${to.width}px`,
      height: `${to.height}px`,
      borderRadius: toBorderRadius,
      opacity: 1
    }
  ], {
    duration: MORPH_DURATION_MS,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    fill: 'forwards'
  }))

  try {
    await animation.finished
  } catch {
    // Animation was cancelled (e.g. document torn down)
  }

  clone.remove()
  if (hideEl) {
    hideEl.style.visibility = ''
  }
}

/**
 * @param {EventTarget | null | undefined} sourceEl
 * @returns {HTMLImageElement | null}
 */
function findThumbnailImage(sourceEl) {
  if (!(sourceEl instanceof HTMLElement)) {
    return null
  }

  if (sourceEl.classList.contains('thumbnailImage') && sourceEl instanceof HTMLImageElement) {
    return sourceEl
  }

  const nested = sourceEl.querySelector('.thumbnailImage')
  if (nested instanceof HTMLImageElement) {
    return nested
  }

  const inCard = sourceEl.closest('.ft-list-video, .ft-list-item')?.querySelector('.thumbnailImage')
  return inCard instanceof HTMLImageElement ? inCard : null
}

/**
 * @param {string} tabId
 * @returns {Promise<HTMLElement | null>}
 */
function waitForTabElement(tabId) {
  const selector = `.tab[data-tab-id="${CSS.escape(tabId)}"]`
  const existing = document.querySelector(selector)
  if (existing instanceof HTMLElement) {
    return Promise.resolve(existing)
  }

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      observer.disconnect()
      const late = document.querySelector(selector)
      resolve(late instanceof HTMLElement ? late : null)
    }, TAB_WAIT_TIMEOUT_MS)

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el instanceof HTMLElement) {
        window.clearTimeout(timeoutId)
        observer.disconnect()
        resolve(el)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })
  })
}

/**
 * Prefer the real tab icon when present; otherwise aim at a 16×16 circle in the
 * icon slot so the morph still lands cleanly while the loading dot is showing.
 *
 * @param {HTMLElement} tabEl
 * @returns {{ rect: DOMRect, borderRadius: string, hideEl: HTMLElement | null }}
 */
function resolveTabMorphTarget(tabEl) {
  const avatar = tabEl.querySelector('.tabAvatar')
  if (avatar instanceof HTMLElement) {
    return {
      rect: avatar.getBoundingClientRect(),
      borderRadius: '50%',
      hideEl: avatar
    }
  }

  const title = tabEl.querySelector('.tabTitle')
  const anchor = (title instanceof HTMLElement ? title : tabEl).getBoundingClientRect()
  const size = TAB_ICON_SIZE_PX
  const top = anchor.top + (anchor.height - size) / 2
  const isRtl = getComputedStyle(tabEl).direction === 'rtl'
  const left = isRtl ? anchor.right - size : anchor.left
  const icon = tabEl.querySelector('.loadingDot, .playingIcon, .tabPageIcon')

  return {
    rect: new DOMRect(left, top, size, size),
    borderRadius: '50%',
    hideEl: icon instanceof HTMLElement ? icon : null
  }
}

/**
 * @returns {Promise<void>}
 */
function waitForAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}
