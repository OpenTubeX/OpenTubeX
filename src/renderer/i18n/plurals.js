// vue-i18n only knows two built-in pluralization patterns: "singular | plural"
// and "zero | singular | plural". Neither fits languages that group numbers
// differently, e.g. Polish needs "1 komentarz | 2 komentarze | 5 komentarzy",
// where the second form also covers 22 and 23, but not 12 and 13.
//
// Intl.PluralRules knows the correct grouping for every locale, so we use it to
// pick the form whenever a translation provides exactly one form per plural
// category. Translations that provide a different number of forms keep using
// vue-i18n's built-in rule, so partially updated locales are unaffected.

// The order translations are written in, as used by CLDR and Weblate.
const PLURAL_CATEGORY_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other']

// These messages are only shown for counts of at least two. Translations may
// therefore omit plural categories that cannot occur in that range, e.g. a
// Polish translation can provide "few | many" instead of "one | few | many".
export const MULTIPLE_ONLY_PLURAL_PATHS = [
  'Close Window Confirmation.Message',
  'Close Multiple Tabs Confirmation.Message',
  'Close Multiple Tabs Confirmation.Close Tabs',
  'Load Multiple Tabs Confirmation.Message',
  'Load Multiple Tabs Confirmation.Load Tabs',
  'Unload Multiple Tabs Confirmation.Message',
  'Unload Multiple Tabs Confirmation.Unload Tabs',
  'Context Menu.Close Multiple Tabs',
  'Context Menu.Duplicate Multiple Tabs'
]

// Categories are collected by sampling instead of using
// `resolvedOptions().pluralCategories`, because that also reports categories
// that only apply to fractions, which never occur in our counts.
const PLURAL_CATEGORY_SAMPLES = (() => {
  const samples = []

  // Every rule that groups small numbers is covered well before 200, e.g. Welsh
  // has a category that only applies to 6.
  for (let count = 0; count <= 200; count++) {
    samples.push(count)
  }

  // Some languages also have a category for large round numbers, e.g. French,
  // Spanish, Italian, Portuguese and Breton use "many" for whole millions.
  for (let exponent = 3; exponent <= 9; exponent++) {
    const power = 10 ** exponent

    samples.push(power, power * 2, power * 3)
  }

  return samples
})()

/**
 * The plural categories a locale uses for the counts we display, in the order translations write them.
 * @param {string} locale
 * @param {number} [minimum]
 * @returns {string[]}
 */
export function getPluralCategories(locale, minimum = 0) {
  const pluralRules = new Intl.PluralRules(locale)
  const categories = new Set(PLURAL_CATEGORY_SAMPLES
    .filter(count => count >= minimum)
    .map(count => pluralRules.select(count)))

  return PLURAL_CATEGORY_ORDER.filter(category => categories.has(category))
}

/**
 * Expand abbreviated multiple-only messages to the locale's complete plural layout.
 * @param {string} locale
 * @param {Record<string, unknown>} messages
 * @returns {Record<string, unknown>}
 */
export function expandMultipleOnlyPluralMessages(locale, messages) {
  const categories = getPluralCategories(locale)
  const multipleCategories = getPluralCategories(locale, 2)

  if (categories.length === multipleCategories.length) return messages

  for (const path of MULTIPLE_ONLY_PLURAL_PATHS) {
    const keys = path.split('.')
    const messageKey = keys.pop()
    let parent = messages

    for (const key of keys) {
      if (parent[key] == null || typeof parent[key] !== 'object') {
        parent = null
        break
      }
      parent = parent[key]
    }

    if (parent == null || typeof parent[messageKey] !== 'string') continue

    const forms = parent[messageKey].split(' | ')
    if (forms.length !== multipleCategories.length) continue

    const formsByCategory = new Map(multipleCategories.map((category, index) => [category, forms[index]]))
    parent[messageKey] = categories
      .map(category => formsByCategory.get(category) ?? forms[0])
      .join(' | ')
  }

  return messages
}

/**
 * Select a plural form without vue-i18n, for translations used in the main process.
 * @param {string} locale
 * @param {string} message
 * @param {number} choice
 * @returns {string | null}
 */
export function selectPluralForm(locale, message, choice) {
  const forms = message.split(' | ')
  if (forms.length === 1) return message

  const categories = getPluralCategories(locale)
  if (forms.length !== categories.length) return null

  return forms[categories.indexOf(new Intl.PluralRules(locale).select(Math.abs(choice)))] ?? null
}

/**
 * @param {string} locale
 * @returns {import('vue-i18n').PluralizationRule}
 */
function createPluralRule(locale) {
  const pluralRules = new Intl.PluralRules(locale)
  const categories = getPluralCategories(locale)

  return (choice, choicesLength, defaultRule) => {
    // Only translations that cover every category can be mapped reliably.
    if (choicesLength !== categories.length) {
      return defaultRule(choice, choicesLength)
    }

    const index = categories.indexOf(pluralRules.select(Math.abs(choice)))

    return index === -1 ? defaultRule(choice, choicesLength) : index
  }
}

/**
 * @param {string[]} locales
 * @returns {Record<string, import('vue-i18n').PluralizationRule>}
 */
export function createPluralRules(locales) {
  const rules = {}

  for (const locale of locales) {
    try {
      rules[locale] = createPluralRule(locale)
    } catch (error) {
      // Intl doesn't recognise the locale, so vue-i18n's built-in rule is used.
      console.error(`Unable to create plural rules for locale: "${locale}"`, error)
    }
  }

  return rules
}
