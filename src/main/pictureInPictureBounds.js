// @ts-check
import { readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

/**
 * @param {unknown} value
 * @returns {Rect | null}
 */
export function normalizePictureInPictureBounds(value) {
  if (value === null || typeof value !== 'object') return null
  const { x, y, width, height } = /** @type {Record<string, unknown>} */ (value)
  if (![x, y, width, height].every(Number.isFinite) || Number(width) <= 0 || Number(height) <= 0) return null
  return { x: Number(x), y: Number(y), width: Number(width), height: Number(height) }
}

/**
 * Returns the bounds to give a new Picture-in-Picture window, or null when the
 * saved ones are no longer on a display. The window keeps the saved area but
 * the current video's aspect ratio, and stays inside the work area it lands on.
 *
 * KWin runs this function as script source, so it must not use anything
 * outside its own body.
 *
 * @param {Rect} saved
 * @param {Rect} current the window as Chromium opened it, which matches the video's aspect ratio
 * @param {Rect[]} workAreas
 * @returns {Rect | null}
 */
export function fitPictureInPictureBounds(saved, current, workAreas) {
  const overlap = (/** @type {Rect} */ area) =>
    Math.max(0, Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x)) *
    Math.max(0, Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y))
  /** @type {Rect | null} */
  let area = null
  for (const candidate of workAreas) {
    if (overlap(candidate) > 0 && (area === null || overlap(candidate) > overlap(area))) area = candidate
  }
  if (area === null || current.width <= 0 || current.height <= 0) return null

  const scale = Math.min(
    Math.sqrt((saved.width * saved.height) / (current.width * current.height)),
    area.width / current.width,
    area.height / current.height
  )
  const width = Math.round(current.width * scale)
  const height = Math.round(current.height * scale)
  return {
    x: Math.round(Math.min(Math.max(saved.x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(saved.y, area.y), area.y + area.height - height)),
    width,
    height
  }
}

/**
 * Keeps the last Picture-in-Picture window bounds on this device. They are not
 * a synced setting, as they depend on the device's displays.
 *
 * @param {string} file
 */
export function createPictureInPictureBoundsStore(file) {
  /** @type {Promise<Rect | null> | null} */
  let loaded = null
  let pending = Promise.resolve()

  const load = () => {
    loaded ??= readFile(file, 'utf8')
      .then(text => normalizePictureInPictureBounds(JSON.parse(text)))
      .catch(error => {
        if (error.code !== 'ENOENT') console.error('Failed to read the Picture-in-Picture bounds', error)
        return null
      })
    return loaded
  }

  return {
    load,
    /** @param {Rect} bounds */
    save: bounds => {
      const value = normalizePictureInPictureBounds(bounds)
      if (value === null) return pending
      loaded = Promise.resolve(value)
      pending = pending.then(async () => {
        await writeFile(file + '.tmp', JSON.stringify(value))
        await rename(file + '.tmp', file)
      }).catch(error => console.error('Failed to save the Picture-in-Picture bounds', error))
      return pending
    }
  }
}

/**
 * @typedef {{
 *   findPictureInPictureWindow: (excluded: Buffer[]) => number | null,
 *   getWindowBounds: (handle: number) => Rect | null,
 *   setWindowBounds: (handle: number, bounds: Rect) => boolean
 * }} NativePictureInPictureWindows
 */

/**
 * Electron has no API for Chromium's Picture-in-Picture window. Chromium keeps
 * its bounds while the window exists, which is as long as the page that opened
 * it, so restore the saved ones once per window. Moves raise no event, and
 * closing the window from the system destroys it before the page hears about
 * it, so poll the bounds while it shows.
 *
 * @param {{
 *   native: NativePictureInPictureWindows,
 *   store: ReturnType<typeof createPictureInPictureBoundsStore>,
 *   getWorkAreas: () => Rect[],
 *   getExcludedHandles: () => Buffer[],
 *   toNative?: (bounds: Rect) => Rect,
 *   fromNative?: (bounds: Rect) => Rect,
 *   pollInterval?: number
 * }} options
 */
export function createNativePictureInPictureBounds({
  native,
  store,
  getWorkAreas,
  getExcludedHandles,
  toNative = bounds => bounds,
  fromNative = bounds => bounds,
  pollInterval = 1000
}) {
  /** @type {Set<number>} */
  const restored = new Set()
  /** @type {Set<number>} */
  const restoring = new Set()
  /** @type {Map<object, number>} */
  const visible = new Map()
  let lastSaved = ''
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null

  /** @param {number} handle */
  const save = handle => {
    if (restoring.has(handle)) return true
    const bounds = native.getWindowBounds(handle)
    if (bounds === null) return false
    const value = fromNative(bounds)
    const key = JSON.stringify(value)
    if (key !== lastSaved) {
      lastSaved = key
      store.save(value)
    }
    return true
  }
  const poll = () => {
    for (const [owner, handle] of visible) {
      if (!save(handle)) visible.delete(owner)
    }
    if (visible.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    /** @param {object} owner the web contents that opened the window */
    shown: async owner => {
      const handle = native.findPictureInPictureWindow(getExcludedHandles())
      if (handle === null) return
      visible.set(owner, handle)
      timer ??= setInterval(poll, pollInterval)
      if (restored.has(handle)) return
      restored.add(handle)
      restoring.add(handle)
      try {
        const saved = await store.load()
        const current = native.getWindowBounds(handle)
        if (saved === null || current === null) return
        const bounds = fitPictureInPictureBounds(saved, fromNative(current), getWorkAreas())
        if (bounds !== null) native.setWindowBounds(handle, toNative(bounds))
      } finally {
        restoring.delete(handle)
      }
    },
    /** @param {object} owner */
    hidden: owner => {
      const handle = visible.get(owner)
      if (handle === undefined) return
      visible.delete(owner)
      save(handle)
      poll()
    }
  }
}

/**
 * @param {string} directory
 * @param {boolean} development
 * @returns {NativePictureInPictureWindows}
 */
export function loadMacosNative(directory, development) {
  const addon = path.resolve(directory, development ? '../../dist/macos_native.node' : 'macos_native.node')
  return createRequire(addon)(addon)
}
