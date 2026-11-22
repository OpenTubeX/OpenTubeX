// @ts-check

import { toRaw } from 'vue'

/**
 * @typedef {object} SyncDeletionDecision
 * @property {string[]} [confirmed] Deletions to apply without asking
 * @property {string[]} [kept] Deletions to undo by restoring the items on both sides
 * @property {string[]} [remote] Deletions other devices confirmed. They apply
 *   without asking to items missing on the server.
 */

/**
 * The key of a synced ID list, as used by mergeIds.
 * @param {string} collection
 * @param {string | null} [scope] The playlist or profile ID of a nested list
 */
export function syncDeletionKey(collection, scope = null) {
  return scope == null ? collection : `${collection}:${scope}`
}

/**
 * The key under which deletions are recorded: the {@link syncDeletionKey},
 * and for a separate profile's data also the profile.
 * @param {string} key
 * @param {string | null} [dataScope] The separate profile, or null for the data every profile shares
 */
export function syncDeletionListKey(key, dataScope = null) {
  return dataScope === null ? key : JSON.stringify([dataScope, key])
}

/**
 * @param {string} listKey A {@link syncDeletionListKey}
 * @returns {[string | null, string] | null} The data scope and the deletion key, or null for an invalid key
 */
export function parseSyncDeletionListKey(listKey) {
  // Deletion keys start with their collection's name, never with a bracket.
  if (!listKey.startsWith('[')) return [null, listKey]
  try {
    const parsed = JSON.parse(listKey)
    return Array.isArray(parsed) && parsed.length === 2 && parsed.every(part => typeof part === 'string')
      ? [parsed[0], parsed[1]]
      : null
  } catch {
    return null
  }
}

/**
 * @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} SyncDeletionStorage
 */

const STORAGE_KEY = 'opentubex.sync-deletion-decisions'

/**
 * Deletions sync applies or undoes without asking again. The user confirms
 * deletions by making them in the app or by choosing an option in the review
 * prompt. Decisions stay until a sync that used them succeeds. With a storage,
 * they survive restarts and every window shares them, so a deletion made
 * offline, or in another window, does not need a review either.
 * @param {SyncDeletionStorage | null} [storage]
 */
export function createSyncDeletionDecisions(storage = null) {
  /** @type {Map<string, { confirmed: Set<string>, kept: Set<string> }>} */
  let decisions = new Map()
  // Changes a failed save left out of the storage. Each read applies them
  // again, so the changes other windows saved meanwhile stay.
  /** @type {(() => void)[]} */
  let unsaved = []

  // Read before each change, because another window may have changed them.
  function load() {
    if (!storage) return
    try {
      const saved = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')
      decisions = new Map(Object.entries(saved).map(([key, value]) => [key, {
        confirmed: new Set(Array.isArray(value?.confirmed) ? value.confirmed : []),
        kept: new Set(Array.isArray(value?.kept) ? value.kept : []),
      }]))
      for (const change of unsaved) change()
    } catch (error) {
      console.error('Failed to read the sync deletion decisions', error)
    }
  }

  /** @param {() => void} change */
  function update(change) {
    load()
    change()
    if (!storage) return
    try {
      if (decisions.size === 0) storage.removeItem(STORAGE_KEY)
      else storage.setItem(STORAGE_KEY, JSON.stringify(snapshotOf(decisions)))
      unsaved = []
    } catch (error) {
      // They still apply to syncs in this window.
      unsaved.push(change)
      console.error('Failed to save the sync deletion decisions', error)
    }
  }

  /** @param {string} key */
  function entry(key) {
    let value = decisions.get(key)
    if (!value) {
      value = { confirmed: new Set(), kept: new Set() }
      decisions.set(key, value)
    }
    return value
  }

  return {
    /**
     * @param {string} key A {@link syncDeletionListKey}
     * @param {Iterable<string>} ids
     */
    confirm(key, ids) {
      const list = Array.from(ids)
      update(() => {
        const value = entry(key)
        for (const id of list) {
          value.kept.delete(id)
          value.confirmed.add(id)
        }
      })
    },

    /**
     * @param {string} key A {@link syncDeletionListKey}
     * @param {Iterable<string>} ids
     */
    keep(key, ids) {
      const list = Array.from(ids)
      update(() => {
        const value = entry(key)
        for (const id of list) {
          value.confirmed.delete(id)
          value.kept.add(id)
        }
      })
    },

    /**
     * @param {string | null} [dataScope] The separate profile whose deletions to take, or null for the shared ones
     * @returns {Record<string, SyncDeletionDecision>} A copy for one sync, by {@link syncDeletionKey}
     */
    snapshot(dataScope = null) {
      load()
      return Object.fromEntries(Object.entries(snapshotOf(decisions)).flatMap(([listKey, decision]) => {
        const parsed = parseSyncDeletionListKey(listKey)
        return parsed && parsed[0] === dataScope ? [[parsed[1], decision]] : []
      }))
    },

    /**
     * Forgets the decisions a successful sync applied. Decisions made while it
     * ran stay for the next sync.
     * @param {Record<string, SyncDeletionDecision>} applied A {@link snapshot}
     * @param {string | null} [dataScope] The data scope of the snapshot
     */
    release(applied, dataScope = null) {
      update(() => {
        for (const [key, { confirmed = [], kept = [] }] of Object.entries(applied)) {
          const listKey = syncDeletionListKey(key, dataScope)
          const value = decisions.get(listKey)
          if (!value) continue
          for (const id of confirmed) value.confirmed.delete(id)
          for (const id of kept) value.kept.delete(id)
          if (value.confirmed.size === 0 && value.kept.size === 0) decisions.delete(listKey)
        }
      })
    },

    clear() {
      update(() => decisions.clear())
    },
  }
}

