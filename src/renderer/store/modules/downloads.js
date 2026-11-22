import { toRaw } from 'vue'
import { isDownloadPlaybackSupported, localPlaybackDownloadIds } from '../../helpers/downloadPlayback.js'

/** The fields of a download that decide which download plays a video locally. */
function playbackSignature(download) {
  if (!download || !isDownloadPlaybackSupported(download)) return ''
  return JSON.stringify([download.mode, (download.files ?? []).map(file => [
    file.videoId, file.extension, file.path, file.available
  ])])
}

// replace with a Map after the Pinia migration
const state = {
  ytDlpDownloads: {},
  // Progress updates arrive several times per second, so the playback index
  // only rebuilds when a download's playable files change.
  localPlaybackRevision: 0,
  ytDlpDownloadsLoaded: false
}

const getters = {
  getYtDlpDownloads(state) {
    return state.ytDlpDownloads
  },

  getLocalPlaybackDownloadIds(state) {
    // Track only the revision: progress updates replace downloads without
    // changing which files play locally.
    state.localPlaybackRevision // eslint-disable-line no-unused-expressions
    return localPlaybackDownloadIds(toRaw(state.ytDlpDownloads))
  }
}

const actions = {}

const mutations = {
  /**
   * @param {object} state
   * @param {import('../../../main/ytDlp').YtDlpDownloadStatus} download
   */
  upsertYtDlpDownload(state, download) {
    const previous = toRaw(state.ytDlpDownloads)[download.id]
    if (playbackSignature(previous) !== playbackSignature(download)) state.localPlaybackRevision++
    state.ytDlpDownloads[download.id] = download
  },

  removeYtDlpDownload(state, id) {
    if (playbackSignature(toRaw(state.ytDlpDownloads)[id]) !== '') state.localPlaybackRevision++
    delete state.ytDlpDownloads[id]
  },

  setYtDlpDownloadsLoaded(state) {
    state.ytDlpDownloadsLoaded = true
  }
}

export default {
  state,
  getters,
  actions,
  mutations
}
