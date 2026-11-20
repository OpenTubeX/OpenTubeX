// @ts-check

/**
 * Titles that watch and channel pages load, for a pasted link's search history
 * entry. That page loads the video or channel anyway, so requesting it again
 * for the title would double the requests and their fallback warnings.
 * @type {Map<string, Set<(title: string) => void>>}
 */
const waiting = new Map()

/**
 * Recently reported titles, because opening a page that is already open does
 * not load it again.
 * @type {Map<string, string>}
 */
const recentTitles = new Map()
const MAX_RECENT_TITLES = 50

/**
 * @param {string} key `video:<id>` or `channel:<url>`
 * @param {string} title
 */
export function reportLoadedPageTitle(key, title) {
  if (typeof title !== 'string' || title.trim() === '') return
  recentTitles.delete(key)
  recentTitles.set(key, title)
  if (recentTitles.size > MAX_RECENT_TITLES) {
    const [oldestKey] = recentTitles.keys()
    recentTitles.delete(oldestKey)
  }

  const resolvers = waiting.get(key)
  if (resolvers == null) return
  waiting.delete(key)
  resolvers.forEach(resolve => resolve(title))
}

/**
 * @param {string} key `video:<id>` or `channel:<url>`
 * @param {AbortSignal} signal
 * @returns {Promise<string | undefined>} the title, or undefined when the signal aborts first
 */
export function waitForLoadedPageTitle(key, signal) {
  const recentTitle = recentTitles.get(key)
  if (recentTitle !== undefined) return Promise.resolve(recentTitle)

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