/**
 * @param {Map<string, { confirmed: Set<string>, kept: Set<string> }>} decisions
 * @returns {Record<string, SyncDeletionDecision>}
 */
function snapshotOf(decisions) {
  return Object.fromEntries(Array.from(decisions, ([key, { confirmed, kept }]) => [
    key,
    { confirmed: Array.from(confirmed), kept: Array.from(kept) },
  ]))
}

export const syncDeletions = createSyncDeletionDecisions(typeof localStorage === 'undefined' ? null : localStorage)

/**
 * User actions that can delete synced items, by the lists they can shrink.
 * @type {Map<string, 'history' | 'playlists' | 'playlistBookmarks' | 'profiles'>}
 */
export const SYNC_DELETION_ACTIONS = new Map([
  ['removeFromHistory', 'history'],
  ['removeHistoryOlderThan', 'history'],
  ['removeAllHistory', 'history'],
  ['removeVideo', 'playlists'],
  ['removeVideos', 'playlists'],
  ['removeAllVideos', 'playlists'],
  ['removePlaylist', 'playlists'],
  ['removePlaylists', 'playlists'],
  ['removeAllPlaylists', 'playlists'],
  ['updatePlaylist', 'playlists'],
  ['removePlaylistBookmark', 'playlistBookmarks'],
  ['removeChannelFromProfiles', 'profiles'],
  ['updateProfile', 'profiles'],
  ['removeProfile', 'profiles'],
])

/** The lists of the data of the active data scope, unlike those of profiles and bookmarks, which hold every profile's */
const SCOPED_FAMILIES = new Set(['history', 'playlists'])

/**
 * The synced ID lists that a local action can shrink, for comparing state
 * before and after it.
 * @param {any} state The root store state
 * @param {'history' | 'playlists' | 'playlistBookmarks' | 'profiles'} family
 * @param {string} mainProfileId
 * @param {string | null} [dataScope] The separate profile whose history and playlists the store holds, or null for the shared ones
 * @returns {Map<string, Set<string>>} IDs by {@link syncDeletionListKey}
 */
