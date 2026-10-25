import { app } from 'electron'
import path from 'path'
import asyncFs from 'fs/promises'
import { promisify } from 'util'
import { brotliDecompress } from 'zlib'
import { load as loadYaml } from 'js-yaml'

import * as baseHandlers from '../datastores/handlers/base'
import { composeLocaleMessages } from '../localeComposition'
import { expandMultipleOnlyPluralMessages, selectPluralForm } from '../renderer/i18n/plurals'

const brotliDecompressAsync = promisify(brotliDecompress)

/**
 * @param {string} key
 * @param {Record<string, unknown>} messages
 * @returns {string | undefined}
 */
function getLocaleMessage(key, messages) {
  const value = key.split('.').reduce((current, segment) => {
    return current != null && typeof current === 'object' ? current[segment] : undefined
  }, messages)

  return typeof value === 'string' ? value : undefined
}

/**
 * @param {string} locale
 * @param {'human' | 'ai'} source
 * @returns {Promise<Record<string, unknown>>}
 */
async function loadLocaleMessages(locale, source = 'human') {
  const directory = source === 'ai' ? 'locales/ai' : 'locales'
  const localePath = process.env.NODE_ENV === 'development'
    ? path.resolve(__dirname, `../../static/${directory}`, `${locale}.yaml`)
    : path.resolve(__dirname, `static/${directory}`, `${locale}.json.br`)

  if (process.env.NODE_ENV === 'development') {
    const contents = await asyncFs.readFile(localePath, 'utf8')
    return loadYaml(contents)
  }

  const contents = await asyncFs.readFile(localePath)
  const decompressed = await brotliDecompressAsync(contents)
  return JSON.parse(decompressed.toString('utf8'))
}

/**
 * Translates native dialogs, menus and tray items with the app's current
 * locale, outside of any renderer.
 * @returns {Promise<(key: string, parameters?: Record<string, string | number>, pluralChoice?: number) => string>}
 */
export async function createMainTranslator() {
  const fallbackLocale = 'en-US'
  const storedLocale = (await baseHandlers.settings._findOne('currentLocale'))?.value
  const storedAITranslationPreference = (await baseHandlers.settings._findOne('useAITranslationCompletions'))?.value
  const useAITranslationCompletions = storedAITranslationPreference == null
    ? true
    : storedAITranslationPreference === true
  const currentLocale = typeof storedLocale === 'string' && storedLocale !== 'system'
    ? storedLocale
    : app.getLocale().replace('_', '-')

  const baseLocale = currentLocale.split('-')[0]
  const candidateLocales = [...new Set([currentLocale, baseLocale, fallbackLocale].filter(Boolean))]
  const humanMessages = new Map()
  const aiMessages = new Map()

  for (const locale of candidateLocales) {
    try {
      humanMessages.set(locale, await loadLocaleMessages(locale))
    } catch (error) {
      if (locale === fallbackLocale) {
        console.error('Failed to load fallback locale for close confirmation dialog:', error)
      }
    }
  }

  if (useAITranslationCompletions) {
    for (const locale of [currentLocale, baseLocale]) {
      if (!locale || aiMessages.has(locale)) continue
      try {
        aiMessages.set(locale, await loadLocaleMessages(locale, 'ai'))
      } catch {
        // Complete locales do not have an AI overlay.
      }
    }
  }

  const messagesByLocale = []
  const currentMessages = composeLocaleMessages({
    locale: currentLocale,
    humanMessages,
    aiMessages,
    includeAI: useAITranslationCompletions,
  })
  if (Object.keys(currentMessages).length > 0) {
    messagesByLocale.push({
      locale: currentLocale,
      messages: expandMultipleOnlyPluralMessages(currentLocale, currentMessages),
    })
  }

  if (currentLocale !== fallbackLocale && humanMessages.has(fallbackLocale)) {
    messagesByLocale.push({
      locale: fallbackLocale,
      messages: expandMultipleOnlyPluralMessages(fallbackLocale, humanMessages.get(fallbackLocale)),
    })
  }

  return (key, parameters = {}, pluralChoice) => {
    for (const { locale, messages } of messagesByLocale) {
      const message = getLocaleMessage(key, messages)
      if (message) {
        const selectedMessage = pluralChoice == null
          ? message
          : selectPluralForm(locale, message, pluralChoice)

        if (selectedMessage == null) continue

        return Object.entries(parameters).reduce(
          (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
          selectedMessage
        )
      }
    }

    return key
  }
}
