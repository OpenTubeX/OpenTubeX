// @ts-check
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import { createSerialQueue } from './serialQueue.js'
import { writeFileAtomic } from './writeFileAtomic.js'

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
 * It keeps to the work area edges nearest the saved bounds, so a window placed
 * in a corner stays there for a video with another aspect ratio.
 *
 * KWin runs this function as script source, so it must not use anything
 * outside its own body.
 *
 * @param {Rect} saved
 * @param {Rect} current the window as Chromium opened it, which matches the video's aspect ratio
 * @param {Rect[]} workAreas
 * @param {boolean} [keepSize] only move the window, for a size Chromium chose
 * @returns {Rect | null}
 */
export function fitPictureInPictureBounds(saved, current, workAreas, keepSize = false) {
  const overlap = (/** @type {Rect} */ area) =>
    Math.max(0, Math.min(saved.x + saved.width, area.x + area.width) - Math.max(saved.x, area.x)) *
    Math.max(0, Math.min(saved.y + saved.height, area.y + area.height) - Math.max(saved.y, area.y))
  /** @type {Rect | null} */
  let area = null
  for (const candidate of workAreas) {
    if (overlap(candidate) > 0 && (area === null || overlap(candidate) > overlap(area))) area = candidate
  }
  if (area === null || current.width <= 0 || current.height <= 0) return null

  const scale = keepSize
    ? 1
    : Math.min(
        Math.sqrt((saved.width * saved.height) / (current.width * current.height)),
        area.width / current.width,
        area.height / current.height
      )
  const width = Math.round(current.width * scale)
  const height = Math.round(current.height * scale)
  const x = saved.x + saved.width / 2 > area.x + area.width / 2 ? saved.x + saved.width - width : saved.x
  const y = saved.y + saved.height / 2 > area.y + area.height / 2 ? saved.y + saved.height - height : saved.y
  return {
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - height)),
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
  const enqueue = createSerialQueue()
  const settled = () => enqueue(() => {})

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
      if (value === null) return settled()
      loaded = Promise.resolve(value)
      return enqueue(() => writeFileAtomic(file, JSON.stringify(value)))
        .catch(error => console.error('Failed to save the Picture-in-Picture bounds', error))
    },
    settled
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
 * Electron has no API for Chromium's Picture-in-Picture window, so restore the
 * saved bounds each time it shows. Moves raise no event, and closing the window
 * from the system destroys it before the page hears about it, so poll the
 * bounds while it shows. Only save the user's changes: Chromium keeps the
 * aspect ratio while the user resizes the window, and changes it only for a
 * video with another one.
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
  const restoring = new Set()
  /** @type {Map<object, number>} */
  const visible = new Map()
  /** @type {Map<number, Rect>} the bounds each window had when last checked */
  const seen = new Map()
  /** @type {Rect | null} */
  let saved = null
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null

  /** @param {number} handle */
  const read = handle => {
    const bounds = native.getWindowBounds(handle)
    return bounds === null ? null : fromNative(bounds)
  }
  /** @param {number} handle */
  const save = handle => {
    if (restoring.has(handle)) return true
    const value = read(handle)
    if (value === null) {
      seen.delete(handle)
      return false
    }
    const previous = seen.get(handle)
    seen.set(handle, value)
    if (previous === undefined) return true
    const aspectRatio = previous.width / previous.height
    if (Math.abs(value.width / value.height - aspectRatio) > aspectRatio * 0.02) {
      // Chromium resized the window for a video with another aspect ratio
      const moved = saved && fitPictureInPictureBounds(saved, value, getWorkAreas(), true)
      if (moved && native.setWindowBounds(handle, toNative(moved))) seen.set(handle, moved)
    } else if (Object.keys(value).some(key => value[key] !== previous[key])) {
      saved = value
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
      restoring.add(handle)
      try {
        saved = await store.load()
        const current = read(handle)
        if (current !== null) seen.set(handle, current)
        if (saved === null || current === null) return
        const bounds = fitPictureInPictureBounds(saved, current, getWorkAreas())
        // Chromium can change the size it is given right away, such as to its
        // minimum width, so compare later checks with what the window was given
        if (bounds !== null && native.setWindowBounds(handle, toNative(bounds))) seen.set(handle, bounds)
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
      seen.delete(handle)
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