export function syncedIdLists(state, family, mainProfileId, dataScope = null) {
  // Scanning through reactive proxies costs several times more on large libraries.
  state = toRaw(state)
  /** @type {Map<string, Set<string>>} */
  const lists = new Map()
  switch (family) {
    case 'history':
      lists.set(
        syncDeletionListKey('history', dataScope),
        new Set((state.history?.historyCacheSorted ?? []).map(record => record.videoId))
      )
      break
    case 'playlists': {
      const playlists = state.playlists?.playlists ?? []
      lists.set(syncDeletionListKey('playlists', dataScope), new Set(playlists.map(playlist => playlist._id)))
      for (const playlist of playlists) {
        lists.set(
          syncDeletionListKey(syncDeletionKey('playlistVideos', playlist._id), dataScope),
          new Set((playlist.videos ?? []).map(video => video.videoId))
        )
      }
      break
    }
    case 'playlistBookmarks': {
      const ids = bookmarks => new Set((Array.isArray(bookmarks) ? bookmarks : []).map(bookmark => bookmark?.playlist?.id))
      lists.set('playlistBookmarks', ids(state.settings?.playlistBookmarks))
      // Separate profiles keep their own, which sync with their data.
      for (const profile of state.profiles?.profileList ?? []) {
        if (profile.separate === true) {
          lists.set(syncDeletionListKey('playlistBookmarks', profile._id), ids(profile.playlistBookmarks))
        }
      }
      break
    }
    case 'profiles': {
      const profiles = state.profiles?.profileList ?? []
      const main = profiles.find(profile => profile._id === mainProfileId) ?? profiles[0]
      lists.set('subscriptions', new Set((main?.subscriptions ?? []).map(channel => channel.id)))
      const others = profiles.filter(profile => profile._id !== mainProfileId && profile.separate !== true)
      lists.set('profiles', new Set(others.map(profile => profile._id)))
      for (const profile of others) {
        lists.set(
          syncDeletionKey('profileChannels', profile._id),
          new Set((profile.subscriptions ?? []).map(channel => channel.id))
        )
      }
      // Separate profiles sync their channels like the main profile, in their own data.
      const separate = profiles.filter(profile => profile.separate === true)
      lists.set('separateProfiles', new Set(separate.map(profile => profile._id)))
      for (const profile of separate) {
        lists.set(
          syncDeletionListKey('subscriptions', profile._id),
          new Set((profile.subscriptions ?? []).map(channel => channel.id))
        )
      }
      break
    }
  }
  return lists
}

/**
 * Confirms the IDs that disappeared from the lists between two snapshots.
 * @param {Map<string, Set<string>>} before
 * @param {Map<string, Set<string>>} after
 * @param {ReturnType<typeof createSyncDeletionDecisions>} [decisions]
 */
export function confirmRemovedSyncIds(before, after, decisions = syncDeletions) {
  for (const [key, ids] of before) {
    const remaining = after.get(key)
    const removed = Array.from(ids).filter(id => !remaining?.has(id))
    if (removed.length > 0) decisions.confirm(key, removed)
  }
}

/**
 * A store plugin that confirms the deletions of user actions. Deleting items
 * in the app is the user's decision, so sync applies those deletions without
 * asking again, even when they empty a list.
 * @param {object} options
 * @param {() => boolean} options.isRemoteDispatch Whether the action comes from sync
 * @param {string} options.mainProfileId
 * @param {() => string | null | undefined} [options.dataScope] The separate profile whose history and
 *   playlists the store holds, null for the shared ones, or undefined while a profile switch loads them
 * @param {ReturnType<typeof createSyncDeletionDecisions>} [options.decisions]
 */
export function trackLocalSyncDeletions({ isRemoteDispatch, mainProfileId, dataScope = () => null, decisions = syncDeletions }) {
  return store => {
    /** @type {WeakMap<object, { family: Parameters<typeof syncedIdLists>[1], scope: string | null, lists: Map<string, Set<string>> }>} */
    const before = new WeakMap()
    store.subscribeAction({
      before: action => {
        const family = SYNC_DELETION_ACTIONS.get(action.type)
        // Comparing the lists costs a scan of them, which only sync needs.
        const settings = store.state.settings
        if (family && settings?.syncServerEnabled && settings.syncServerToken && !isRemoteDispatch()) {
          // Profiles and bookmarks are the same whichever profile's data the store shows.
          const scope = SCOPED_FAMILIES.has(family) ? dataScope() : null
          // While a profile switch loads, the store may hold either profile's data.
          if (scope === undefined) return
          before.set(action, { family, scope, lists: syncedIdLists(store.state, family, mainProfileId, scope) })
        }
      },
      after: action => {
        const pending = before.get(action)
        if (!pending) return
        // After a profile switch, the store holds another profile's data. Its
        // lists would look like the removal of everything the action started
        // with, so sync asks about this action's deletions instead.
        if (SCOPED_FAMILIES.has(pending.family) && dataScope() !== pending.scope) return
        confirmRemovedSyncIds(pending.lists, syncedIdLists(store.state, pending.family, mainProfileId, pending.scope), decisions)
      },
    })
  }
}

