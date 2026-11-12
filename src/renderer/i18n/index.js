import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import { createWebURL } from '../helpers/utils'
import { createPluralRules, expandMultipleOnlyPluralMessages } from './plurals'
import { composeLocaleMessages, resolveMessagesWithFallback } from '../../localeComposition'
// List of locales approved for use
import activeLocales from '../../../static/locales/activeLocales.json'

export const localeTranslationPercentages = ref(process.env.LOCALE_TRANSLATION_PERCENTAGES)

const aiLocales = new Set(process.env.AI_LOCALES ?? [])
const humanMessages = new Map()
const aiMessages = new Map()
const humanRequests = new Map()
const aiRequests = new Map()
const requestedLocales = new Set()
let aiTranslationCompletionsEnabled = false
let compositionRevision = 0

const i18n = createI18n({
  locale: 'en-US',
  legacy: false,
  fallbackLocale: {
    // https://vue-i18n.intlify.dev/guide/essentials/fallback.html

    // es-AR -> es -> en-US
    'es-AR': ['es'],
    // es-MX -> es -> en-US
    'es-MX': ['es'],
    // pt-BR -> pt -> en-US
    'pt-BR': ['pt'],
    // pt-PT -> pt -> en-US
    'pt-PT': ['pt'],
    // any -> en-US
    default: ['en-US'],
  },
  pluralRules: createPluralRules(activeLocales)
})

/**
 * @param {string} locale
 * @param {'human' | 'ai'} source
 */
async function fetchLocaleMessages(locale, source) {
  const directory = source === 'ai' ? 'locales/ai' : 'locales'
  const extension = process.env.IS_ELECTRON && process.env.NODE_ENV !== 'development'
    ? 'json.br'
    : 'json'
  const url = createWebURL(`/static/${directory}/${locale}.${extension}`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Unable to load ${source} locale "${locale}": ${response.status}`)
  }

  return await response.json()
}

/** @param {string} locale */
function loadHumanMessages(locale) {
  if (humanMessages.has(locale)) return Promise.resolve(humanMessages.get(locale))
  if (humanRequests.has(locale)) return humanRequests.get(locale)

  const request = fetchLocaleMessages(locale, 'human')
    .then((messages) => {
      if (humanRequests.get(locale) !== request) return humanMessages.get(locale) ?? messages

      humanRequests.delete(locale)
      humanMessages.set(locale, messages)
      return messages
    })
    .catch((error) => {
      if (humanRequests.get(locale) !== request) {
        return humanMessages.get(locale) ?? Promise.reject(error)
      }

      humanRequests.delete(locale)
      throw error
    })
  humanRequests.set(locale, request)
  return request
}

/** @param {string} locale */
function loadAIMessages(locale) {
  if (!aiLocales.has(locale)) return Promise.resolve(null)
  if (aiMessages.has(locale)) return Promise.resolve(aiMessages.get(locale))
  if (aiRequests.has(locale)) return aiRequests.get(locale)

  const request = fetchLocaleMessages(locale, 'ai')
    .then((messages) => {
      if (aiRequests.get(locale) !== request) return aiMessages.get(locale) ?? messages

      aiRequests.delete(locale)
      aiMessages.set(locale, messages)
      return messages
    })
    .catch((error) => {
      if (aiRequests.get(locale) !== request) return aiMessages.get(locale) ?? null

      aiRequests.delete(locale)
      console.error(error)
      return null
    })
  aiRequests.set(locale, request)
  return request
}

/** @param {string} locale */
function getBaseLocale(locale) {
  const baseLocale = locale.split('-')[0]
  return baseLocale !== locale && activeLocales.includes(baseLocale) ? baseLocale : null
}

/** @param {string} locale */
async function recomposeLocale(locale) {
  while (true) {
    const revision = compositionRevision
    const includeAI = aiTranslationCompletionsEnabled
    const baseLocale = getBaseLocale(locale)
    const localesToLoad = baseLocale ? [locale, baseLocale] : [locale]

    await Promise.all(localesToLoad.map(loadHumanMessages))
    if (includeAI) await Promise.all(localesToLoad.map(loadAIMessages))

    if (revision !== compositionRevision) continue

    const messages = composeLocaleMessages({
      locale,
      humanMessages,
      aiMessages,
      includeAI,
    })
    i18n.global.setLocaleMessage(locale, expandMultipleOnlyPluralMessages(locale, messages))
    return
  }
}

/**
 * Apply the persisted AI-completion preference to every catalog used by the
 * current renderer. A revision check prevents a slower, older request from
 * winning when the setting is toggled quickly.
 *
 * @param {boolean} enabled
 */
export async function setAITranslationCompletionsEnabled(enabled) {
  aiTranslationCompletionsEnabled = enabled === true
  compositionRevision += 1
  await Promise.all([...requestedLocales].map(recomposeLocale))
}

const STARTUP_LOCALE_KEY = 'opentubex-startup-locale'

/**
 * Starts loading the English fallback and the locale of the last launch, so
 * they arrive while the settings that name the locale are still being read.
 */
export function preloadStartupLocales() {
  let locale = null
  try {
    locale = localStorage.getItem(STARTUP_LOCALE_KEY)
  } catch {
    // Storage can be unavailable; the locale then loads once the settings did.
  }

  const locales = new Set(['en-US'])
  if (activeLocales.includes(locale)) {
    locales.add(locale)
    const baseLocale = getBaseLocale(locale)
    if (baseLocale) locales.add(baseLocale)
  }

  for (const locale of locales) {
    // `loadLocale` reports a failed request when it waits for the same one.
    loadHumanMessages(locale).catch(() => {})
    loadAIMessages(locale)
  }
}

/** @param {string} locale */
export function rememberStartupLocale(locale) {
  try {
    localStorage.setItem(STARTUP_LOCALE_KEY, locale)
  } catch {
    // Startup still works when storage is unavailable.
  }
}

export async function loadLocale(locale) {
  if (!activeLocales.includes(locale)) {
    console.error(`Unable to load unknown locale: "${locale}"`)
    return
  }

  requestedLocales.add(locale)
  await recomposeLocale(locale)
}

/**
 * Like `tm`, but with the en-US fallback that `t` applies to each message, so
 * lists built from a message subtree match the labels the app renders.
 *
 * @param {string} key
 */
export function tmWithFallback(key) {
  const { locale, getLocaleMessage } = i18n.global
  return resolveMessagesWithFallback([getLocaleMessage(locale.value), getLocaleMessage('en-US')], key)
}

// Set by _scripts/ProcessLocalesPlugin.js
if (process.env.HOT_RELOAD_LOCALES) {
  const websocket = new WebSocket(`ws://${window.location.host}/ws`)

  websocket.onmessage = (event) => {
    const message = JSON.parse(event.data)

    if (message.type === 'freetube-locale-update') {
      const source = message.data.source ?? 'human'
      if (source === 'human' && message.data.translationPercentages) {
        localeTranslationPercentages.value = message.data.translationPercentages
      }

      for (const [locale, data] of message.data.locales) {
        const target = source === 'ai' ? aiMessages : humanMessages
        const requests = source === 'ai' ? aiRequests : humanRequests
        requests.delete(locale)
        target.set(locale, JSON.parse(data))
      }

      compositionRevision += 1
      Promise.all([...requestedLocales].map(recomposeLocale)).catch(console.error)
    }
  }
}

export default i18n
