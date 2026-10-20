/** Apply the stored setting migrations shared by manual and scheduled backups. */
export async function migrateStoredSettings(datastore) {
  const save = (key, value) => datastore.updateAsync({ _id: key }, { _id: key, value }, { upsert: true })
  // Read every legacy key in one query: each lookup is a native round trip on mobile.
  const stored = new Map((await datastore.findAsync({
    _id: {
      $in: [
        'currentLocale', 'externalPlayerCustomArgs', 'defaultTheatreMode', 'saveWatchedProgress',
        'watchedProgressSavingMode', 'screenshotAskPath',
      ]
    }
  })).map(setting => [setting._id, setting]))
  const currentLocale = stored.get('currentLocale')

  // In FreeTube 0.21.3 and earlier the locales 'en-GB', 'es-AR' and 'nb-NO' had underscores instead of a hyphens
  // This is a one time migration for users that are using one of those locales
  if (currentLocale?.value.includes('_')) {
    await save('currentLocale', currentLocale.value.replace('_', '-'))
  }

  // In FreeTube 0.22.0 and earlier the external player arguments were displayed in a text box,
  // with the user manually entering `;` to separate the different arguments.
  // This is a one time migration that converts the old string to a JSON array
  const externalPlayerCustomArgs = stored.get('externalPlayerCustomArgs')

  if (externalPlayerCustomArgs && !externalPlayerCustomArgs.value.startsWith('[')) {
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
}
