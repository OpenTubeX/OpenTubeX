import { mapConcurrently } from './concurrent-map.js'

const CHANNEL_ID_PATTERN = /^UC[\w-]{22}$/
const HANDLE_RESOLUTION_CONCURRENCY = 4

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Reads the values stored by the "Youtube Speed By Channel" userscript.
 * It saves each channel's speed under both the channel's handle and its name,
 * next to its own settings, which are prefixed with `_YSC-`.
 * Tampermonkey nests the values in `data` when exporting a script's storage.
 * @param {unknown} json
 * @returns {{ key: string, speed: number }[]}
 */
export function parseSpeedByChannelValues(json) {
  const values = isObject(json) && isObject(json.data) ? json.data : json
  if (!isObject(values)) return []

  return Object.entries(values)
    .filter(([key, speed]) => (
      !key.startsWith('_YSC-') &&
      key.trim() !== '' &&
      typeof speed === 'number' &&
      Number.isFinite(speed) &&
      speed > 0
    ))
    .map(([key, speed]) => ({ key: key.trim(), speed }))
}

/**
 * Maps the userscript's keys to channel IDs. Handles are resolved over the network
 * and win over names, which can only be matched against the subscriptions.
 * Unmatched names are only reported when there are no handles, as newer versions
 * of the userscript save every channel under both.
 * @param {{ key: string, speed: number }[]} entries
 * @param {{
 *   subscriptions: { id: string, name: string }[],
 *   resolveHandle: (handle: string) => Promise<string | null>,
 *   onProgress?: (resolved: number, total: number) => void
 * }} options
 * @returns {Promise<{ speeds: Record<string, number>, notFound: string[] }>}
 */
export async function resolveSpeedByChannelValues(entries, { subscriptions, resolveHandle, onProgress }) {
  /** @type {Record<string, number>} */
  const speeds = {}
  const handles = entries.filter(({ key }) => key.startsWith('@'))
  const names = entries.filter(({ key }) => !key.startsWith('@') && !CHANNEL_ID_PATTERN.test(key))

  for (const { key, speed } of entries) {
    if (CHANNEL_ID_PATTERN.test(key)) speeds[key] = speed
  }

  let resolved = 0
  const handleIds = await mapConcurrently(handles, HANDLE_RESOLUTION_CONCURRENCY, async ({ key }) => {
    let id = null
    try {
      id = await resolveHandle(key)
    } catch (error) {
      console.error(`Failed to resolve ${key}:`, error)
    }
    onProgress?.(++resolved, handles.length)
    return id
  })

  const notFound = []
  handles.forEach(({ key, speed }, index) => {
    const id = handleIds[index]
    if (id === null) {
      notFound.push(key)
    } else {
      speeds[id] ??= speed
    }
  })

  /** @type {Map<string, string | null>} `null` for names shared by several subscriptions */
  const idsByName = new Map()
  for (const { id, name } of subscriptions) {
    const normalizedName = name?.trim().toLowerCase()
    if (!normalizedName) continue
    idsByName.set(normalizedName, idsByName.has(normalizedName) && idsByName.get(normalizedName) !== id ? null : id)
  }

  for (const { key, speed } of names) {
    const id = idsByName.get(key.toLowerCase())
    if (id) {
      speeds[id] ??= speed
    } else if (handles.length === 0) {
      notFound.push(key)
    }
  }

  return { speeds, notFound }
}
