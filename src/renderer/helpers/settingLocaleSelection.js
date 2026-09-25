/**
 * @param {string} preference
 * @param {string} systemLocale
 * @param {string[]} availableLocales
 * @returns {{ locale: string, unavailable: boolean }}
 */
export function resolveLocalePreference(preference, systemLocale, availableLocales) {
  if (preference !== 'system') return { locale: preference, unavailable: false }

  const systemLocaleName = systemLocale.replace('_', '-')
  const systemLanguage = systemLocaleName.split('-')[0]
  const candidates = availableLocales.filter(locale => locale.split('-')[0].includes(systemLanguage))
    .sort((a, b) => {
      if (a === systemLocaleName) return -1
      if (b === systemLocaleName) return 1
      if (a.split('-').length === 1) return -1
      if (b.split('-').length === 1) return 1
      return a.localeCompare(b)
    })
  return candidates.length > 0
    ? { locale: candidates[0], unavailable: false }
    : { locale: 'en-US', unavailable: true }
}

/** @param {string} locale @returns {string[]} */
export function getLocaleLoadSequence(locale) {
  const locales = ['en-US']
  if (locale === 'es-AR' || locale === 'es-MX') locales.push('es')
  if (locale === 'pt-PT' || locale === 'pt-BR') locales.push('pt')
  if (locale !== 'en-US') locales.push(locale)
  return locales
}
