import { toRaw } from 'vue'

import store from '../store/index'
import i18n from '../i18n/index'
import { MAIN_PROFILE_ID } from '../../constants'
import { deepCopy, ERROR_TOAST_ICON, showToast } from './utils'
import { generateRandomUniqueId } from './playlists'
import { getYouTubeChannelKey, getYouTubeSyncKey } from './youtube-account-state'
import { setYouTubePlaylistChangeListener } from './youtube-playlist-changes'
import {
  completeYouTubePlaylistVideos,
  diffYouTubeSubscriptions,
  mergeYouTubePlaylistVideos,
  planYouTubePlaylistMoves,
  resolveYouTubeSetVideoIds
} from './youtube-sync-merge'
import {
  createYouTubePlaylist,
  deleteYouTubePlaylist,
  editYouTubePlaylist,
  getCurrentYouTubeAccount,
  getYouTubeAccountPlaylists,
  getYouTubeAccountSubscriptions,
  getYouTubePlaylistVideos,
  rateYouTubeVideo,
  subscribeOnYouTube,
  unsubscribeOnYouTube
} from './api/youtube-account'

// Keeps subscriptions and playlists in step with the signed-in YouTube account.
// Changes on YouTube come in when the app starts, when a subscription feed
// refreshes, and when a synced playlist opens. Changes made here go out as
// they happen. YouTube playlists are saved like other playlists, with a
// `youTube` link, but stay off the sync server, exports, and backups.

const LOCK_NAME = 'opentubex-youtube-sync'
const LIKED_VIDEOS = 'LL'
const WATCH_LATER = 'WL'
const STARTUP_SYNC_INTERVAL_MS = 5 * 60_000
// Feed refreshes, settings changes, and every window ask for a sync.
const MIN_SYNC_INTERVAL_MS = 60_000
// How many edits one request carries.
const EDIT_BATCH_SIZE = 50

/**
 * @typedef {import('./api/youtube-account').YouTubeAccount} YouTubeAccount
 * @typedef {import('./api/youtube-account-parsers').YouTubePlaylistSummary} YouTubePlaylistSummary
 * @typedef {import('./youtube-playlist-changes').YouTubePlaylistChange} YouTubePlaylistChange
 *
 * @typedef {object} YouTubeSyncState
 * @property {string} key the sign-in and channel it belongs to
 * @property {string[] | null} subscriptions the channels YouTube had at the last sync
 * @property {number} subscriptionsSyncedAt
 * @property {number} playlistsSyncedAt
 *
 * @typedef {object} YouTubePlaylistLink saved as `youTube` on a synced playlist
 * @property {string} playlistId
 * @property {string} accountKey the sign-in and channel it was synced from
 * @property {string} title the name on YouTube at the last sync
 * @property {string | null} signature from the playlist list at the last sync
 */

class AccountChangedError extends Error {
  constructor() {
    super('Signed out, or switched YouTube channels, during the sync')
    this.name = 'AccountChangedError'
  }
}

/** Without Web Locks, sync work queues here, which covers one window. */
let localSyncWork = Promise.resolve()

/**
 * Runs sync work one at a time, also across windows, so a sync never reads
 * YouTube while an edit from here is on its way.
 * @template T
 * @param {() => Promise<T>} callback
 * @param {boolean} [ifAvailable] skips the work instead of waiting for other work
 * @returns {Promise<T | null>}
 */
function withSyncLock(callback, ifAvailable = false) {
  if (navigator.locks) return navigator.locks.request(LOCK_NAME, { ifAvailable }, lock => lock ? callback() : null)
  const result = localSyncWork.then(callback)
  localSyncWork = result.catch(() => {})
  return result
}

/** @returns {YouTubeAccount | null} */
function getSyncAccount() {
  const account = getCurrentYouTubeAccount()
  return getYouTubeSyncKey(account) ? account : null
}

/** @param {YouTubeAccount} account */
function throwIfAccountChanged(account) {
  if (getYouTubeSyncKey(getSyncAccount()) !== getYouTubeSyncKey(account)) throw new AccountChangedError()
}

/**
 * @param {string} key
 * @returns {YouTubeSyncState}
 */
function getSyncState(key) {
  const state = store.getters.getYouTubeAccountSyncState
  return state?.key === key ? state : { key, subscriptions: null, subscriptionsSyncedAt: 0, playlistsSyncedAt: 0 }
}

/**
 * @param {string} key
 * @param {Partial<YouTubeSyncState>} changes
 */
