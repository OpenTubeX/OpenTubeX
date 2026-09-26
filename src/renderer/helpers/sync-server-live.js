import { areJsonValuesEqual } from './jsonValues.js'
import { normalizeSubscriptionChannelSettings } from './subscription-channels.js'
import { parseCaptionSettings } from './player/caption-settings.js'

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
// A bounded batch stays below the server's encrypted-event size limit on large imports.
const MAX_ACTIVITY_CHANGES = 64
const MAX_ACTIVITY_TEXT_BYTES = 128

function activityText(value) {
  return typeof value === 'string' && value.length > 0 &&
    new TextEncoder().encode(value).length <= MAX_ACTIVITY_TEXT_BYTES
    ? value
    : null
}

function byId(entries, getId) {
  return new Map((Array.isArray(entries) ? entries : [])
    .map(entry => [getId(entry), entry]).filter(([id]) => typeof id === 'string' && id.length > 0))
}

function addSummary(changes, field, name) {
  if (changes.some(change => change[field] === name && !change.action && !change.detail)) return
  changes.push(field === 'key' ? { key: name, value: null } : { collection: name })
}

function sameItemsReordered(before, after) {
  const oldIds = [...before.keys()]
  const newIds = [...after.keys()]
  return oldIds.length === newIds.length &&
    oldIds.some((id, index) => id !== newIds[index]) &&
    oldIds.every(id => after.has(id))
}

function describeCollectionChanges(collection, before, after, changes, channelNames) {
  const id = collection === 'subscriptions'
    ? entry => entry?.id
    : collection === 'playlistBookmarks'
      ? entry => entry?.playlist?.id
      : entry => entry?.playlist?.id ?? entry?.group?.id
  const oldItems = byId(before, id)
  const newItems = byId(after, id)
  const title = entry => activityText(collection === 'subscriptions'
    ? entry?.name
    : collection === 'playlistBookmarks'
      ? entry?.playlist?.title
      : entry?.playlist?.title ?? entry?.group?.title)
  const add = (action, item, parent) => {
    if (item) changes.push({ collection, action, item, ...(parent ? { parent } : {}) })
    else addSummary(changes, 'collection', collection)
  }

  for (const [itemId, entry] of oldItems) {
    if (!newItems.has(itemId)) add('removed', title(entry))
  }
  for (const [itemId, entry] of newItems) {
    if (!oldItems.has(itemId)) add('added', title(entry))
  }
  for (const [itemId, current] of newItems) {
    const previous = oldItems.get(itemId)
    if (!previous) continue
    const oldTitle = title(previous)
    const newTitle = title(current)
    if (oldTitle !== newTitle && oldTitle && newTitle) {
      changes.push({ collection, action: 'renamed', item: oldTitle, value: newTitle })
    } else if (oldTitle !== newTitle) {
      addSummary(changes, 'collection', collection)
    }
    if (collection === 'playlists') {
      const parent = newTitle
      const oldVideos = byId(previous.videos, video => video?.id)
      const newVideos = byId(current.videos, video => video?.id)
      for (const [videoId, video] of oldVideos) {
        if (!newVideos.has(videoId)) add('removed', activityText(video?.title), parent)
      }
      for (const [videoId, video] of newVideos) {
        if (!oldVideos.has(videoId)) add('added', activityText(video?.title), parent)
      }
      if (previous.playlist?.description !== current.playlist?.description || sameItemsReordered(oldVideos, newVideos)) {
        if (newTitle) changes.push({ collection, action: 'updated', item: newTitle })
        else addSummary(changes, 'collection', collection)
      }
    } else if (collection === 'profiles') {
      const parent = newTitle
      const oldChannels = byId(previous.channels, channel => channel?.id)
      const newChannels = byId(current.channels, channel => channel?.id)
      for (const [channelId, channel] of oldChannels) {
        if (!newChannels.has(channelId)) add('removed', activityText(channel?.name) ?? channelNames.get(channelId), parent)
      }
      for (const [channelId, channel] of newChannels) {
        if (!oldChannels.has(channelId)) add('added', activityText(channel?.name) ?? channelNames.get(channelId), parent)
      }
      if (previous.group?.bg_color !== current.group?.bg_color ||
          previous.group?.text_color !== current.group?.text_color ||
          sameItemsReordered(oldChannels, newChannels)) {
        if (newTitle) changes.push({ collection, action: 'updated', item: newTitle })
        else addSummary(changes, 'collection', collection)
      }
    }
  }
}

const CAPTION_DETAIL_KEYS = {
  textColor: 'Text Color',
  backgroundColor: 'Background Color',
  backgroundOpacity: 'Background Opacity',
  fontScale: 'Font Size',
  verticalPosition: 'Vertical Position',
  anchor: 'Anchor.Anchor',
  edgeStyle: 'Edge Style.Edge Style',
  edgeColor: 'Edge Color',
}

