// replace with a Map after the Pinia migration
const state = {
  ytDlpDownloads: {}
}

const getters = {
  getYtDlpDownloads(state) {
    return state.ytDlpDownloads
  }
}

const actions = {}

const mutations = {
  /**
   * @param {object} state
   * @param {import('../../../main/ytDlp').YtDlpDownloadStatus} download
   */
  upsertYtDlpDownload(state, download) {
    state.ytDlpDownloads[download.id] = download
  },

  removeYtDlpDownload(state, id) {
    delete state.ytDlpDownloads[id]
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
