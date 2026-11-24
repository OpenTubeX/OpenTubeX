import { splitInvidiousInstanceCredentials } from '../apiBackends.js'

/**
 * The removed per-channel Enable switches, each with the automatic saving
 * switch that only took effect while it was on.
 */
export const FORMER_CHANNEL_SETTING_SWITCHES = Object.freeze([
  ['rememberPlaybackSpeedPerChannel', 'autoUpdateChannelPlaybackSpeeds'],
  ['rememberVideoQualityPerChannel', 'autoUpdateChannelVideoQualities'],
  ['rememberSubtitlesStatePerChannel', 'autoUpdateChannelSubtitlesStates'],
  ['rememberVolumePerChannel', 'autoUpdateChannelVolumes'],
])

/** The Quick Settings defaults before they were reworked. */
const FORMER_DEFAULT_QUICK_SETTINGS = Object.freeze([
  'baseTheme',
  'mainColor',
  'uiScale',
  'thumbnailSize',
  'defaultQuality',
  'playNextVideo',
  'enableSubtitlesByDefault',
  'listType',
  'playlistViewType',
  'hideRecommendedVideos',
  'hideComments',
  'currentLocale',
  'region',
])

/**
 * Treats saved Quick Settings that exactly match the former defaults as never
 * customized, so they follow the current defaults. A list deliberately reset or
 * rearranged back to the former defaults also switches; that list is
 * indistinguishable from one that was never changed.
 * @param {unknown} value
 */
export function isFormerDefaultQuickSettings(value) {
  return Array.isArray(value) &&
    value.length === FORMER_DEFAULT_QUICK_SETTINGS.length &&
    value.every((id, index) => id === FORMER_DEFAULT_QUICK_SETTINGS[index])
}

/** Former switches and the selects that replaced them. */
const REPLACED_SETTING_IDS = new Map([
  ['hideVideoDescription', 'videoDescriptionMode'],
  ['limitTitlesToTwoLines', 'titleLineLimit'],
  ['holdToDoublePlaybackSpeed', 'holdPlaybackRateMultiplier'],
  ['thumbnailDataSaver', 'thumbnailDataSaverMode'],
  ['compactNavigationLabels', 'navigationBarLabels'],
])

/**
 * Replaces former switches in lists of setting ids, such as Quick Settings,
 * with the selects that replaced them.
 * @param {unknown} ids
 */
export function migrateSettingIds(ids) {
  return Array.isArray(ids)
    ? [...new Set(ids.map(id => REPLACED_SETTING_IDS.get(id) ?? id))]
    : ids
}

/** @param {unknown} ids */
export function hasReplacedSettingId(ids) {
  return Array.isArray(ids) && ids.some(id => REPLACED_SETTING_IDS.has(id))
}

/**
 * The Title Lines select that replaced the former Limit Titles to Two Lines
 * switch. 0 shows titles in full.
 * @param {unknown} enabled
 */
export function titleLineLimitFromSwitch(enabled) {
  return enabled === false ? 0 : 2
}

/**
 * The Hold to Speed Up multiplier that replaced the former Hold to Double
 * Playback Speed switch. 0 turns holding off.
 * @param {unknown} enabled
 */
export function holdPlaybackRateMultiplierFromSwitch(enabled) {
  return enabled === false ? 0 : 2
}

/**
 * The Data Saver Thumbnails mode that replaced the former switch.
 * @param {unknown} enabled
 */
export function thumbnailDataSaverModeFromSwitch(enabled) {
  return enabled === true ? 'always' : 'off'
}

/**
 * The Navigation Bar Labels select that replaced the former Compact Tab Labels
 * switch, which hid every label.
 * @param {unknown} enabled
 */
export function navigationBarLabelsFromCompactSwitch(enabled) {
  return enabled === true ? 'none' : 'all'
}

