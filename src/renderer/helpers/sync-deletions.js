// @ts-check

/**
 * @typedef {object} SyncDeletionDecision
 * @property {string[]} [confirmed] Deletions to apply without asking
 * @property {string[]} [kept] Deletions to undo by restoring the items on both sides
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
 * Deletions sync applies or undoes without asking again. The user confirms
 * deletions by making them in the app or by choosing an option in the review
 * prompt. Each window keeps its own decisions until a sync that used them
 * succeeds; the review prompt covers deletions this window does not know about.
 */
export function createSyncDeletionDecisions() {
  /** @type {Map<string, { confirmed: Set<string>, kept: Set<string> }>} */
  const decisions = new Map()

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
     * @param {string} key
     * @param {Iterable<string>} ids
     */
    confirm(key, ids) {
      const value = entry(key)
      for (const id of ids) {
        value.kept.delete(id)
        value.confirmed.add(id)
      }
    },

    /**
     * @param {string} key
     * @param {Iterable<string>} ids
     */
    keep(key, ids) {
      const value = entry(key)
      for (const id of ids) {
        value.confirmed.delete(id)
        value.kept.add(id)
      }
    },

    /** @returns {Record<string, SyncDeletionDecision>} A copy for one sync */
    snapshot() {
      return Object.fromEntries(Array.from(decisions, ([key, { confirmed, kept }]) => [
        key,
        { confirmed: Array.from(confirmed), kept: Array.from(kept) },
      ]))
    },

    /**
     * Forgets the decisions a successful sync applied. Decisions made while it
     * ran stay for the next sync.
     * @param {Record<string, SyncDeletionDecision>} applied A {@link snapshot}
     */
    release(applied) {
      for (const [key, { confirmed = [], kept = [] }] of Object.entries(applied)) {
        const value = decisions.get(key)
        if (!value) continue
        for (const id of confirmed) value.confirmed.delete(id)
        for (const id of kept) value.kept.delete(id)
        if (value.confirmed.size === 0 && value.kept.size === 0) decisions.delete(key)
      }
    },

    clear() {
      decisions.clear()
    },
  }
}

export const syncDeletions = createSyncDeletionDecisions()

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

/**
 * The synced ID lists that a local action can shrink, for comparing state
 * before and after it.
 * @param {any} state The root store state
 * @param {'history' | 'playlists' | 'playlistBookmarks' | 'profiles'} family
 * @param {string} mainProfileId
 * @returns {Map<string, Set<string>>} IDs by {@link syncDeletionKey}
 */
export function syncedIdLists(state, family, mainProfileId) {
  /** @type {Map<string, Set<string>>} */
  const lists = new Map()
  switch (family) {
    case 'history':
      lists.set('history', new Set((state.history?.historyCacheSorted ?? []).map(record => record.videoId)))
      break
    case 'playlists': {
      const playlists = state.playlists?.playlists ?? []
      lists.set('playlists', new Set(playlists.map(playlist => playlist._id)))
      for (const playlist of playlists) {
        lists.set(
          syncDeletionKey('playlistVideos', playlist._id),
          new Set((playlist.videos ?? []).map(video => video.videoId))
        )
      }
      break
    }
    case 'playlistBookmarks': {
      const bookmarks = Array.isArray(state.settings?.playlistBookmarks) ? state.settings.playlistBookmarks : []
      lists.set('playlistBookmarks', new Set(bookmarks.map(bookmark => bookmark?.playlist?.id)))
      break
    }
    case 'profiles': {
      const profiles = state.profiles?.profileList ?? []
      const main = profiles.find(profile => profile._id === mainProfileId) ?? profiles[0]
      lists.set('subscriptions', new Set((main?.subscriptions ?? []).map(channel => channel.id)))
      const others = profiles.filter(profile => profile._id !== mainProfileId)
      lists.set('profiles', new Set(others.map(profile => profile._id)))
      for (const profile of others) {
        lists.set(
          syncDeletionKey('profileChannels', profile._id),
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
 * @param {ReturnType<typeof createSyncDeletionDecisions>} [options.decisions]
 */
export function trackLocalSyncDeletions({ isRemoteDispatch, mainProfileId, decisions = syncDeletions }) {
  return store => {
    /** @type {WeakMap<object, { family: Parameters<typeof syncedIdLists>[1], lists: Map<string, Set<string>> }>} */
    const before = new WeakMap()
    store.subscribeAction({
      before: action => {
        const family = SYNC_DELETION_ACTIONS.get(action.type)
        if (family && !isRemoteDispatch()) {
          before.set(action, { family, lists: syncedIdLists(store.state, family, mainProfileId) })
        }
      },
      after: action => {
        const pending = before.get(action)
        if (!pending) return
        confirmRemovedSyncIds(pending.lists, syncedIdLists(store.state, pending.family, mainProfileId), decisions)
      },
    })
  }
}
