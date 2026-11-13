import activeLocales from '../static/locales/activeLocales.json'

/**
 * The app locale that the "System" language setting uses for a system locale,
 * such as `de-DE` for `de`, or `null` if the language isn't available.
 * @param {string} systemLocale such as `en_US`, `en-US` or `de`
 * @returns {string | null}
 */
export function resolveSystemLocale(systemLocale) {
  const systemLocaleName = systemLocale.replace('_', '-') // ex: en-US
  const systemLanguage = systemLocaleName.split('-')[0] // ex: en
  const options = activeLocales.filter((locale) => {
    // filter out other languages
    return locale.split('-')[0] === systemLanguage
  }).sort((aLocaleName, bLocaleName) => {
    const aLocale = aLocaleName.split('-') // ex: [en, US]
    const bLocale = bLocaleName.split('-')

    if (aLocaleName === systemLocaleName) { // country & language match, prefer a
      return -1
    } else if (bLocaleName === systemLocaleName) { // country & language match, prefer b
      return 1
    } else if (aLocale.length === 1) { // no country code for a, prefer a
      return -1
    } else if (bLocale.length === 1) { // no country code for b, prefer b
      return 1
    } else { // a & b have different country code from system, sort alphabetically
      return aLocaleName.localeCompare(bLocaleName)
    }
  })

  return options[0] ?? null
}
