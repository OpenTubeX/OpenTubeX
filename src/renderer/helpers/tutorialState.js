import { DBSettingHandlers } from '../../datastores/handlers/index'

export const TUTORIAL_AUDIENCE_STORAGE_KEY = 'opentubex.tutorial.audience'
export const TUTORIAL_AUDIENCE_SETTING_ID = 'tutorialAudience'
export const LAST_USED_VERSION_SETTING_ID = 'lastUsedVersion'

function readLocalStorage(key) {
  try {
    return localStorage.getItem(key)
  } catch (error) {
    console.error(`Failed to read ${key}`, error)
    return null
  }
}

function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    console.error(`Failed to save ${key}`, error)
  }
}

export function getTutorialAudience(persistedAudience) {
  const localAudience = readLocalStorage(TUTORIAL_AUDIENCE_STORAGE_KEY)
  if (localAudience === 'completed' || persistedAudience === 'completed') return 'completed'
  return localAudience ?? persistedAudience ?? null
}

export async function setTutorialAudience(audience) {
  writeLocalStorage(TUTORIAL_AUDIENCE_STORAGE_KEY, audience)
  try {
    await DBSettingHandlers.upsert(TUTORIAL_AUDIENCE_SETTING_ID, audience)
  } catch (error) {
    console.error('Failed to persist the tutorial audience', error)
  }
}

export async function markTutorialCompleted() {
  await setTutorialAudience('completed')
}

export function getLastUsedVersion(persistedVersion) {
  return readLocalStorage('opentubex.lastUsedVersion') ?? persistedVersion ?? null
}

export async function setLastUsedVersion(version) {
  writeLocalStorage('opentubex.lastUsedVersion', version)
  try {
    await DBSettingHandlers.upsert(LAST_USED_VERSION_SETTING_ID, version)
  } catch (error) {
    console.error('Failed to persist the last used app version', error)
  }
}
