import { nextTick } from 'vue'

import { isReducedMotionEnabled } from './reducedMotion'

export const VIDEO_MORPH_NAME = 'video-morph'

/** @type {HTMLElement | null} */
let morphSourceElement = null
let navigationRequestedAt = 0
let shortMorphRequested = false

/**
 * Request that the next router navigation runs inside a View Transition,
 * morphing the clicked thumbnail into the watch page's player area.
 * No-op when the browser doesn't support the View Transitions API.
 *
 * @param {EventTarget | null} linkElement the clicked watch page link
 * @param {object} [options]
 * @param {boolean} [options.isShort] whether the destination uses the Shorts layout
 * @param {boolean} [options.allowVisiblePlayer] whether the source can be beside the current player
 */
export function requestWatchPageViewTransition(linkElement, { isShort, allowVisiblePlayer = false } = {}) {
  if (typeof document.startViewTransition !== 'function' || isReducedMotionEnabled()) {
    return
  }

  navigationRequestedAt = Date.now()
  const link = linkElement instanceof HTMLElement
    ? linkElement.closest('a')
    : null
  const href = link?.getAttribute('href') ?? ''
  shortMorphRequested = typeof isShort === 'boolean'
    ? isShort
    : href.includes('short=true') || href.includes('/shorts/')

  if (!(linkElement instanceof HTMLElement)) {
    return
  }

  const thumbnail = findThumbnail(linkElement)

  // Players in hidden background tabs don't count because display: none
  // elements aren't captured. Recommendations explicitly allow a visible
  // player: its name is assigned only after the old thumbnail snapshot.
  const hasVisiblePlayer = Array.from(document.querySelectorAll('.videoPlayer'))
    .some((el) => el.offsetParent !== null)

  if (thumbnail instanceof HTMLElement && (!hasVisiblePlayer || allowVisiblePlayer)) {
    morphSourceElement = thumbnail
    thumbnail.style.viewTransitionName = VIDEO_MORPH_NAME
  }
}

/**
 * Morph a clicked video thumbnail into a newly created background tab.
 *
 * @param {EventTarget | null} linkElement the clicked watch page link
 * @param {() => Promise<{ id?: string } | null>} createTab creates the background tab
 */
