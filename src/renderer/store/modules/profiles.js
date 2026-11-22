import { toRaw } from 'vue'

import { MAIN_PROFILE_ID, THEME_BG_COLOR, THEME_TEXT_COLOR } from '../../../constants'
import { DBProfileHandlers, getDataScope, setDataScope } from '../../../datastores/handlers/index'
import { getProfileWithUpdatedSubscriptionDetails } from '../../helpers/subscription-profile-details'
import { copySubscriptionChannelSettings, getChannelWithUpdatedSettings, getNextSubscriptionSettingsTimestamp, isValidSubscriptionSettingsTimestamp, normalizeSubscriptionChannelSettings } from '../../helpers/subscription-channels'
import { DEFAULT_PROFILE_ICON } from '../../helpers/profileIcons'
import { profileSyncSnapshot } from '../../helpers/profileSyncSnapshot'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../helpers/restricted-playback'
import { forgetWatchQueueScope } from './watch-queue'
import { settleScopedActions } from '../../helpers/dataScopeActions'
import { trackDataScopeLoad } from '../../helpers/sync-data-scope.js'

const state = {
  profileList: [{
    _id: MAIN_PROFILE_ID,
    name: 'All Channels',
    bgColor: THEME_BG_COLOR,
    textColor: THEME_TEXT_COLOR,
    icon: { ...DEFAULT_PROFILE_ICON },
    subscriptions: []
  }],
  profilesLoaded: false,
  activeProfile: MAIN_PROFILE_ID
}

/**
 * Combines the settings of a channel that several profiles with their own
 * subscriptions follow, so that background refreshes fetch every feed type
 * one of them shows and notify about every upload one of them asks for.
 */
function mergeRootChannelSettings(channel, other) {
  const a = normalizeSubscriptionChannelSettings(channel)
  const b = normalizeSubscriptionChannelSettings(other)
  // Hidden feed types never notify, so each profile only adds the types it shows.
  const notifies = settings => settings.notificationFeedTypes.filter(type => settings.feedTypes.includes(type))
  return {
    ...channel,
    feedTypes: [...new Set([...a.feedTypes, ...b.feedTypes])],
    notificationFeedTypes: [...new Set([...notifies(a), ...notifies(b)])],
    showMembersOnly: a.showMembersOnly || b.showMembersOnly
  }
}

/**
 * The root profile of the given profile, or of the active one, and the
 * profiles that share its subscriptions, or `null` if it no longer exists.
 * @param {object} getters
 * @param {string} [profileId]
 */
function getSubscriptionScope(getters, profileId) {
  const root = profileId === undefined ? getters.getSubscriptionRootProfile : getters.profileById(profileId)
  if (root == null) return null
  const profiles = root.separate === true
    ? [root]
    : getters.getProfileList.filter(profile => profile.separate !== true)
  return { root, profiles }
}

