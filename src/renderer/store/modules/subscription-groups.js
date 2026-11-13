import i18n from '../../i18n/index'
import {
  filterSubscriptionsByGroup,
  normalizeChannelIds,
  normalizeSubscriptionGroups,
  sortSubscriptionGroups
} from '../../helpers/subscription-groups'

// The selected group is a view preference of this device, so it is not synced.
const ACTIVE_GROUP_STORAGE_KEY = 'Subscriptions/activeGroup'

// Blocked site storage throws, which must not break loading the store.
function readActiveGroupId() {
  try {
    return localStorage.getItem(ACTIVE_GROUP_STORAGE_KEY)
  } catch (error) {
    console.error(`Failed to read ${ACTIVE_GROUP_STORAGE_KEY}`, error)
    return null
  }
}

function saveActiveGroupId(groupId) {
  try {
    if (groupId === null) {
      localStorage.removeItem(ACTIVE_GROUP_STORAGE_KEY)
    } else {
      localStorage.setItem(ACTIVE_GROUP_STORAGE_KEY, groupId)
    }
  } catch (error) {
    console.error(`Failed to save ${ACTIVE_GROUP_STORAGE_KEY}`, error)
  }
}

const state = {
  activeSubscriptionGroupId: readActiveGroupId()
}

const getters = {
  /** @returns {import('../../helpers/subscription-groups').SubscriptionGroup[]} */
  getSubscriptionGroupList: (_state, _getters, rootState) => {
    const collator = new Intl.Collator([i18n.global.locale.value, 'en'], { sensitivity: 'base', numeric: true })
    return sortSubscriptionGroups(normalizeSubscriptionGroups(rootState.settings.subscriptionGroups), collator)
  },

  getActiveSubscriptionGroup: (state, getters) => {
    return getters.getSubscriptionGroupList.find(group => group.id === state.activeSubscriptionGroupId) ?? null
  },

  /** Subscriptions of the active profile, limited to the active group */
  getActiveGroupSubscriptions: (_state, getters) => {
    return filterSubscriptionsByGroup(getters.getActiveProfile.subscriptions, getters.getActiveSubscriptionGroup)
  },

  getSubscribedChannelsCustomOrderList: (_state, _getters, rootState) => {
    return normalizeChannelIds(rootState.settings.subscribedChannelsCustomOrder)
  },
}

const actions = {
  selectSubscriptionGroup({ commit }, groupId) {
    commit('setActiveSubscriptionGroupId', groupId)
  },

  /**
   * @param {Omit<import('../../helpers/subscription-groups').SubscriptionGroup, 'id'>} group
   * @returns {Promise<string | null>} the new group's ID
   */
  async createSubscriptionGroup({ dispatch }, group) {
    const id = crypto.randomUUID()
    const saved = await dispatch('updateSubscriptionGroups', groups => [...normalizeSubscriptionGroups(groups), { id, ...group }])
    return saved ? id : null
  },

  /** @param {import('../../helpers/subscription-groups').SubscriptionGroup} group */
  saveSubscriptionGroup({ dispatch }, group) {
    // Another device can delete the group while it is being edited. Saving then
    // restores it with the edits.
    return dispatch('updateSubscriptionGroups', value => {
      const groups = normalizeSubscriptionGroups(value)
      return groups.some(existing => existing.id === group.id)
        ? groups.map(existing => existing.id === group.id ? group : existing)
        : [...groups, group]
    })
  },

  async deleteSubscriptionGroup({ commit, dispatch, state }, groupId) {
    const saved = await dispatch('updateSubscriptionGroups', groups => normalizeSubscriptionGroups(groups).filter(group => {
      return group.id !== groupId
    }))
    if (saved && state.activeSubscriptionGroupId === groupId) commit('setActiveSubscriptionGroupId', null)
    return saved
  },

  // Changes only this channel in the saved groups, so another window's edits stay
  setChannelInSubscriptionGroup({ dispatch }, { groupId, channelId, included }) {
    return dispatch('updateSubscriptionGroups', groups => normalizeSubscriptionGroups(groups).map(group => {
      if (group.id !== groupId || group.channelIds.includes(channelId) === included) return group
      return {
        ...group,
        channelIds: included
          ? [...group.channelIds, channelId]
          : group.channelIds.filter(id => id !== channelId),
      }
    }))
  },
}

const mutations = {
  setActiveSubscriptionGroupId(state, groupId) {
    state.activeSubscriptionGroupId = groupId
    saveActiveGroupId(groupId)
  },
}

export default {
  state,
  getters,
  actions,
  mutations
}