/** Apply the stored setting migrations shared by manual and scheduled backups. */
export async function migrateStoredSettings(datastore) {
  const save = (key, value) => datastore.updateAsync({ _id: key }, { _id: key, value }, { upsert: true })
  // Read every legacy key in one query: each lookup is a native round trip on mobile.
  const stored = new Map((await datastore.findAsync({
    _id: {
      $in: [
        'currentLocale', 'externalPlayerCustomArgs', 'defaultTheatreMode', 'saveWatchedProgress',
        'watchedProgressSavingMode', 'screenshotAskPath', 'quickSettings',
        'hideVideoDescription', 'videoDescriptionMode', 'syncServerSettingsExcluded',
        'scrollMiniPlayerEnabled', 'scrollMiniPlayerOnAllTabs', 'scrollPlayerMode',
        'limitTitlesToTwoLines', 'titleLineLimit', 'syncServerSettingUpdatedAt',
        'holdToDoublePlaybackSpeed', 'holdPlaybackRateMultiplier',
        'thumbnailDataSaver', 'thumbnailDataSaverMode', 'defaultInvidiousInstance',
        'compactNavigationLabels', 'navigationBarLabels',
        ...FORMER_CHANNEL_SETTING_SWITCHES.flat(),
      ]
    }
  })).map(setting => [setting._id, setting]))
  const currentLocale = stored.get('currentLocale')

  // In FreeTube 0.21.3 and earlier the locales 'en-GB', 'es-AR' and 'nb-NO' had underscores instead of a hyphens
  // This is a one time migration for users that are using one of those locales
  // Imported or synced values can have any type, and a throw here would block
  // every later settings read and write.
  if (typeof currentLocale?.value === 'string' && currentLocale.value.includes('_')) {
    await save('currentLocale', currentLocale.value.replace('_', '-'))
  }

  // In FreeTube 0.22.0 and earlier the external player arguments were displayed in a text box,
  // with the user manually entering `;` to separate the different arguments.
  // This is a one time migration that converts the old string to a JSON array
  const externalPlayerCustomArgs = stored.get('externalPlayerCustomArgs')

  if (typeof externalPlayerCustomArgs?.value === 'string' && !externalPlayerCustomArgs.value.startsWith('[')) {
    let newValue = '[]'

    if (externalPlayerCustomArgs.value.length > 0) {
      newValue = JSON.stringify(externalPlayerCustomArgs.value.split(';'))
    }

    await save('externalPlayerCustomArgs', newValue)
  }

  // In FreeTube 0.23.0, the "Enable Theatre Mode by Default" setting was incoporated as an option
  // of the "Default Viewing Mode" setting. This is a one time migration to preserve users'
  // Theater Mode preference through this change.
  const defaultTheatreMode = stored.get('defaultTheatreMode')

  if (defaultTheatreMode) {
    if (defaultTheatreMode.value) {
      await save('defaultViewingMode', 'theatre')
    }

    await datastore.removeAsync({ _id: 'defaultTheatreMode' })
  }

  const saveWatchedProgress = stored.get('saveWatchedProgress')
  const watchedProgressSavingMode = stored.get('watchedProgressSavingMode')
  if (saveWatchedProgress && !watchedProgressSavingMode) {
    if (!saveWatchedProgress.value) {
      await save('watchedProgressSavingMode', 'never')
    }

    await datastore.removeAsync({ _id: 'saveWatchedProgress' })
  }

  // In FreeTube 0.24.0, the "Screenshot Mode" setting only had two options that were represented as a toggle named "Ask path"
  // This is a one time migration to preserve users' Screenshot prompt preference through this change.
  const screenshotAskPath = stored.get('screenshotAskPath')

  if (screenshotAskPath) {
    await save('screenshotMode', screenshotAskPath.value ? 'prompt_folder' : 'default_folder')
    await datastore.removeAsync({ _id: 'screenshotAskPath' })
  }

  // Saved channel settings no longer have their own Enable switches. Automatic saving
  // only ran while its switch was on, so turn it off where the switch was off.
  for (const [rememberKey, autoUpdateKey] of FORMER_CHANNEL_SETTING_SWITCHES) {
    const remember = stored.get(rememberKey)
    if (!remember) continue

    if (remember.value !== true && stored.get(autoUpdateKey)?.value === true) {
      await save(autoUpdateKey, false)
    }
    await datastore.removeAsync({ _id: rememberKey })
  }

  // Hide Video Description became the Video Descriptions select, collapsed by default.
  const hideVideoDescription = stored.get('hideVideoDescription')
  if (hideVideoDescription) {
    if (hideVideoDescription.value === true && !stored.has('videoDescriptionMode')) {
      await save('videoDescriptionMode', 'hide')
    }
    await datastore.removeAsync({ _id: 'hideVideoDescription' })
  }
  // Limit Titles to Two Lines became the Title Lines select, two lines by default.
  const limitTitlesToTwoLines = stored.get('limitTitlesToTwoLines')
  if (limitTitlesToTwoLines) {
    if (!stored.has('titleLineLimit')) {
      await save('titleLineLimit', titleLineLimitFromSwitch(limitTitlesToTwoLines.value))
    }
    await datastore.removeAsync({ _id: 'limitTitlesToTwoLines' })
  }
  // Hold to Double Playback Speed became the Hold to Speed Up multiplier.
  const holdToDoublePlaybackSpeed = stored.get('holdToDoublePlaybackSpeed')
  if (holdToDoublePlaybackSpeed) {
    if (holdToDoublePlaybackSpeed.value === false && !stored.has('holdPlaybackRateMultiplier')) {
      await save('holdPlaybackRateMultiplier', 0)
    }
    await datastore.removeAsync({ _id: 'holdToDoublePlaybackSpeed' })
  }
  // The Data Saver Thumbnails switch became a select that can also follow metered networks.
  const thumbnailDataSaver = stored.get('thumbnailDataSaver')
  if (thumbnailDataSaver) {
    if (thumbnailDataSaver.value === true && !stored.has('thumbnailDataSaverMode')) {
      await save('thumbnailDataSaverMode', 'always')
    }
    await datastore.removeAsync({ _id: 'thumbnailDataSaver' })
  }
  // Compact Tab Labels became the Navigation Bar Labels select, which can also
  // show only the current page's label.
  const compactNavigationLabels = stored.get('compactNavigationLabels')
  if (compactNavigationLabels) {
    if (compactNavigationLabels.value === true && !stored.has('navigationBarLabels')) {
      await save('navigationBarLabels', 'none')
    }
    await datastore.removeAsync({ _id: 'compactNavigationLabels' })
  }
  // Keep Playing When Navigating Away now also decides whether switching tabs
  // shows the mini player, and scrolling past the player always pins it when
  // there is room.
  for (const key of ['scrollMiniPlayerOnAllTabs', 'scrollMiniPlayerEnabled', 'scrollPlayerMode']) {
    if (stored.has(key)) await datastore.removeAsync({ _id: key })
  }
  // Older versions saved an Invidious instance's credentials in its URL, which
  // exports and sync include. They are a secret setting now, which
  // migrateSecretSettings encrypts next.
  const { instance, credentials } = splitInvidiousInstanceCredentials(stored.get('defaultInvidiousInstance')?.value)
  if (credentials) {
    await save('invidiousInstanceCredentials', credentials)
    await save('defaultInvidiousInstance', instance)
  }
  // Selects derived from a switch keep its sync edit time, so a newer choice from
  // another device still wins over an edit made here before the upgrade.
  const updatedAt = stored.get('syncServerSettingUpdatedAt')?.value
  if (updatedAt && typeof updatedAt === 'object') {
    const missing = [...REPLACED_SETTING_IDS].filter(([from, to]) => Object.hasOwn(updatedAt, from) && !Object.hasOwn(updatedAt, to))
    if (missing.length > 0) {
      await save('syncServerSettingUpdatedAt', { ...updatedAt, ...Object.fromEntries(missing.map(([from, to]) => [to, updatedAt[from]])) })
    }
  }
  for (const key of ['quickSettings', 'syncServerSettingsExcluded']) {
    const ids = stored.get(key)?.value
    if (hasReplacedSettingId(ids)) {
      await save(key, migrateSettingIds(ids))
    }
  }

  if (isFormerDefaultQuickSettings(stored.get('quickSettings')?.value)) {
    await datastore.removeAsync({ _id: 'quickSettings' })
  }
}