/**
 * The encrypted collection in which devices share the deletions they confirmed.
 * Without it, a device cannot tell another device's deletion from a server
 * that lost the data, and asks before applying either.
 */
export const SYNC_DELETION_MARKS_COLLECTION = 'syncDeletions'

// Every device that syncs within this time sees a deletion without asking.
const SYNC_DELETION_MARK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * @typedef {object} SyncDeletionMark
 * @property {string} key The list, by {@link syncDeletionKey}
 * @property {number} at When the deletions were uploaded
 * @property {string[]} ids
 */

/**
 * @param {unknown} data The decrypted collection
 * @param {number} [now]
 * @returns {SyncDeletionMark[]} The valid marks that have not expired
 */
export function readSyncDeletionMarks(data, now = Date.now()) {
  if (!Array.isArray(data)) return []
  return data.filter(mark => mark && typeof mark.key === 'string' && Number.isFinite(mark.at) &&
    now - mark.at < SYNC_DELETION_MARK_MAX_AGE_MS && Array.isArray(mark.ids) &&
    mark.ids.every(id => typeof id === 'string'))
}

/**
 * Adds the deletions other devices confirmed to the decisions of one sync.
 * @param {Record<string, SyncDeletionDecision>} decisions
 * @param {SyncDeletionMark[]} marks
 * @returns {Record<string, SyncDeletionDecision>}
 */
export function withRemoteSyncDeletions(decisions, marks) {
  /** @type {Map<string, Set<string>>} */
  const remote = new Map()
  for (const { key, ids } of marks) {
    const value = remote.get(key) ?? new Set()
    for (const id of ids) value.add(id)
    remote.set(key, value)
  }
  const result = { ...decisions }
  for (const [key, ids] of remote) result[key] = { ...result[key], remote: Array.from(ids) }
  return result
}

/**
 * Adds this device's confirmed deletions to the shared marks.
 * @param {SyncDeletionMark[]} marks
 * @param {Record<string, SyncDeletionDecision>} decisions
 * @param {object} [options]
 * @param {(key: string) => boolean} [options.includeKey] Whether the sync uploads the list
 * @param {number} [options.now]
 * @returns {SyncDeletionMark[] | null} null when there is nothing to add
 */
export function addSyncDeletionMarks(marks, decisions, { includeKey = () => true, now = Date.now() } = {}) {
  const added = Object.entries(decisions)
    .filter(([key, { confirmed }]) => includeKey(key) && confirmed && confirmed.length > 0)
    .map(([key, { confirmed = [] }]) => ({ key, at: now, ids: Array.from(new Set(confirmed)) }))
  if (added.length === 0) return null
  // The new mark replaces older ones of the same items, so they expire later.
  const addedIds = new Map(added.map(mark => [mark.key, new Set(mark.ids)]))
  const kept = marks
    .map(mark => ({ ...mark, ids: mark.ids.filter(id => !addedIds.get(mark.key)?.has(id)) }))
    .filter(mark => mark.ids.length > 0)
  return [...kept, ...added]
}

const UNSENT_MARKS_STORAGE_KEY = 'opentubex.sync-deletion-marks-unsent'

/**
 * @typedef {object} UnsentSyncDeletionMarks
 * @property {string} account The sync account the marks belong to
 * @property {SyncDeletionMark[]} marks
 */

/**
 * Confirmed deletions a sync failed to share. Their decisions go once the sync
 * succeeds, so the next syncs of the same account share these until they would
 * have expired.
 * @param {SyncDeletionStorage | null} [storage]
 */