const getters = {
  getProfileList: (state) => {
    return state.profileList
  },

  getActiveProfile: (state) => {
    const activeProfileId = state.activeProfile
    return state.profileList.find((profile) => {
      return profile._id === activeProfileId
    })
  },

  profileById: (state) => (id) => {
    return state.profileList.find(p => p._id === id)
  },

  /**
   * The separate profile whose history, playlists, search history, watch
   * stats and watch queue the app shows, or null for the data that the other
   * profiles share.
   * @returns {string | null}
   */
  getActiveDataScope: (state, getters) => {
    return getters.getActiveProfile?.separate === true ? state.activeProfile : null
  },

  /**
   * The profile that holds every channel the active profile can show: a
   * separate profile itself, otherwise the all channels profile, which is
   * always the first profile in the array.
   */
  getSubscriptionRootProfile: (state, getters) => {
    return getters.getActiveProfile?.separate === true ? getters.getActiveProfile : state.profileList[0]
  },

  /** The profiles that share subscriptions and data with the active profile */
  getDataScopeProfiles: (state, getters) => {
    return getters.getActiveDataScope === null
      ? state.profileList.filter(profile => profile.separate !== true)
      : [getters.getActiveProfile]
  },

  /**
   * The subscriptions of the all channels profile and of every separate
   * profile, for work done for every profile, such as notifications and
   * keeping cached feeds
   */
  getAllRootSubscriptions: (state) => {
    const roots = state.profileList.filter((profile, index) => index === 0 || profile.separate === true)
    if (roots.length === 1) return roots[0].subscriptions
    const channels = new Map()
    for (const profile of roots) {
      for (const channel of profile.subscriptions) {
        const known = channels.get(channel.id)
        channels.set(channel.id, known === undefined ? channel : mergeRootChannelSettings(known, channel))
      }
    }
    return [...channels.values()]
  },

  /** Every profile's subscriptions by channel, for feeds refreshed for all of them */
  getAllRootSubscriptionsById: (state, getters) => {
    return new Map(getters.getAllRootSubscriptions.map(channel => [channel.id, channel]))
  },

  getSubscribedChannelIdSet: (state, getters) => {
    return getters.getSubscriptionRootProfile.subscriptions.reduce((set, channel) => set.add(channel.id), new Set())
  },

  /** Lets every subscribe button answer membership without scanning the active profile */
  getActiveSubscribedChannelIdSet: (state, getters) => {
    return getters.getActiveProfile.subscriptions.reduce((set, channel) => set.add(channel.id), new Set())
  },

  /** Cached subscription details, so channel ids can be resolved to names without a network request */
  getSubscribedChannelsById: (state, getters) => {
    return new Map(getters.getSubscriptionRootProfile.subscriptions.map((channel) => [channel.id, channel]))
  },

  /** Channels whose members-only videos are shown, which also requires authenticated playback */
  getMembersOnlyChannelIdSet: (state, getters) => {
    if (!hasConfiguredRestrictedPlaybackAuthentication(getters)) return new Set()

    // Channel settings are kept in sync across the profiles that share
    // subscriptions, so their root profile has them all
    return new Set(getters.getSubscriptionRootProfile.subscriptions
      .filter(channel => channel.showMembersOnly === true)
      .map(channel => channel.id))
  },
}

const collator = new Intl.Collator(undefined, {
  usage: 'sort',
  caseFirst: 'upper',
  sensitivity: 'case',
  numeric: true
})

function profileSort(a, b) {
  if (a._id === MAIN_PROFILE_ID) return -1
  if (b._id === MAIN_PROFILE_ID) return 1

  const nameA = a.name.normalize('NFC')
  const nameB = b.name.normalize('NFC')

  return collator.compare(nameA, nameB)
}

/**
 * A data scope whose data failed to load, so loading it again reads it
 * instead of keeping the empty state.
 * @type {string | null | undefined}
 */
let incompleteDataScope

