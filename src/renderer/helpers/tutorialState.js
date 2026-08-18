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

function removeLocalStorage(key) {
  try {
    localStorage.removeItem(key)
  } catch (error) {
    console.error(`Failed to remove ${key}`, error)
  }
}

export function getTutorialAudience(persistedAudience) {
  return readLocalStorage(TUTORIAL_AUDIENCE_STORAGE_KEY) ?? persistedAudience ?? null
}

export async function setTutorialAudience(audience) {
  writeLocalStorage(TUTORIAL_AUDIENCE_STORAGE_KEY, audience)
  try {
    await DBSettingHandlers.upsert(TUTORIAL_AUDIENCE_SETTING_ID, audience)
  } catch (error) {
    console.error('Failed to persist the tutorial audience', error)
  }
}

export async function clearTutorialAudience() {
  removeLocalStorage(TUTORIAL_AUDIENCE_STORAGE_KEY)
  try {
    await DBSettingHandlers.delete(TUTORIAL_AUDIENCE_SETTING_ID)
  } catch (error) {
    console.error('Failed to clear the persisted tutorial audience', error)
  }
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
