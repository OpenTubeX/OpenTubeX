/**
 * @typedef {{ begin: () => boolean, update: (progress: number) => void,
 *   finish: (commit: boolean) => Promise<void>, cancel: () => void }} AndroidBackPreview
 */

/** @type {Map<string, AndroidBackPreview>} */
const players = new Map()
/** @type {WeakMap<HTMLDialogElement, AndroidBackPreview>} */
const sheets = new WeakMap()

/** Finish from the held position; reversing at zero would replay from the end.
 * @param {Animation} animation
 * @param {boolean} commit
 */
export async function settleAndroidBackAnimation(animation, commit) {
  if (!commit && animation.currentTime === 0) return
  if (commit) animation.play()
  else animation.reverse()
  await animation.finished.catch(() => {})
}

/**
 * @param {HTMLDialogElement} element
 * @param {AndroidBackPreview} preview
 */
export function registerAndroidBackSheet(element, preview) {
  sheets.set(element, preview)
  return () => {
    if (sheets.get(element) === preview) sheets.delete(element)
  }
}

/** @param {HTMLDialogElement} element */
export function getAndroidBackSheet(element) {
  return sheets.get(element) ?? null
}

/**
 * @param {string} tabId
 * @param {AndroidBackPreview} preview
 */
export function registerAndroidBackPlayer(tabId, preview) {
  players.set(tabId, preview)
  return () => {
    if (players.get(tabId) === preview) players.delete(tabId)
  }
}

/** @param {string} tabId */
export function getAndroidBackPlayer(tabId) {
  return players.get(tabId) ?? null
}

/**
 * Keep the selected action for the whole gesture. Cancel never invokes Back;
 * button navigation (a commit without a start) uses the normal handler.
 * @param {{ getPreview: () => AndroidBackPreview | null, back: () => Promise<void> }} options
 */
export function createAndroidBackGestureHandler({ getPreview, back }) {
  let preview = null
  let finishing = false
  let disposed = false
  return {
    async handle({ phase, progress = 0 }) {
      if (disposed || finishing) return
      if (phase === 'start') {
        preview?.cancel()
        const candidate = getPreview()
        preview = candidate?.begin() ? candidate : null
      } else if (phase === 'progress') {
        preview?.update(Math.max(0, Math.min(1, progress)))
      } else if (phase === 'commit' || phase === 'cancel') {
        finishing = true
        const current = preview
        try {
          if (current) await current.finish(phase === 'commit')
          else if (phase === 'commit') await back()
        } finally {
          if (preview === current) preview = null
          finishing = false
        }
      }
    },
    dispose() {
      disposed = true
      preview?.cancel()
      preview = null
    }
  }
}