const actions = {
  async grabAllProfiles({ rootState, commit, state }, defaultName = null) {
    let profiles
    try {
      profiles = await DBProfileHandlers.find()
    } catch (errMessage) {
      console.error(errMessage)
      return null
    }

    if (!Array.isArray(profiles)) return null

    if (profiles.length === 0) {
      // Create a default profile and persist it
      const defaultProfile = {
        _id: MAIN_PROFILE_ID,
        name: defaultName,
        bgColor: THEME_BG_COLOR,
        textColor: THEME_TEXT_COLOR,
        icon: { ...DEFAULT_PROFILE_ICON },
        subscriptions: []
      }

      try {
        await DBProfileHandlers.create(defaultProfile)
        commit('setProfileList', [defaultProfile])
      } catch (errMessage) {
        console.error(errMessage)
        return null
      }

      return false
    }

    // We want the primary profile to always be first
    // So sort with that then sort alphabetically by profile name
    profiles = profiles.sort(profileSort)

    if (state.profileList.length < profiles.length) {
      const profile = profiles.find((profile) => {
        return profile._id === rootState.settings.defaultProfile
      })

      if (profile) {
        commit('setActiveProfile', profile._id)
      }
    }

    commit('setProfileList', profiles)
    return true
  },

  async batchUpdateSubscriptionDetails({ commit, state }, channels) {
    if (channels.length === 0) { return true }
    // Skip the main-process round trip when no synced profile would change.
    // Before profiles load, only the datastore knows the subscriptions.
    if (state.profilesLoaded && toRaw(state.profileList).every(profile => getProfileWithUpdatedSubscriptionDetails(toRaw(profile), channels) === null)) {
      return true
    }

    try {
      const { profileIds, success } = await DBProfileHandlers.updateSubscriptionDetails(channels)
      if (profileIds.length > 0) commit('updateSubscriptionDetails', { channels, profileIds })
      return success
    } catch (error) {
      console.error(error)
      return false
    }
  },

  async updateSubscriptionDetails({ dispatch }, channel) {
    return dispatch('batchUpdateSubscriptionDetails', [channel])
  },

  /**
   * @param {{ channelId: string, settings: object }[] | { updates: { channelId: string, settings: object }[], profileId?: string }} payload
   * the updates, optionally with the root profile they were made in
   */
  async batchUpdateChannelSettings({ commit, getters }, payload) {
    const { updates, profileId } = Array.isArray(payload) ? { updates: payload, profileId: undefined } : payload
    if (updates.length === 0) return true
    const scope = getSubscriptionScope(getters, profileId)
    if (scope === null) return false
    const subscribedIds = new Set(scope.root.subscriptions.map(channel => channel.id))
    const availableUpdates = updates.filter(({ channelId }) => subscribedIds.has(channelId))
    if (availableUpdates.length === 0) return false
    const channelIds = new Set(availableUpdates.map(({ channelId }) => channelId))
    const profiles = scope.profiles
      .filter(profile => profile.subscriptions.some(channel => channelIds.has(channel.id)))
    const subscriptionsByChannelId = new Map([...channelIds].map(channelId => [channelId, []]))
    for (const profile of profiles) {
      for (const channel of profile.subscriptions) {
        subscriptionsByChannelId.get(channel.id)?.push(channel)
      }
    }
    try {
      const patches = availableUpdates.map(({ channelId, settings }) => ({
        channelId,
        settings,
        updatedAt: getNextSubscriptionSettingsTimestamp(subscriptionsByChannelId.get(channelId))
      }))
      const profileIds = profiles.map(profile => profile._id)
      const updatedProfileIds = await DBProfileHandlers.batchUpdateChannelSettings(patches, profileIds)
      if (!Array.isArray(updatedProfileIds)) return false
      if (updatedProfileIds.length > 0) {
        commit('updateChannelSettings', { updates: patches, profileIds: updatedProfileIds })
      }
      return availableUpdates.length === updates.length && updatedProfileIds.length === profileIds.length
    } catch (error) {
      console.error(error)
      return false
    }
  },

  async updateChannelSettings({ commit, getters }, { channelId, settings, fromSync = false, updatedAt, profileId }) {
    if (fromSync && !isValidSubscriptionSettingsTimestamp(updatedAt)) return false

    // Sync and queued edits update the profiles of the scope they were made
    // for, not the active one.
    const scope = getSubscriptionScope(getters, profileId)
    const primarySubscription = scope?.root.subscriptions.find(channel => channel.id === channelId)
    if (primarySubscription === undefined) return false

    const profiles = scope.profiles
      .filter(profile => profile.subscriptions.some(subscription => subscription.id === channelId))
    try {
      const editTimestamp = fromSync
        ? updatedAt
        : getNextSubscriptionSettingsTimestamp(profiles.map(profile => (
            profile.subscriptions.find(subscription => subscription.id === channelId)
          )))
      const channel = getChannelWithUpdatedSettings(primarySubscription, settings, editTimestamp)
      const profileIds = profiles.map(profile => profile._id)
      const updatedProfileIds = await DBProfileHandlers.updateChannelSettings(channel, profileIds)
      if (!Array.isArray(updatedProfileIds)) return false

      if (updatedProfileIds.length > 0) {
        commit('updateChannelSettings', { channel, profileIds: updatedProfileIds })
      }
      return updatedProfileIds.length === profileIds.length
    } catch (error) {
      console.error(error)
      return false
    }
  },

  async createProfile({ commit }, profile) {
    try {
      const newProfile = await DBProfileHandlers.create(profile)
      commit('addProfileToList', newProfile)
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  /** Adds imported channels and icon to a profile, keeping changes made meanwhile */
  async mergeImportedProfile({ commit }, profile) {
    try {
      commit('upsertProfileToList', await DBProfileHandlers.mergeImported(profile))
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  async updateProfile({ commit }, profile) {
    try {
      await DBProfileHandlers.upsert(profile)
      commit('upsertProfileToList', profile)
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  /** Saves the name, colors, and icon, keeping subscriptions that changed elsewhere */
  async updateProfileDetails({ commit }, { profileId, details }) {
    try {
      await DBProfileHandlers.updateDetails(profileId, details)
      commit('updateProfileDetails', { profileId, details })
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  /**
   * Saves a profile from sync unless it changed since `previous`, here or in
   * the datastore. `previous` is null for a profile this device did not have.
   * @returns {Promise<boolean>} false when the profile changed meanwhile
   */
  async saveSyncedProfile({ commit, state }, { profile, previous }) {
    const current = state.profileList.find(item => item._id === profile._id)
    if (previous === null ? current !== undefined : current === undefined || profileSyncSnapshot(current) !== profileSyncSnapshot(previous)) {
      return false
    }
    const saved = await DBProfileHandlers.saveFromSyncIfUnchanged(profile, previous)
    if (saved === null) return false
    commit('upsertProfileToList', saved)
    return true
  },

  /** Replaces subscriptions unless they changed since `previous`, here or in the datastore */
  async updateProfileSubscriptionsFromSync({ commit, state }, { profileId, subscriptions, previous }) {
    const current = state.profileList.find(profile => profile._id === profileId)
    if (JSON.stringify(current?.subscriptions) !== JSON.stringify(previous)) return false
    const profile = await DBProfileHandlers.updateSubscriptionsIfUnchanged(profileId, subscriptions, previous)
    if (profile === null) return false
    commit('upsertProfileToList', profile)
    return true
  },

  async addChannelToProfiles({ commit }, { channel, profileIds }) {
    // If this is an Invidious URL, convert it to a YouTube one
    // Imported channels may have no thumbnail
    if (typeof channel.thumbnail === 'string' && !channel.thumbnail.startsWith('https://yt3.googleusercontent.com/')) {
      channel.thumbnail = channel.thumbnail.replace(/^https?:\/\/[^/]+\/ggpht/, 'https://yt3.googleusercontent.com')
    }

    try {
      await DBProfileHandlers.addChannelToProfiles(channel, profileIds)
      commit('addChannelToProfiles', { channel, profileIds })
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  async removeChannelFromProfiles({ commit, dispatch }, { channelIds, profileIds }) {
    try {
      await DBProfileHandlers.removeChannelFromProfiles(channelIds, profileIds)
      commit('removeChannelFromProfiles', { channelIds, profileIds })

      if (profileIds.includes(MAIN_PROFILE_ID)) {
        try {
          await dispatch('updateYtDlpAutomaticDownloadRules', value => {
            const rules = JSON.parse(value || '{}')
            if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) return value
            for (const channelId of channelIds) delete rules[channelId]
            return JSON.stringify(rules)
          })
        } catch (error) {
          console.error('Failed to remove automatic download settings for the unsubscribed channel', error)
        }
      }
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  async removeProfile({ commit, dispatch, getters, rootState }, profileId) {
    try {
      const separate = getters.profileById(profileId)?.separate === true
      await DBProfileHandlers.delete(profileId)
      commit('removeProfileFromList', profileId)
      // The datastores delete the rest of its data. The profile is gone even
      // if its queue or statistics reset can't be deleted.
      if (separate) {
        await forgetWatchQueueScope(profileId).catch(error => console.error(error))
        if (rootState.settings?.syncServerScopedWatchStatsResets?.[profileId]) {
          await dispatch('updateWatchStatsReset', { scope: profileId, reset: null }).catch(error => console.error(error))
        }
      }
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  updateActiveProfile({ commit }, id) {
    commit('setActiveProfile', id)
  },

  /**
   * Shows the history, playlists, search history, watch stats, watch queue
   * and recommendations of the active profile's data scope, after switching
   * to or from a separate profile.
   */
  async loadDataScope({ dispatch, commit, getters, rootGetters }) {
    if (getters.getActiveDataScope === getDataScope() && incompleteDataScope !== getDataScope()) return
    // Sync waits until the store shows this profile's data.
    const scope = await trackDataScopeLoad((async () => {
      let load = false
      // Writes that already started finish in the data they started in, as
      // their later requests would otherwise reach this profile's data. The
      // switch follows the last one before another can start.
      const scope = await settleScopedActions(() => {
        const scope = getters.getActiveDataScope
        load = scope !== getDataScope() || scope === incompleteDataScope
        if (!load) return scope
        setDataScope(scope)
        incompleteDataScope = undefined
        // Until the load replaces them, the previous profile's data must not
        // show here, or be marked as watched in this profile's history.
        commit('setHistoryCacheSorted', [])
        commit('setHistoryCacheById', {})
        commit('setAllPlaylists', [])
        commit('setPlaylistsReady', false)
        commit('setSearchHistoryEntries', [])
        commit('clearWatchStats')
        return scope
      })
      if (!load) return scope
      const hadRecommendations = rootGetters.getRecommendationEpoch !== null
      commit('clearRecommendationState')
      const loaded = await Promise.all([
        dispatch('grabHistory'),
        dispatch('grabAllPlaylists'),
        dispatch('grabSearchHistoryEntries', { replace: true }),
        dispatch('loadWatchQueueScope', scope),
        rootGetters.getEnableWatchStats ? dispatch('grabWatchStats') : null,
        hadRecommendations ? dispatch('loadRecommendations') : null,
      ])
      // A failed read leaves that data empty, and the next load reads it again.
      if (scope === getDataScope() && loaded.includes(false)) incompleteDataScope = scope
      return scope
    })())
    if (scope === getDataScope()) await dispatch('applySyncServerDataScope')
  },
}

function withDefaultProfileIcon(profile) {
  return profile._id === MAIN_PROFILE_ID && profile.icon == null
    ? { ...profile, icon: { ...DEFAULT_PROFILE_ICON } }
    : profile
}

const mutations = {
  setProfileList(state, profileList) {
    state.profileList = profileList.map(withDefaultProfileIcon)
    state.profilesLoaded = true
  },

  setActiveProfile(state, activeProfile) {
    state.activeProfile = activeProfile
  },

  addProfileToList(state, profile) {
    state.profileList.push(withDefaultProfileIcon(profile))
    state.profileList.sort(profileSort)
  },

  upsertProfileToList(state, updatedProfile) {
    const i = state.profileList.findIndex((p) => {
      return p._id === updatedProfile._id
    })

    if (i === -1) {
      state.profileList.push(withDefaultProfileIcon(updatedProfile))
    } else {
      state.profileList.splice(i, 1, withDefaultProfileIcon(updatedProfile))
    }

    state.profileList.sort(profileSort)
  },

  addChannelToProfiles(state, { channel, profileIds }) {
    for (const id of profileIds) {
      const profile = state.profileList.find(profile => profile._id === id)
      if (!profile) { continue }

      if (!profile.subscriptions.some(subscription => subscription.id === channel.id)) {
        profile.subscriptions.push(channel)
      }
    }
  },

  removeChannelFromProfiles(state, { channelIds, profileIds }) {
    for (const id of profileIds) {
      const profile = state.profileList.find(profile => profile._id === id)
      if (!profile) { continue }

      // use filter instead of splice in case the subscription appears multiple times
      // https://github.com/FreeTubeApp/FreeTube/pull/3468#discussion_r1179290877
      profile.subscriptions = profile.subscriptions.filter(channel => !channelIds.includes(channel.id))
    }
  },

  updateProfileDetails(state, { profileId, details: { name, bgColor, textColor, icon } }) {
    const profile = state.profileList.find(profile => profile._id === profileId)
    if (!profile) return

    Object.assign(profile, { name, bgColor, textColor, icon: withDefaultProfileIcon({ _id: profileId, icon }).icon })
    state.profileList.sort(profileSort)
  },

  updateChannelSettings(state, { channel, updates, profileIds }) {
    const updatesById = new Map(updates?.map(update => [update.channelId, update]))
    for (const id of profileIds) {
      const profile = state.profileList.find(profile => profile._id === id)
      if (!profile) continue

      profile.subscriptions = profile.subscriptions.map(subscription => {
        const update = updatesById.get(subscription.id)
        if (update) {
          return getChannelWithUpdatedSettings(subscription, update.settings, update.updatedAt, true)
        }
        return subscription.id === channel?.id ? copySubscriptionChannelSettings(subscription, channel) : subscription
      })
    }
  },

  updateSubscriptionDetails(state, { channels, profileIds }) {
    for (const id of profileIds) {
      const profile = state.profileList.find(profile => profile._id === id)
      if (!profile) continue

      // Raw records keep reactive proxies out of the copied subscription list.
      const updatedProfile = getProfileWithUpdatedSubscriptionDetails(toRaw(profile), channels)
      if (updatedProfile !== null) profile.subscriptions = updatedProfile.subscriptions
    }
  },

  removeProfileFromList(state, profileId) {
    const i = state.profileList.findIndex((profile) => {
      return profile._id === profileId
    })

    if (i !== -1) {
      state.profileList.splice(i, 1)
    }
    // Other windows and server sync delete profiles too, so every deletion
    // keeps the active profile valid here.
    if (state.activeProfile === profileId) {
      state.activeProfile = MAIN_PROFILE_ID
    }
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