export function createUnsentSyncDeletionMarks(storage = null) {
  /** @type {UnsentSyncDeletionMarks} */
  let queue = { account: '', marks: [] }
  // Changes a failed save left out of the storage, as for the decisions.
  /** @type {((queue: UnsentSyncDeletionMarks) => UnsentSyncDeletionMarks)[]} */
  let unsaved = []

  function load() {
    if (!storage) return
    try {
      const saved = JSON.parse(storage.getItem(UNSENT_MARKS_STORAGE_KEY) ?? 'null')
      queue = {
        account: typeof saved?.account === 'string' ? saved.account : '',
        marks: readSyncDeletionMarks(saved?.marks),
      }
      for (const change of unsaved) queue = change(queue)
    } catch (error) {
      console.error('Failed to read the unsent sync deletions', error)
    }
  }

  /** @param {(queue: UnsentSyncDeletionMarks) => UnsentSyncDeletionMarks} change */
  function update(change) {
    load()
    queue = change(queue)
    if (!storage) return
    try {
      if (queue.marks.length === 0) storage.removeItem(UNSENT_MARKS_STORAGE_KEY)
      else storage.setItem(UNSENT_MARKS_STORAGE_KEY, JSON.stringify(queue))
      unsaved = []
    } catch (error) {
      // They are still shared from this window.
      unsaved.push(change)
      console.error('Failed to save the unsent sync deletions', error)
    }
  }

  return {
    /** @param {string} account */
    read(account) {
      load()
      return queue.account === account ? readSyncDeletionMarks(queue.marks) : []
    },

    /**
     * @param {string} account
     * @param {Record<string, SyncDeletionDecision>} decisions
     * @param {(key: string) => boolean} includeKey
     */
    add(account, decisions, includeKey) {
      const now = Date.now()
      update(({ account: saved, marks }) => {
        // Another account's marks would hide its own deletion reviews.
        const known = saved === account ? marks : []
        return { account, marks: addSyncDeletionMarks(known, decisions, { includeKey, now }) ?? known }
      })
    },

    /**
     * @param {string} account
     * @param {SyncDeletionMark[]} shared Marks from {@link read} that a sync shared
     */
    remove(account, shared) {
      if (shared.length === 0) return
      update(saved => saved.account !== account
        ? saved
        : {
            account,
            marks: saved.marks.filter(mark => !shared.some(({ key, at }) => key === mark.key && at === mark.at)),
          })
    },

    clear() {
      update(() => ({ account: '', marks: [] }))
    },
  }
}

export const unsentSyncDeletionMarks = createUnsentSyncDeletionMarks(
  typeof localStorage === 'undefined' ? null : localStorage
)

// The lists whose items, or the lists nested in them, have IDs a legacy sync
// server assigned. Devices that synced through it can know them by other IDs.
/** @type {Record<string, string>} */
const SERVER_ID_LISTS = {
  playlists: 'playlists',
  playlistVideos: 'playlists',
  profiles: 'profiles',
  profileChannels: 'profiles',
}

/**
 * Translates the IDs of playlists and profiles in deletion marks between this
 * device's and the server's, so devices that know them by other IDs share them.
 * @template {Pick<SyncDeletionMark, 'key' | 'ids'>} T
 * @param {T[]} marks
 * @param {Record<string, unknown>} snapshot The saved sync baselines
 * @param {boolean} toServer
 * @returns {T[]}
 */
export function translateSyncDeletionMarks(marks, snapshot, toServer) {
  /** @type {Map<string, Map<string, string>>} */
  const maps = new Map()
  /** @param {string} list */
  function idMap(list) {
    let map = maps.get(list)
    if (!map) {
      const baselines = snapshot[list]
      map = new Map()
      if (baselines && typeof baselines === 'object') {
        for (const [localId, baseline] of Object.entries(baselines)) {
          const remoteId = /** @type {{ remoteId?: unknown } | null} */ (baseline)?.remoteId
          if (typeof remoteId === 'string' && remoteId !== localId) {
            if (toServer) map.set(localId, remoteId)
            else map.set(remoteId, localId)
          }
        }
      }
      maps.set(list, map)
    }
    return map
  }

  return marks.map(mark => {
    const separator = mark.key.indexOf(':')
    const collection = separator === -1 ? mark.key : mark.key.slice(0, separator)
    const list = SERVER_ID_LISTS[collection]
    if (!list) return mark
    const ids = idMap(list)
    if (separator === -1) return { ...mark, ids: mark.ids.map(id => ids.get(id) ?? id) }
    const scope = mark.key.slice(separator + 1)
    return { ...mark, key: syncDeletionKey(collection, ids.get(scope) ?? scope) }
  })
}
