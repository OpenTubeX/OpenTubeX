import { MAIN_PROFILE_ID } from '../../constants'
import { showToast } from './utils'

export function translateProfileName(profile, t) {
  return profile._id === MAIN_PROFILE_ID ? t('Profile.All Channels') : profile.name
}

export function switchActiveProfile(store, profile, t) {
  if (profile._id === store.getters.getActiveProfile._id) return false

  store.commit('setActiveProfile', profile._id)
  showToast({
    message: t('Profile.{profile} is now the active profile', {
      profile: translateProfileName(profile, t)
    }),
    icon: ['fas', 'user-check']
  })
  return true
}