async function updateSyncState(key, changes) {
  if (!await store.dispatch('updateYouTubeAccountSyncState', { ...getSyncState(key), ...changes })) {
    throw new Error('Could not save the YouTube sync state')
  }
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The playlists synced from the given sign-in and channel.
 * @param {string | null} key
 */
function getLinkedPlaylists(key) {
  return store.getters.getAllPlaylists.filter(playlist => playlist.youTube && playlist.youTube.accountKey === key)
}

/**
 * Removes the playlists of a sign-in or channel no longer in use, or all of
 * them once playlist sync is off. They stay on YouTube.
 * @param {YouTubeAccount | null} account
 */
async function removeUnsyncedPlaylists(account) {
  const key = store.getters.getYouTubeAccountSyncPlaylists ? getYouTubeSyncKey(account) : null
  const ids = store.getters.getAllPlaylists
    .filter(playlist => playlist.youTube && playlist.youTube.accountKey !== key)
    .map(playlist => playlist._id)
  if (ids.length > 0) await store.dispatch('removePlaylists', ids)
}

/**
 * Applies the subscription changes on YouTube since the last sync. Channels
 * subscribed to on YouTube are added to All Channels, and channels
 * unsubscribed from there leave every profile.
 * @param {YouTubeAccount} account
 */
async function syncSubscriptions(account) {
  const key = getYouTubeSyncKey(account)
  const remote = await getYouTubeAccountSubscriptions(account)
  throwIfAccountChanged(account)
  if (!store.getters.getYouTubeAccountSyncSubscriptions) return

  const profiles = store.getters.getProfileList
  const mainIds = new Set(profiles.find(profile => profile._id === MAIN_PROFILE_ID)?.subscriptions.map(channel => channel.id))
  const { added, removedIds } = diffYouTubeSubscriptions(getSyncState(key).subscriptions, remote, mainIds)

  if (added.length > 0 && await store.dispatch('mergeImportedProfile', { _id: MAIN_PROFILE_ID, subscriptions: added }) !== true) {
    throw new Error('Could not save the subscriptions from YouTube')
  }
  if (removedIds.length > 0) {
    const removed = new Set(removedIds)
    // A removal that did not save must come again with the next sync.
    if (!await store.dispatch('removeChannelFromProfiles', {
      channelIds: removedIds,
      profileIds: profiles.filter(profile => profile.subscriptions.some(channel => removed.has(channel.id))).map(profile => profile._id)
    })) {
      throw new Error('Could not remove the channels unsubscribed from on YouTube')
    }
  }
  await updateSyncState(key, { subscriptions: remote.map(channel => channel.id), subscriptionsSyncedAt: Date.now() })

  if (added.length > 0 || removedIds.length > 0) {
    showToast({
      message: i18n.global.t('YouTube Account.Subscriptions Synced', { added: added.length, removed: removedIds.length }),
      icon: ['fas', 'subscriptions']
    })
  }
}

let subscriptionPushes = Promise.resolve()

/**
 * Repeats a subscription change in OpenTubeX on the YouTube account, when
 * the user turned on subscription sync.
 * @param {string | string[]} channelIds
 * @param {boolean} subscribed
 */
export function mirrorYouTubeSubscription(channelIds, subscribed) {
  // Only YouTube channels can be subscribed to on YouTube.
  const youTubeChannelIds = [channelIds].flat().filter(channelId => /^UC[\w-]{22}$/.test(channelId))
  const account = getCurrentYouTubeAccount()
  if (!account || !store.getters.getYouTubeAccountSyncSubscriptions || youTubeChannelIds.length === 0) {
    return Promise.resolve()
  }

  // Changes go out in the order they were made, so a quick unsubscribe
  // cannot finish before the subscribe it undoes.
  subscriptionPushes = subscriptionPushes.then(() => pushSubscriptions(youTubeChannelIds, subscribed, account))
  return subscriptionPushes
}

/**
 * @param {string[]} channelIds
 * @param {boolean} subscribed
 * @param {YouTubeAccount} account the sign-in and channel in use when the change was made
 */
async function pushSubscriptions(channelIds, subscribed, account) {
  const channelKey = getYouTubeChannelKey(account)
  const key = getYouTubeSyncKey(account)
  try {
    // One at a time, and stop at the first failure instead of repeating it.
    for (const channelId of channelIds) {
      // The next sync compares with YouTube as it is after this change, so a
      // change made there in between is not missed. No sync may read YouTube
      // between the change and the comparison base.
      const sent = await withSyncLock(async () => {
        // After turning sync off, a channel switch, or signing out, the rest
        // would change subscriptions the user no longer wants changed.
        if (!store.getters.getYouTubeAccountSyncSubscriptions || getYouTubeChannelKey(getCurrentYouTubeAccount()) !== channelKey) return false
        if (subscribed) {
          await subscribeOnYouTube(channelId)
        } else {
          await unsubscribeOnYouTube(channelId)
        }
        const previous = getSyncState(key).subscriptions
        if (previous !== null) {
          await updateSyncState(key, {
            subscriptions: subscribed ? [...new Set([...previous, channelId])] : previous.filter(id => id !== channelId)
          })
        }
        return true
      })
      if (!sent) return
    }
  } catch (error) {
    console.error(error)
    const details = { error: errorMessage(error) }
    showToast({
      message: subscribed
        ? i18n.global.t('YouTube Account.Subscribe Failed', details)
        : i18n.global.t('YouTube Account.Unsubscribe Failed', details),
      icon: ERROR_TOAST_ICON
    })
  }
}

/**
 * Saves a playlist as YouTube has it, unless it is unchanged since the last
 * sync. A playlist changed here meanwhile is left for the next sync.
 * @param {YouTubeAccount} account
 * @param {YouTubePlaylistSummary} summary
 * @param {boolean} force reads the playlist even when its count and first video are unchanged
 * @param {boolean} [restoreName] takes YouTube's name, after YouTube refused a rename
 */
async function pullPlaylist(account, summary, force, restoreName = false) {
  const key = getYouTubeSyncKey(account)
  const saved = getLinkedPlaylists(key).find(playlist => playlist.youTube.playlistId === summary.playlistId)
  const renamed = saved !== undefined && saved.youTube.title !== summary.title
  if (saved && !force && !renamed && saved.youTube.signature === summary.signature) return

  const previous = saved ? deepCopy(toRaw(saved)) : null
  const savedVideos = previous?.videos ?? []
  // Liked videos only gains videos at its start, so the start and the count
  // show every change. Other playlists can change anywhere.
  const readAll = summary.playlistId !== LIKED_VIDEOS
  const { title, videos } = await getYouTubePlaylistVideos(summary.playlistId, account,
    readAll ? undefined : read => completeYouTubePlaylistVideos(read, savedVideos, summary.videoCount))
  throwIfAccountChanged(account)
  if (!store.getters.getYouTubeAccountSyncPlaylists) return

  const merged = mergeYouTubePlaylistVideos(savedVideos, videos, {
    now: Date.now(),
    newestFirst: summary.playlistId === LIKED_VIDEOS,
    createId: generateRandomUniqueId
  })
  const name = summary.title || title || summary.playlistId
  /** @type {YouTubePlaylistLink} */
  const youTube = { playlistId: summary.playlistId, accountKey: key, title: summary.title, signature: summary.signature }

  if (!previous) {
    await store.dispatch('importPlaylist', {
      // The ID leads, as in the saved document, so later conditional saves can
      // compare the two.
      _id: `ft-playlist--${generateRandomUniqueId()}`,
      playlistName: name,
      protected: false,
      description: '',
      videos: merged,
      // YouTube adds new likes at the start.
      ...(summary.playlistId === LIKED_VIDEOS ? { addVideosToTop: true } : {}),
      youTube
    })
    return
  }

  // A name changed here stays until the playlist is renamed on YouTube.
  await store.dispatch('updatePlaylistFromSync', {
    playlist: { ...previous, playlistName: renamed || restoreName ? name : previous.playlistName, videos: merged, youTube },
    previous
  })
}

/**
 * The playlists to sync: the account's own, Watch later, and Liked videos.
 * Playlists saved from other channels are left out.
 * @param {YouTubeAccount} account
 * @returns {Promise<YouTubePlaylistSummary[]>}
 */
async function getSyncedPlaylistSummaries(account) {
  const { playlists, ownedIds } = await getYouTubeAccountPlaylists(account)
  return playlists.filter(playlist => playlist.playlistId === LIKED_VIDEOS || ownedIds.has(playlist.playlistId))
}

/** @param {YouTubeAccount} account */
async function syncPlaylists(account) {
  const key = getYouTubeSyncKey(account)
  const summaries = await getSyncedPlaylistSummaries(account)
  throwIfAccountChanged(account)
  if (!store.getters.getYouTubeAccountSyncPlaylists) return

  // Deleted on YouTube
  const remoteIds = new Set(summaries.map(summary => summary.playlistId))
  const deleted = getLinkedPlaylists(key).filter(playlist => !remoteIds.has(playlist.youTube.playlistId))
  if (deleted.length > 0) await store.dispatch('removePlaylists', deleted.map(playlist => playlist._id))

  for (const summary of summaries) {
    await pullPlaylist(account, summary, false)
  }
  await updateSyncState(key, { playlistsSyncedAt: Date.now() })
}

/**
 * Brings changes from YouTube in. Each part only runs while its sync is on.
 * @param {object} [options]
 * @param {boolean} [options.subscriptions]
 * @param {boolean} [options.playlists]
 * @param {number} [options.ifOlderThan] skips parts synced more recently, in milliseconds
 * @param {boolean} [options.manual] started by the user, who sees failures and the result
 * @param {boolean} [options.waitForOtherWork] false skips the sync while other sync work runs
 * @returns {Promise<boolean>} whether the parts that ran succeeded; never rejects
 */
export async function syncWithYouTube({
  subscriptions = true,
  playlists = true,
  ifOlderThan = 0,
  manual = false,
  waitForOtherWork = true
} = {}) {
  // Until playlists and profiles load, they would all look new.
  if (!store.getters.getPlaylistsReady || store.getters.getProfileList.length === 0) return false

  let succeeded = true
  /**
   * @param {(account: YouTubeAccount) => Promise<void>} part
   * @param {YouTubeAccount} account
   */
  const run = async (part, account) => {
    try {
      await part(account)
    } catch (error) {
      succeeded = false
      if (error instanceof AccountChangedError) return
      console.error(error)
      if (manual) {
        showToast({
          message: i18n.global.t('Settings.YouTube Account Settings.Sync Failed', { error: errorMessage(error) }),
          icon: ERROR_TOAST_ICON
        })
      }
    }
  }

  await withSyncLock(async () => {
    const account = getSyncAccount()
    await run(removeUnsyncedPlaylists, account)
    if (!account) {
      succeeded = false
      return
    }
    const key = getYouTubeSyncKey(account)
    // Turning a sync on again starts over: subscriptions without the changes
    // from meanwhile, and both right away.
    const state = getSyncState(key)
    const reset = {
      ...(!store.getters.getYouTubeAccountSyncSubscriptions && state.subscriptionsSyncedAt !== 0 ? { subscriptions: null, subscriptionsSyncedAt: 0 } : {}),
      ...(!store.getters.getYouTubeAccountSyncPlaylists && state.playlistsSyncedAt !== 0 ? { playlistsSyncedAt: 0 } : {})
    }
    if (Object.keys(reset).length > 0) await run(() => updateSyncState(key, reset), account)

    const now = Date.now()
    if (subscriptions && store.getters.getYouTubeAccountSyncSubscriptions &&
      now - getSyncState(key).subscriptionsSyncedAt >= ifOlderThan) {
      await run(syncSubscriptions, account)
    }
    if (playlists && store.getters.getYouTubeAccountSyncPlaylists &&
      now - getSyncState(key).playlistsSyncedAt >= ifOlderThan) {
      await run(syncPlaylists, account)
    }
  }, !waitForOtherWork)

  return succeeded
}

/**
 * Before a subscription feed refreshes, brings in the channels subscribed to
 * or unsubscribed from on YouTube. Skipped while other sync work runs, so a
 * long playlist sync cannot hold up the feed.
 * @param {boolean} automatic
 * @returns {Promise<boolean> | null} null without subscription sync, so the refresh need not wait
 */
export function syncYouTubeSubscriptionsBeforeRefresh(automatic) {
  if (!store.getters.getYouTubeAccountSyncSubscriptions || !getSyncAccount()) return null
  return syncWithYouTube({ playlists: false, ifOlderThan: MIN_SYNC_INTERVAL_MS, manual: !automatic, waitForOtherWork: false })
}

/**
 * Playlists waiting to be read again, so opening one twice reads it once.
 * @type {Map<string, { restoreName: boolean }>}
 */
const pendingPlaylistRefreshes = new Map()

/**
 * Reads an opened synced playlist again, which also finds videos moved on YouTube.
 * @param {string} localId
 * @param {boolean} [restoreName] takes YouTube's name, after YouTube refused a rename
 */
export function refreshYouTubePlaylist(localId, restoreName = false) {
  const playlist = store.getters.getPlaylist(localId)
  const playlistId = playlist?.youTube?.playlistId
  if (!playlistId || !store.getters.getYouTubeAccountSyncPlaylists) return
  const pending = pendingPlaylistRefreshes.get(localId)
  if (pending) {
    pending.restoreName ||= restoreName
    return
  }
  const refresh = { restoreName }
  pendingPlaylistRefreshes.set(localId, refresh)

  withSyncLock(async () => {
    const account = getSyncAccount()
    if (!account || getYouTubeSyncKey(account) !== playlist.youTube.accountKey) return
    const summary = (await getSyncedPlaylistSummaries(account)).find(entry => entry.playlistId === playlistId)
    throwIfAccountChanged(account)
    // Deleted on YouTube, which the next sync handles.
    if (summary) await pullPlaylist(account, summary, true, refresh.restoreName)
  }).catch(error => {
    if (!(error instanceof AccountChangedError)) console.error(error)
  }).finally(() => pendingPlaylistRefreshes.delete(localId))
}

/**
 * Removes entries by their YouTube entries. Entries added here since the last
 * sync get theirs from the playlist first, as removing by video would also
 * remove the video's other entries.
 * @param {Extract<YouTubePlaylistChange, { type: 'remove' }>} change
 * @param {string} playlistId
 * @param {YouTubeAccount} account
 * @returns {Promise<object[]>}
 */
async function removalActions(change, playlistId, account) {
  let removed = change.videos
  if (removed.some(video => !video.youTubeSetVideoId)) {
    const { videos } = await getYouTubePlaylistVideos(playlistId, account)
    const resolved = new Map(resolveYouTubeSetVideoIds(change.playlist.videos, videos)
      .map(video => [video.playlistItemId, video.youTubeSetVideoId]))
    removed = removed.map(video => ({ ...video, youTubeSetVideoId: resolved.get(video.playlistItemId) ?? null }))
  }
  // Entries YouTube does not have need no removal.
  return removed
    .filter(video => video.youTubeSetVideoId)
    .map(video => ({ action: 'ACTION_REMOVE_VIDEO', setVideoId: video.youTubeSetVideoId }))
}

/**
 * @param {string} playlistId
 * @param {object[]} actions
 * @param {YouTubeAccount} account
 */
async function editInBatches(playlistId, actions, account) {
  for (let start = 0; start < actions.length; start += EDIT_BATCH_SIZE) {
    throwIfAccountChanged(account)
    await editYouTubePlaylist(playlistId, actions.slice(start, start + EDIT_BATCH_SIZE), account)
  }
}

/**
 * @param {Extract<YouTubePlaylistChange, { type: 'reorder' }>} change
 * @param {YouTubeAccount} account
 */
async function pushReorder(change, account) {
  const { playlistId } = change.playlist.youTube
  let current = change.previous.map(video => video.youTubeSetVideoId)
  let desired = change.playlist.videos
  // Without the order before, read the one YouTube has.
  if (current.length === 0 || current.some(id => !id) || desired.some(video => !video.youTubeSetVideoId)) {
    // Videos added here since the last sync need their YouTube entries to move.
    const { videos } = await getYouTubePlaylistVideos(playlistId, account)
    current = videos.map(video => video.setVideoId)
    desired = resolveYouTubeSetVideoIds(desired, videos)
  }
  const moves = planYouTubePlaylistMoves(
    current.filter(Boolean),
    desired.map(video => video.youTubeSetVideoId).filter(Boolean)
  )
  await editInBatches(playlistId, moves, account)
}

/**
 * @param {YouTubePlaylistChange} change
 * @param {string} playlistId the playlist on YouTube
 * @param {string} localId
 * @param {YouTubeAccount} account the sign-in and channel the playlist belongs to
 */
async function pushPlaylistChange(change, playlistId, localId, account) {
  throwIfAccountChanged(account)
  // Turned off while the edit waited for other sync work
  if (!store.getters.getYouTubeAccountSyncPlaylists) return
  const isLikedVideos = playlistId === LIKED_VIDEOS

  switch (change.type) {
    case 'add': {
      if (isLikedVideos) {
        for (const videoId of change.videoIds) await rateYouTubeVideo(videoId, 'LIKE', account)
        break
      }
      await editInBatches(playlistId, change.videoIds.map(videoId => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId })), account)
      // YouTube adds to the end, so a playlist that adds to the start here
      // moves them there.
      const current = store.getters.getPlaylist(localId)
      if (current?.addVideosToTop === true) {
        await pushReorder({ type: 'reorder', playlist: deepCopy(toRaw(current)), previous: [] }, account)
      }
      break
    }
    case 'remove':
      if (isLikedVideos) {
        for (const video of change.videos) await rateYouTubeVideo(video.videoId, 'INDIFFERENT', account)
      } else {
        await editInBatches(playlistId, await removalActions(change, playlistId, account), account)
      }
      break
    case 'reorder':
      if (!isLikedVideos) await pushReorder(change, account)
      break
    case 'details': {
      // YouTube names these itself, so their names here stay here.
      if (isLikedVideos || playlistId === WATCH_LATER) break
      const actions = []
      if (change.playlistName !== null) actions.push({ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: change.playlistName })
      if (change.description !== null) actions.push({ action: 'ACTION_SET_PLAYLIST_DESCRIPTION', playlistDescription: change.description })
      await editYouTubePlaylist(playlistId, actions, account)
      break
    }
    case 'delete':
      await deleteYouTubePlaylist(playlistId, account)
      break
  }
}

