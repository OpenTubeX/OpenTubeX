// Decrypted collections are cached only for this renderer session. A new account,
// key, or token starts with an empty cache; snapshots remain merge baselines.
export class SyncCollectionCache {
  constructor() {
    this.identity = ''
    this.collections = new Map()
    this.syncedRevisions = new Map()
  }

  use(identity) {
    if (identity !== this.identity) {
      this.identity = identity
      this.collections.clear()
      this.syncedRevisions.clear()
    }
  }

  isSynced(collection, revision) {
    return this.syncedRevisions.get(collection) === revision
  }

  markSynced(collections) {
    for (const collection of collections) {
      this.syncedRevisions.set(collection, this.collections.get(collection).revision)
    }
  }

  get(collection, revision) {
    const cached = this.collections.get(collection)
    return cached && cached.revision === revision ? structuredClone(cached) : null
  }

  put(collection, revision, data) {
    this.collections.set(collection, { revision, data: structuredClone(data) })
  }
}

const NOISY_ACTIVITY_SETTINGS = new Set([
  'channelPlaybackSpeeds', 'channelVolumes', 'channelSubtitlesStates', 'channelVideoQualities',
  'playlistReverseStates', 'sponsorBlockDraftSegmentsByVideoId',
])

export function createSyncActivity(collection, before, after, deviceId, deviceName) {
  if (['history', 'seenVideos', 'seenPosts', 'sessions', 'sessionsV2'].includes(collection)) return null
  const changes = []
  if (collection === 'settings') {
    const previous = new Map((before ?? []).map(entry => [entry.key, entry.value]))
    for (const entry of after ?? []) {
      // The first upload establishes a baseline, rather than hundreds of actions.
      if (NOISY_ACTIVITY_SETTINGS.has(entry.key) || !previous.has(entry.key) ||
          JSON.stringify(previous.get(entry.key)) === JSON.stringify(entry.value)) continue
      const value = entry.value
      // Large JSON-backed settings get an update entry rather than filling the
      // activity feed with configuration data or exceeding its payload limit.
      const summaryOnly = typeof value === 'object' ||
        (typeof value === 'string' && new TextEncoder().encode(value).length > 128)
      changes.push({ key: entry.key, value: summaryOnly ? null : value })
    }
  } else if (['subscriptions', 'playlists', 'profiles', 'playlistBookmarks'].includes(collection) &&
      JSON.stringify(before) !== JSON.stringify(after)) {
    changes.push({ collection })
  }
  return changes.length ? { version: 1, type: 'activity', deviceId, deviceName, changes } : null
}

export function validateDeviceRequest(value, recipient, now = Date.now()) {
  return value?.version === 1 && value.type === 'openVideo' && value.recipient === recipient &&
    typeof value.videoId === 'string' && /^[\w-]{11}$/.test(value.videoId) &&
    typeof value.title === 'string' && value.title.length <= 500 &&
    Number.isSafeInteger(value.expiresAt) && value.expiresAt > now &&
    // Allow ordinary device clock skew; the server also enforces its own 24-hour TTL.
    value.expiresAt <= now + (24 * 60 + 5) * 60 * 1000 &&
    Number.isFinite(value.position) && value.position >= 0 && value.position <= 7 * 24 * 60 * 60
}

// A held Web Lock shares connection health across renderer tabs and disappears
// automatically if its owner closes. Without Web Locks there is one local owner.
export class SyncLiveConnectionState {
  constructor(locks) {
    this.locks = locks
    this.connected = false
    this.controller = null
  }

  setConnected(connected) {
    if (this.connected === connected) return
    this.connected = connected
    this.controller?.abort()
    this.controller = null
    if (!connected || !this.locks) return
    const controller = new AbortController()
    this.controller = controller
    this.locks.request('opentubex-sync-server-live-connected', { signal: controller.signal }, () => {
      return new Promise(resolve => {
        if (controller.signal.aborted) resolve()
        else controller.signal.addEventListener('abort', () => resolve(), { once: true })
      })
    }).catch(() => {})
  }

  async isConnected() {
    if (!this.locks) return this.connected
    try {
      const { held } = await this.locks.query()
      return held.some(lock => lock.name === 'opentubex-sync-server-live-connected')
    } catch {
      // If health cannot be shared, keep the periodic fallback running.
      return false
    }
  }
}

// Long polling uses the same authenticated, cancellable HTTP transport on
// desktop and Android. The durable server cursor handles missed notifications.
export async function watchSyncChanges(client, onChange, onError, {
  prepare = async () => true,
  onConnectionChange = () => {},
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  let prepared = false
  let cursor = ''
  let retryMs = 1000
  try {
    while (!client.cancelled) {
      try {
        if (!prepared) {
          if (!await prepare() || client.cancelled) return
          prepared = true
        }
        const response = await client.waitForSyncChanges(cursor)
        if (client.cancelled) return
        if (typeof response?.cursor !== 'string' || !response.cursor) throw new Error('Invalid sync change cursor')
        if (response.cursor !== cursor) {
          await onChange()
          // Advance only after successful processing; failures retry the same change.
          cursor = response.cursor
        }
        onConnectionChange(true)
        retryMs = 1000
      } catch (error) {
        onConnectionChange(false)
        if (client.cancelled) return
        if (await onError(error) === false) return
        await sleep(retryMs)
        retryMs = Math.min(retryMs * 2, 30000)
      }
    }
  } finally {
    onConnectionChange(false)
  }
}