export async function morphThumbnailIntoNewTab(linkElement, createTab) {
  const thumbnail = !isReducedMotionEnabled() && linkElement instanceof HTMLElement
    ? findThumbnail(linkElement)
    : null
  const source = thumbnail?.getBoundingClientRect()
  // Capture only the source geometry. Document View Transitions delay creation
  // until the old snapshot and freeze rendering while the new tab mounts.
  const tab = await createTab()
  if (!source?.width || !source.height || !tab?.id) return

  await nextTick()
  const target = document.querySelector(`.tab[data-tab-id="${CSS.escape(tab.id)}"]`)
  const destination = target?.getBoundingClientRect()
  if (!destination?.width || !destination.height) return

  const image = thumbnail.cloneNode(false)
  image.removeAttribute('id')
  image.removeAttribute('srcset')
  image.src = thumbnail.currentSrc || thumbnail.src
  image.alt = ''
  image.setAttribute('aria-hidden', 'true')
  image.className = 'newTabThumbnailMorph'
  Object.assign(image.style, {
    left: `${source.x}px`,
    top: `${source.y}px`,
    width: `${source.width}px`,
    height: `${source.height}px`
  })
  document.body.append(image)
  const animation = image.animate([
    { transform: 'none', opacity: 1 },
    {
      transform: `translate(${destination.x - source.x}px, ${destination.y - source.y}px) scale(${destination.width / source.width}, ${destination.height / source.height})`,
      opacity: 0
    }
  ], { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' })
  animation.finished.then(() => image.remove(), () => image.remove())
}

/**
 * Wrap navigations that were requested via {@linkcode requestWatchPageViewTransition}
 * in a View Transition. All other navigations are left untouched.
 *
 * @param {import('vue-router').Router} router
 */
export function installViewTransitions(router) {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') {
    return
  }

  router.beforeResolve(() => {
    // Ignore stale requests from clicks whose navigation was cancelled
    if (navigationRequestedAt === 0 || Date.now() - navigationRequestedAt > 1000) {
      cleanupMorphSource()
      return
    }

    navigationRequestedAt = 0
    const source = morphSourceElement
    morphSourceElement = null
    const shortMorph = shortMorphRequested
    shortMorphRequested = false

    return new Promise((resolve) => {
      const transition = document.startViewTransition(() => {
        // The old snapshot has been captured, so the thumbnail can give its
        // name to the destination player. This matters for watch-to-watch
        // navigation where both elements remain mounted during the update.
        if (source) {
          source.style.viewTransitionName = ''
        }
        document.documentElement.classList.add('viewTransitionMorphActive')
        document.documentElement.classList.toggle('viewTransitionShortMorphActive', shortMorph)

        return new Promise((_resolve) => {
          // Let the navigation proceed, then wait for the new view to render
          const stop = router.afterEach(() => {
            stop()
            nextTick(_resolve)
          })
          resolve()
        })
      })

      transition.finished.finally(() => {
        document.documentElement.classList.remove(
          'viewTransitionMorphActive',
          'viewTransitionShortMorphActive'
        )
        if (source) {
          source.style.viewTransitionName = ''
        }
      })
    })
  })
}

/**
 * Run a logical-tab navigation inside the pending thumbnail view transition.
 * Electron renders tab content from store state before synchronising Vue Router,
 * so its transition has to wrap that state update rather than a router guard.
 *
 * @param {() => Promise<void> | void} update
 * @returns {Promise<void>}
 */
export async function runPendingViewTransition(update) {
  const runTransition = takePendingViewTransition()
  await runTransition(update)
}

export function hasPendingViewTransition(maxAge = 1000) {
  return typeof document !== 'undefined' &&
    typeof document.startViewTransition === 'function' &&
    !isReducedMotionEnabled() &&
    navigationRequestedAt !== 0 &&
    Date.now() - navigationRequestedAt <= maxAge
}

/**
 * Consume a pending thumbnail morph immediately and return a function that can
 * start it after slower navigation preparation has completed.
 *
 * @param {number} [maxAge=1000] maximum age of the pending request in milliseconds
 * @returns {((update: () => Promise<void> | void) => Promise<void>) & { cancel: () => void }}
 */
export function takePendingViewTransition(maxAge = 1000) {
  if (!hasPendingViewTransition(maxAge)) {
    cleanupMorphSource()
    const runWithoutTransition = async (update) => await update()
    runWithoutTransition.cancel = () => {}
    return runWithoutTransition
  }

  navigationRequestedAt = 0
  const source = morphSourceElement
  morphSourceElement = null
  const shortMorph = shortMorphRequested
  shortMorphRequested = false
  let started = false
  const runTransition = async (update) => {
    started = true

    const cleanup = () => {
      document.documentElement.classList.remove(
        'viewTransitionMorphActive',
        'viewTransitionShortMorphActive'
      )
      if (source) {
        source.style.viewTransitionName = ''
      }
    }

    let transition
    try {
      transition = document.startViewTransition(async () => {
        // The source must lose the shared name before the new snapshot. On a
        // watch page the recommendations stay mounted while the player updates.
        if (source) {
          source.style.viewTransitionName = ''
        }
        document.documentElement.classList.add('viewTransitionMorphActive')
        document.documentElement.classList.toggle('viewTransitionShortMorphActive', shortMorph)

        await update()
        await nextTick()
      })
    } catch (error) {
      cleanup()
      throw error
    }

    transition.finished.then(cleanup, cleanup)
    await transition.updateCallbackDone
  }
  runTransition.cancel = () => {
    if (!started && source) {
      source.style.viewTransitionName = ''
    }
  }
  return runTransition
}

function cleanupMorphSource() {
  navigationRequestedAt = 0
  shortMorphRequested = false
  if (morphSourceElement) {
    morphSourceElement.style.viewTransitionName = ''
    morphSourceElement = null
  }
}

function findThumbnail(linkElement) {
  return linkElement.querySelector('.thumbnailImage') ??
    linkElement.closest('.ft-list-video')?.querySelector('.thumbnailImage')
}
