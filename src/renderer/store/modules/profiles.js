import { MAIN_PROFILE_ID, THEME_BG_COLOR, THEME_TEXT_COLOR } from '../../../constants'
import { DBProfileHandlers } from '../../../datastores/handlers/index'
import { getProfileWithUpdatedSubscriptionDetails } from '../../helpers/subscription-profile-details'
import { copySubscriptionChannelSettings, getChannelWithUpdatedSettings, getNextSubscriptionSettingsTimestamp } from '../../helpers/subscription-channels'
import { DEFAULT_PROFILE_ICON } from '../../helpers/profileIcons'

const state = {
  profileList: [{
    _id: MAIN_PROFILE_ID,
    name: 'All Channels',
    bgColor: THEME_BG_COLOR,
    textColor: THEME_TEXT_COLOR,
    icon: { ...DEFAULT_PROFILE_ICON },
    subscriptions: []
  }],
  activeProfile: MAIN_PROFILE_ID
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

  getSubscribedChannelIdSet: (state) => {
    // The all channels profile is always the first profile in the array
    const mainProfile = state.profileList[0]

    return mainProfile.subscriptions.reduce((set, channel) => set.add(channel.id), new Set())
  },

  /** Cached subscription details, so channel ids can be resolved to names without a network request */
  getSubscribedChannelsById: (state) => {
    // The all channels profile is always the first profile in the array
    const mainProfile = state.profileList[0]

    return new Map(mainProfile.subscriptions.map((channel) => [channel.id, channel]))
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

  async batchUpdateSubscriptionDetails({ commit }, channels) {
    if (channels.length === 0) { return true }

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

  async batchUpdateChannelSettings({ commit, state }, updates) {
    if (updates.length === 0) return true
    const subscriptionsById = new Map(state.profileList[0].subscriptions.map(channel => [channel.id, channel]))
    const availableUpdates = updates.filter(({ channelId }) => subscriptionsById.has(channelId))
    if (availableUpdates.length === 0) return false
    const channelIds = new Set(availableUpdates.map(({ channelId }) => channelId))
    const profiles = state.profileList
      .filter(profile => profile.subscriptions.some(channel => channelIds.has(channel.id)))
    const subscriptionsByChannelId = new Map([...channelIds].map(channelId => [channelId, []]))
    for (const profile of profiles) {
      for (const channel of profile.subscriptions) {
        subscriptionsByChannelId.get(channel.id)?.push(channel)
      }
    }
    const patches = availableUpdates.map(({ channelId, settings }) => ({
      channelId,
      settings,
      updatedAt: getNextSubscriptionSettingsTimestamp(subscriptionsByChannelId.get(channelId))
    }))
    const profileIds = profiles.map(profile => profile._id)
    try {
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

  async updateChannelSettings({ commit, state }, { channelId, settings, fromSync = false, updatedAt }) {
    if (fromSync && (!Number.isFinite(updatedAt) || updatedAt < 0)) return false

    const primarySubscription = state.profileList[0].subscriptions
      .find(channel => channel.id === channelId)
    if (primarySubscription === undefined) return false

    const profiles = state.profileList
      .filter(profile => profile.subscriptions.some(subscription => subscription.id === channelId))
    const editTimestamp = fromSync
      ? updatedAt
      : getNextSubscriptionSettingsTimestamp(profiles.map(profile => (
          profile.subscriptions.find(subscription => subscription.id === channelId)
        )))
    const channel = getChannelWithUpdatedSettings(primarySubscription, settings, editTimestamp)
    const profileIds = profiles.map(profile => profile._id)

    try {
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
    } catch (errMessage) {
      console.error(errMessage)
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

  async addChannelToProfiles({ commit }, { channel, profileIds }) {
    // If this is an Invidious URL, convert it to a YouTube one
    if (!channel.thumbnail.startsWith('https://yt3.googleusercontent.com/')) {
      channel.thumbnail = channel.thumbnail.replace(/^https?:\/\/[^/]+\/ggpht/, 'https://yt3.googleusercontent.com')
    }

    try {
      await DBProfileHandlers.addChannelToProfiles(channel, profileIds)
      commit('addChannelToProfiles', { channel, profileIds })
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async removeChannelFromProfiles({ commit, dispatch }, { channelId, profileIds }) {
    try {
      await DBProfileHandlers.removeChannelFromProfiles(channelId, profileIds)
      commit('removeChannelFromProfiles', { channelId, profileIds })

      if (profileIds.includes(MAIN_PROFILE_ID)) {
        try {
          await dispatch('updateYtDlpAutomaticDownloadRules', value => {
            const rules = JSON.parse(value || '{}')
            if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) return value
            delete rules[channelId]
            return JSON.stringify(rules)
          })
        } catch (error) {
          console.error('Failed to remove automatic download settings for the unsubscribed channel', error)
        }
      }
    } catch (errMessage) {
      console.error(errMessage)
    }
  },

  async removeProfile({ commit }, profileId) {
    try {
      await DBProfileHandlers.delete(profileId)
      commit('removeProfileFromList', profileId)
      return true
    } catch (errMessage) {
      console.error(errMessage)
      return false
    }
  },

  updateActiveProfile({ commit }, id) {
    commit('setActiveProfile', id)
  }
}

function withDefaultProfileIcon(profile) {
  return profile._id === MAIN_PROFILE_ID && profile.icon == null
    ? { ...profile, icon: { ...DEFAULT_PROFILE_ICON } }
    : profile
}

const mutations = {
  setProfileList(state, profileList) {
    state.profileList = profileList.map(withDefaultProfileIcon)
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

  removeChannelFromProfiles(state, { channelId, profileIds }) {
    for (const id of profileIds) {
      const profile = state.profileList.find(profile => profile._id === id)
      if (!profile) { continue }

      // use filter instead of splice in case the subscription appears multiple times
      // https://github.com/FreeTubeApp/FreeTube/pull/3468#discussion_r1179290877
      profile.subscriptions = profile.subscriptions.filter(channel => channel.id !== channelId)
    }
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

      const updatedProfile = getProfileWithUpdatedSubscriptionDetails(profile, channels)
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
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