/** @param {YouTubePlaylistChange} change */
function handlePlaylistChange(change) {
  // Taken now, as the playlist can change before the edit goes out.
  const playlist = 'playlist' in change ? change.playlist : store.getters.getPlaylist(change.localId)
  const account = getSyncAccount()
  if (!playlist?.youTube || !account || !store.getters.getYouTubeAccountSyncPlaylists ||
    playlist.youTube.accountKey !== getYouTubeSyncKey(account)) return
  const { _id: localId, playlistName, youTube: { playlistId } } = playlist

  withSyncLock(() => pushPlaylistChange(change, playlistId, localId, account)).catch(error => {
    if (error instanceof AccountChangedError) return
    console.error(error)
    showToast({
      message: i18n.global.t('YouTube Account.Playlist Update Failed', { playlistName, error: errorMessage(error) }),
      icon: ERROR_TOAST_ICON
    })
    // Show what YouTube has instead of the edit it did not take.
    if (change.type === 'delete') {
      syncWithYouTube({ subscriptions: false })
    } else {
      refreshYouTubePlaylist(localId, change.type === 'details')
    }
  })
}

/** Whether new playlists can be created on YouTube too. */
export function canCreateYouTubePlaylists() {
  return store.getters.getYouTubeAccountSyncPlaylists && getSyncAccount() !== null
}