function describeSubscriptionSettings(before, after, changes, channelNames) {
  const oldChannels = before ?? {}
  const currentChannels = after ?? {}
  for (const id of new Set([...Object.keys(oldChannels), ...Object.keys(currentChannels)])) {
    const previous = normalizeSubscriptionChannelSettings(oldChannels[id]?.value)
    const current = normalizeSubscriptionChannelSettings(currentChannels[id]?.value)
    if (areJsonValuesEqual(previous, current)) continue
    const channel = channelNames.get(id)
    if (!channel) { addSummary(changes, 'key', 'subscriptionChannelSettings'); continue }
    for (const detail of ['feedTypes', 'dailyVideoLimit', 'showMembersOnly']) {
      if (areJsonValuesEqual(previous[detail], current[detail])) continue
      const value = detail === 'feedTypes'
        ? current.feedTypes.join(',')
        : detail === 'dailyVideoLimit'
          ? current.dailyVideoLimit === undefined
            ? 'global'
            : current.dailyVideoLimit === null ? 'unlimited' : current.dailyVideoLimit
          : current.showMembersOnly
      changes.push({ key: 'subscriptionChannelSettings', detail, item: channel, value })
    }
  }
}

function describeCaptionSettings(before, after, changes) {
  const previous = parseCaptionSettings(before)
  const current = parseCaptionSettings(after)
  for (const [detail, label] of Object.entries(CAPTION_DETAIL_KEYS)) {
    if (previous[detail] !== current[detail]) {
      changes.push({ key: 'defaultCaptionSettings', detail: label, value: current[detail] })
    }
  }
}

function describeCustomThemes(before, after, changes) {
  const previous = byId(before, theme => theme?.id)
  const current = byId(after, theme => theme?.id)
  const add = (action, name) => {
    if (name) changes.push({ key: 'customThemes', action, item: name })
    else addSummary(changes, 'key', 'customThemes')
  }
  for (const [id, theme] of previous) {
    if (!current.has(id)) add('removed', activityText(theme.name))
  }
  for (const [id, theme] of current) {
    if (!previous.has(id)) add('added', activityText(theme.name))
  }
  for (const [id, theme] of current) {
    const old = previous.get(id)
    if (!old) continue
    const oldName = activityText(old.name)
    const newName = activityText(theme.name)
    if (oldName !== newName && oldName && newName) {
      changes.push({ key: 'customThemes', action: 'renamed', item: oldName, value: newName })
    } else if (oldName !== newName) {
      addSummary(changes, 'key', 'customThemes')
    }
    if (!areJsonValuesEqual({ ...old, name: null }, { ...theme, name: null })) {
      add('updated', newName)
    }
  }
}

function subscriptionPreferences(value) {
  return Object.fromEntries(Object.entries(value ?? {}).flatMap(([id, entry]) => {
    const settings = normalizeSubscriptionChannelSettings(entry.value)
    return areJsonValuesEqual(settings, normalizeSubscriptionChannelSettings()) ? [] : [[id, settings]]
  }))
}

export function createSyncActivity(collection, before, after, deviceId, deviceName, subscriptions = []) {
  if (['history', 'seenVideos', 'seenPosts', 'sessions', 'sessionsV2'].includes(collection)) return null
  const changes = []
  const channelNames = new Map(subscriptions.map(channel => [channel.id, activityText(channel.name)]))
  if (collection === 'settings') {
    const previous = new Map((before ?? []).map(entry => [entry.key, entry.value]))
    for (const entry of after ?? []) {
      // The first upload establishes a baseline, rather than hundreds of actions.
      if (NOISY_ACTIVITY_SETTINGS.has(entry.key) || !previous.has(entry.key) ||
          JSON.stringify(previous.get(entry.key)) === JSON.stringify(entry.value)) continue
      if (entry.key === 'subscriptionChannelSettings' && areJsonValuesEqual(
        subscriptionPreferences(previous.get(entry.key)), subscriptionPreferences(entry.value)
      )) continue
      if (entry.key === 'subscriptionChannelSettings') {
        describeSubscriptionSettings(previous.get(entry.key), entry.value, changes, channelNames)
        continue
      }
      if (entry.key === 'defaultCaptionSettings') {
        describeCaptionSettings(previous.get(entry.key), entry.value, changes)
        continue
      }
      if (entry.key === 'customThemes') {
        describeCustomThemes(previous.get(entry.key), entry.value, changes)
        continue
      }
      const value = entry.value
      // Large JSON-backed settings get an update entry rather than filling the
      // activity feed with configuration data or exceeding its payload limit.
      const summaryOnly = typeof value === 'object' ||
        (typeof value === 'string' && new TextEncoder().encode(value).length > 128)
      changes.push({ key: entry.key, value: summaryOnly ? null : value })
    }
  } else if (['subscriptions', 'playlists', 'profiles', 'playlistBookmarks'].includes(collection) &&
      JSON.stringify(before) !== JSON.stringify(after)) {
    describeCollectionChanges(collection, before, after, changes, channelNames)
  }
  if (changes.length > MAX_ACTIVITY_CHANGES) {
    changes.splice(MAX_ACTIVITY_CHANGES - 1, Infinity, { collection: collection === 'settings' ? 'settings' : collection })
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
