import { nextTick } from 'vue'

export const VIDEO_MORPH_NAME = 'video-morph'

/** @type {HTMLElement | null} */
let morphSourceElement = null
let navigationRequestedAt = 0

/**
 * Request that the next router navigation runs inside a View Transition,
 * morphing the clicked thumbnail into the watch page's player area.
 * No-op when the browser doesn't support the View Transitions API.
 *
 * @param {EventTarget | null} linkElement the clicked watch page link
 */
export function requestWatchPageViewTransition(linkElement) {
  if (typeof document.startViewTransition !== 'function') {
    return
  }

  navigationRequestedAt = Date.now()

  if (!(linkElement instanceof HTMLElement)) {
    return
  }

  const thumbnail = linkElement.querySelector('.thumbnailImage')

  // Only name the thumbnail when nothing else on the page carries the name
  // (e.g. the current watch page's player), as duplicate view-transition-names
  // would abort the transition. Players in hidden background tabs don't count
  // because display: none elements aren't captured.
  const hasVisiblePlayer = Array.from(document.querySelectorAll('.videoPlayer'))
    .some((el) => el.offsetParent !== null)

  if (thumbnail instanceof HTMLElement && !hasVisiblePlayer) {
    morphSourceElement = thumbnail
    thumbnail.style.viewTransitionName = VIDEO_MORPH_NAME
  }
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

    return new Promise((resolve) => {
      // Names the watch page's player for the duration of the transition
      // (a permanent name would force a stacking context on the player,
      // breaking its full-window mode)
      document.documentElement.classList.add('viewTransitionMorphActive')

      const transition = document.startViewTransition(() => {
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
        document.documentElement.classList.remove('viewTransitionMorphActive')
        if (source) {
          source.style.viewTransitionName = ''
        }
      })
    })
  })
}

function cleanupMorphSource() {
  if (morphSourceElement) {
    morphSourceElement.style.viewTransitionName = ''
    morphSourceElement = null
  }
}
