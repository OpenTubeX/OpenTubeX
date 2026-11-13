import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { ERROR_TOAST_ICON, showToast } from '../helpers/utils'
import { selectYouTubeProfile } from '../helpers/api/youtube-account'

// Shared, so a switch from one place blocks starting another elsewhere.
const switching = ref(false)

/** Switches the YouTube channel and reports the outcome in a toast. */
export function useYouTubeProfileSwitch() {
  const { t } = useI18n()

  /** @param {import('../helpers/api/youtube-account-parsers').YouTubeProfile} profile */
  async function switchProfile(profile) {
    if (switching.value) return
    switching.value = true
    try {
      if (await selectYouTubeProfile(profile.pageId)) {
        showToast({ message: t('Settings.YouTube Account Settings.Using Channel', { name: profile.name }), icon: ['fas', 'circle-user'] })
      }
    } catch (error) {
      console.error(error)
      showToast({
        message: t('Settings.YouTube Account Settings.Switch Channel Failed', { error: error?.message ?? String(error) }),
        icon: ERROR_TOAST_ICON
      })
    } finally {
      switching.value = false
    }
  }

  return { switching, switchProfile }
}
