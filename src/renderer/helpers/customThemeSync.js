import { CUSTOM_THEMES_SYNC_KEY } from '../../customTheme.js'

export async function commitCustomThemesEdit({ commit, dispatch }, themes) {
  await dispatch('recordSyncSettingEdit', CUSTOM_THEMES_SYNC_KEY)
  commit('setCustomThemes', themes)
}
