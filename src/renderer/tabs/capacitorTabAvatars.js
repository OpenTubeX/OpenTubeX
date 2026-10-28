import { shallowReactive, watch } from 'vue'
import { connectionEvents } from '../helpers/networkRecovery.js'
import {
  readStoredTabImages,
  removeStoredTabImage,
  writeStoredTabImage
} from './capacitorTabImageStorage.js'

const AVATAR_PREFIX = 'avatar-'
// Large enough for the avatar in a phone tab card on a high-density screen.
const AVATAR_SIZE = 176

/** @type {Map<string, { source: string, image: string }>} */
const avatars = shallowReactive(new Map())
const attempted = new Map()
// Bumped on every clear, so a slow disk read cannot bring cleared avatars back.
let discardRevision = 0

/**
 * Channel tabs share their channel's avatar; watch tabs use their creator's.
 * @param {string | undefined} path
 * @returns {string | null}
 */
function getAvatarKey(path) {
  const [, type, id] = path?.match(/^\/(channel|watch)\/([\w-]+)/) ?? []
  if (!type) return null
  return `${type === 'channel' ? 'channel' : 'video'}-${id}`
}

function getRemoteAvatarUrl(getters, key) {
  const separator = key.indexOf('-')
  const id = key.slice(separator + 1)
  const url = key.slice(0, separator) === 'channel' ? getters.getChannelThumbnail(id) : getters.getVideoAvatar(id)
  return url?.startsWith('//') ? `https:${url}` : url
}

/**
 * The stored avatar of a channel or watch tab, available offline and after restarts.
 * @param {{ route?: { path?: string } }} tab
 * @returns {string | null}
 */
export function getCapacitorTabAvatar(tab) {
  const key = getAvatarKey(tab?.route?.path)
  return key ? avatars.get(key)?.image ?? null : null
}

export function clearCapacitorTabAvatars() {
  // Pending downloads are discarded; open tabs refill the cache as they are used.
  discardRevision += 1
  avatars.clear()
  attempted.clear()
}

async function fetchAvatarDataUrl(source, getters) {
  const { fetchCapacitorAvatarDataUrl } = await import('../helpers/api/capacitor-http')
  return fetchCapacitorAvatarDataUrl(
    source,
    getters.getCurrentInvidiousInstanceUrl,
    getters.getCurrentInvidiousInstanceAuthorization
  )
}

async function shrinkAvatar(dataUrl) {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  const scale = Math.min(1, AVATAR_SIZE / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/**
 * Keep a small copy of every open tab's avatar on the device, like the
 * desktop tab image cache, and drop the ones no open tab uses.
 * @param {import('vuex').Store} store
 * @param {Promise<unknown>} tabsReady
 * @param {(source: string, getters: object) => Promise<string | null>} [fetchAvatar]
 */
export function initializeCapacitorTabAvatars(store, tabsReady, fetchAvatar = fetchAvatarDataUrl) {
  if (!process.env.IS_CAPACITOR) return () => {}
  let disposed = false
  let restored = false
  // Downloads that failed, retried once the connection comes back.
  const failed = new Set()

  async function download(key, source) {
    try {
      const dataUrl = await fetchAvatar(source, store.getters)
      if (disposed || attempted.get(key) !== source) return
      if (!dataUrl) {
        failed.add(key)
        return
      }
      const entry = { source, image: await shrinkAvatar(dataUrl) }
      if (disposed || attempted.get(key) !== source) return
      avatars.set(key, entry)
      writeStoredTabImage(AVATAR_PREFIX + key, entry)
    } catch (error) {
      if (!disposed && attempted.get(key) === source) failed.add(key)
      console.warn('Failed to cache mobile tab avatar:', error)
    }
  }

  function retryFailed({ detail }) {
    if (detail === 'offline' || failed.size === 0) return
    for (const key of failed) attempted.delete(key)
    failed.clear()
    sync()
  }

  function sync() {
    if (!restored) return
    const keys = new Set(store.getters.getTabs.map(tab => getAvatarKey(tab.route?.path)).filter(Boolean))
    for (const key of attempted.keys()) {
      if (!keys.has(key)) attempted.delete(key)
    }
    for (const key of avatars.keys()) {
      if (keys.has(key)) continue
      avatars.delete(key)
      removeStoredTabImage(AVATAR_PREFIX + key)
    }
    for (const key of keys) {
      const source = getRemoteAvatarUrl(store.getters, key)
      // Refresh when the page reports a new picture; try each source once.
      if (!source?.startsWith('https:') || avatars.get(key)?.source === source || attempted.get(key) === source) continue
      attempted.set(key, source)
      download(key, source)
    }
  }

  // Switching tabs counts as use, so avatars cleared from Storage settings return.
  const stop = watch(() => [store.getters.getPresentedTabId, ...store.getters.getTabs.map(tab => {
    const key = getAvatarKey(tab.route?.path)
    return key && `${key}:${getRemoteAvatarUrl(store.getters, key)}`
  })].join('\n'), sync)

  const restoreRevision = discardRevision
  Promise.all([readStoredTabImages(AVATAR_PREFIX), tabsReady]).then(([stored]) => {
    if (disposed || restoreRevision !== discardRevision) return
    for (const [name, { source, image }] of stored) {
      const key = name.slice(AVATAR_PREFIX.length)
      if (!avatars.has(key) && typeof source === 'string') avatars.set(key, { source, image })
    }
  }).catch(error => console.warn('Failed to restore mobile tab avatars:', error)).finally(() => {
    if (disposed) return
    restored = true
    sync()
  })

  connectionEvents.addEventListener('change', retryFailed)

  return () => {
    disposed = true
    connectionEvents.removeEventListener('change', retryFailed)
    stop()
  }
}
