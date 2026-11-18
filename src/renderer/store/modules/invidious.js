import { base64EncodeUtf8, createWebURL, fetchWithTimeout, randomArrayItem } from '../../helpers/utils'
import { createYatteeAuthorization } from '../../helpers/api/yattee'
import { getInvidiousInstanceCredentials, normalizeInvidiousInstanceUrl, normalizeYatteeServerUrl, splitInvidiousInstanceCredentials } from '../../../apiBackends'

const state = {
  currentInvidiousInstance: '',
  currentInvidiousInstanceUrl: '',
  invidiousInstancesList: null
}

const getters = {
  getCurrentInvidiousInstance(state) {
    return state.currentInvidiousInstance
  },

  getCurrentInvidiousInstanceUrl(state) {
    return state.currentInvidiousInstanceUrl
  },

  /** Only the instance the saved credentials belong to receives them. */
  getCurrentInvidiousInstanceAuthorization(state, _getters, rootState) {
    const credentials = getInvidiousInstanceCredentials(rootState.settings.invidiousInstanceCredentials, state.currentInvidiousInstanceUrl)
    return credentials && `Basic ${base64EncodeUtf8(`${credentials.username}:${credentials.password}`)}`
  },

  getInvidiousInstancesList(state) {
    return state.invidiousInstancesList
  },

  /** The server that Invidious-compatible API requests go to. */
  getApiServerUrl(state, _getters, rootState) {
    return rootState.settings.backendPreference === 'yattee'
      ? normalizeYatteeServerUrl(rootState.settings.yatteeServerUrl)
      : state.currentInvidiousInstanceUrl
  },

  getApiServerAuthorization(_state, getters, rootState) {
    const { backendPreference, yatteeUsername, yatteePassword } = rootState.settings
    return backendPreference === 'yattee'
      ? createYatteeAuthorization(yatteeUsername, yatteePassword)
      : getters.getCurrentInvidiousInstanceAuthorization
  }
}

const actions = {
  async fetchInvidiousInstancesFromFile({ commit }) {
    // The Docker image proxies its own Invidious server on the app's origin
    if (process.env.SELF_HOSTED_INVIDIOUS) {
      commit('setInvidiousInstancesList', [window.location.origin])
      return
    }

    const url = createWebURL('/static/invidious-instances.json')

    const fileData = await (await fetch(url)).json()
    const instances = fileData.filter(e => {
      // The browser extension for the local API doesn't lift CORS for Invidious
      return process.env.IS_ELECTRON || process.env.IS_CAPACITOR || e.cors
    }).map(e => {
      return e.url
    })

    commit('setInvidiousInstancesList', instances)
  },

  /// fetch invidious instances from site and overwrite static file.
  async fetchInvidiousInstances({ commit }) {
    // Don't contact the public instance directory or offer its instances
    if (process.env.SELF_HOSTED_INVIDIOUS) return

    const requestUrl = 'https://api.invidious.io/instances.json'
    try {
      const response = await fetchWithTimeout(15_000, requestUrl)
      const json = await response.json()
      const instances = json.filter((instance) => {
        return !(instance[0].includes('.onion') ||
          instance[0].includes('.i2p') ||
          !instance[1].api ||
          (!process.env.IS_ELECTRON && !process.env.IS_CAPACITOR && !instance[1].cors))
      }).map((instance) => {
        return instance[1].uri.replace(/\/$/, '')
      })

      if (instances.length !== 0) {
        commit('setInvidiousInstancesList', instances)
      } else {
        console.warn('using static file for invidious instances')
      }
    } catch (err) {
      if (err.name === 'TimeoutError') {
        console.error('Fetching the Invidious instance list timed out after 15 seconds. Falling back to local copy.')
      } else {
        console.error(err)
      }
    }
  },

  setRandomCurrentInvidiousInstance({ commit, state }) {
    const instanceList = state.invidiousInstancesList
    commit('setCurrentInvidiousInstance', randomArrayItem(instanceList))
  }
}

const mutations = {
  setCurrentInvidiousInstance(state, value) {
    // The credentials are a separate setting, so the address never shows them.
    const { instance } = splitInvidiousInstanceCredentials(value)
    state.currentInvidiousInstance = instance
    state.currentInvidiousInstanceUrl = normalizeInvidiousInstanceUrl(instance)
  },

  setInvidiousInstancesList(state, value) {
    state.invidiousInstancesList = value
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
