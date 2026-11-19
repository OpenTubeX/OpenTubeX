// @ts-check

/**
 * Titles that watch and channel pages load, for a pasted link's search history
 * entry. That page loads the video or channel anyway, so requesting it again
 * for the title would double the requests and their fallback warnings.
 * @type {Map<string, Set<(title: string) => void>>}
 */
const waiting = new Map()

/**
 * @param {string} key `video:<id>` or `channel:<url>`
 * @param {string} title
 */
export function reportLoadedPageTitle(key, title) {
  const resolvers = waiting.get(key)
  if (resolvers == null || typeof title !== 'string' || title.trim() === '') return
  waiting.delete(key)
  resolvers.forEach(resolve => resolve(title))
}

/**
 * @param {string} key `video:<id>` or `channel:<url>`
 * @param {AbortSignal} signal
 * @returns {Promise<string | undefined>} the title, or undefined when the signal aborts first
 */
export function waitForLoadedPageTitle(key, signal) {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve(undefined)
      return
    }
    const resolvers = waiting.get(key) ?? new Set()
    waiting.set(key, resolvers)
    const onTitle = (/** @type {string} */ title) => {
      signal.removeEventListener('abort', onAbort)
      resolve(title)
    }
    const onAbort = () => {
      resolvers.delete(onTitle)
      if (resolvers.size === 0 && waiting.get(key) === resolvers) waiting.delete(key)
      resolve(undefined)
    }
    resolvers.add(onTitle)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
