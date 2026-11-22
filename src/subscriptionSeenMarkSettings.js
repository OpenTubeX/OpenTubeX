// @ts-check
import { profileDatastorePrefix } from './datastores/profileDatastoreNames.js'

/**
 * The seen marks of subscription feeds that each separate profile keeps for
 * itself. RSS feeds are the same in every profile, so their marks are shared.
 */
export const SCOPED_SEEN_MARK_SETTINGS = ['subscriptionSeenVideos', 'subscriptionSeenPosts']

/**
 * The ID of the setting that holds a data scope's seen marks.
 * @param {string} setting One of {@link SCOPED_SEEN_MARK_SETTINGS}
 * @param {string | null} scope A separate profile's ID, or null for the shared marks
 */
export function seenMarksSettingId(setting, scope) {
  return scope === null ? setting : `${setting}.${profileDatastorePrefix(scope)}`
}

/**
 * Which seen marks a setting holds, for a window that shows a data scope.
 * @param {unknown} settingId
 * @param {string | null} scope The data scope the window shows
 * @returns {string | null | undefined} the setting the marks of `scope` use,
 *   null for the marks of another scope, or undefined for other settings
 */
export function shownSeenMarksSetting(settingId, scope) {
  if (typeof settingId !== 'string') return undefined
  const setting = SCOPED_SEEN_MARK_SETTINGS.find(setting => settingId === setting || settingId.startsWith(`${setting}.`))
  if (setting === undefined) return undefined
  return settingId === seenMarksSettingId(setting, scope) ? setting : null
}

/**
 * Whether a setting holds a separate profile's seen marks.
 * @param {unknown} settingId
 */
export function isSeparateProfileSeenMarksSetting(settingId) {
  return shownSeenMarksSetting(settingId, null) === null
}