/**
 * Creates a private playlist on YouTube and saves it here.
 * @param {{ playlistName: string, description?: string, videos: { videoId: string }[] }} playlist
 * @returns {Promise<boolean>} whether the playlist was saved here
 */
export async function createYouTubePlaylistWithVideos(playlist) {
  const account = getSyncAccount()
  if (!account) throw new Error('Not signed in to a YouTube account')
  const result = await withSyncLock(async () => {
    const playlistId = await createYouTubePlaylist(playlist.playlistName, playlist.videos.map(video => video.videoId), account)
    try {
      if (playlist.description) {
        await editYouTubePlaylist(playlistId, [{ action: 'ACTION_SET_PLAYLIST_DESCRIPTION', playlistDescription: playlist.description }], account)
      }
      throwIfAccountChanged(account)
      /** @type {YouTubePlaylistLink} */
      const youTube = { playlistId, accountKey: getYouTubeSyncKey(account), title: playlist.playlistName, signature: null }
      if (!await store.dispatch('addPlaylist', { ...playlist, youTube })) throw new Error('Could not save the playlist')
      return true
    } catch (error) {
      // Without a copy here, trying again would create a second one.
      await deleteYouTubePlaylist(playlistId, account).catch(cleanupError => console.error(cleanupError))
      throw error
    }
  })
  return result === true
}

/**
 * Starts syncing once settings, profiles, and playlists have loaded, and again
 * whenever the sync settings, the sign-in, or the channel change.
 */
export function startYouTubeSync() {
  setYouTubePlaylistChangeListener(handlePlaylistChange)
  store.watch(
    () => [
      getYouTubeSyncKey(store.getters.getYouTubeAccount),
      store.getters.getYouTubeAccountSyncSubscriptions,
      store.getters.getYouTubeAccountSyncPlaylists
    ].join('\n'),
    () => syncWithYouTube({ ifOlderThan: MIN_SYNC_INTERVAL_MS })
  )
  syncWithYouTube({ ifOlderThan: STARTUP_SYNC_INTERVAL_MS })
}
