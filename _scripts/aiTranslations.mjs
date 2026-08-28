#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dump as dumpYaml, load as loadYaml } from 'js-yaml'
import { isMap, parseDocument } from 'yaml'

import { getPluralCategories, MULTIPLE_ONLY_PLURAL_PATHS } from '../src/renderer/i18n/plurals.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const LOCALES_DIR = resolve(SCRIPT_DIR, '../static/locales')
const AI_LOCALES_DIR = join(LOCALES_DIR, 'ai')
const SOURCE_LOCALE = 'en-US'
const EXCLUDED_LOCALES = new Set([SOURCE_LOCALE, 'de-DE'])
const PLURAL_SEPARATOR = ' | '
const PLACEHOLDER_PATTERN = /\{[^{}]+\}/g
const MULTIPLE_ONLY_PATHS = new Set(MULTIPLE_ONLY_PLURAL_PATHS.map(path => path.replaceAll('.', '\0')))

function readYaml(path) {
  return loadYaml(readFileSync(path, 'utf8')) ?? {}
}

function activeLocales() {
  return JSON.parse(readFileSync(join(LOCALES_DIR, 'activeLocales.json'), 'utf8'))
}

function eligibleLocales() {
  return activeLocales().filter(locale => !EXCLUDED_LOCALES.has(locale))
}

function flattenStrings(value, path = [], output = new Map()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenStrings(child, [...path, key], output)
    }
  } else if (typeof value === 'string' && value.length > 0) {
    output.set(path.join('\0'), value)
  }

  return output
}

function unflattenStrings(values) {
  const output = {}

  for (const [flatPath, value] of values) {
    const path = flatPath.split('\0')
    const leaf = path.pop()
    let parent = output

    for (const key of path) parent = parent[key] ??= {}
    parent[leaf] = value
  }

  return output
}

function sourceStrings() {
  const strings = flattenStrings(readYaml(join(LOCALES_DIR, `${SOURCE_LOCALE}.yaml`)))
  strings.delete('Locale Name')
  return strings
}

function missingSourceStrings(locale) {
  const source = sourceStrings()
  const human = flattenStrings(readYaml(join(LOCALES_DIR, `${locale}.yaml`)))

  return new Map([...source].filter(([path]) => !human.has(path)))
}

function sourceFormForCategory(sourceForms, category) {
  if (sourceForms.length === 1) return sourceForms[0]
  if (sourceForms.length === 2) return sourceForms[category === 'one' ? 0 : 1]
  if (sourceForms.length === 3) {
    if (category === 'zero') return sourceForms[0]
    if (category === 'one') return sourceForms[1]
    return sourceForms[2]
  }

  throw new Error(`Unsupported English plural with ${sourceForms.length} forms`)
}

function expandPluralSkeleton(locale, path, value) {
  const sourceForms = value.split(PLURAL_SEPARATOR)
  const multipleOnly = MULTIPLE_ONLY_PATHS.has(path)
  if (sourceForms.length === 1 && !multipleOnly) return value

  return getPluralCategories(locale, multipleOnly ? 2 : 0)
    .map(category => sourceFormForCategory(sourceForms, category))
    .join(PLURAL_SEPARATOR)
}

function skeletonStrings(locale) {
  return new Map([...missingSourceStrings(locale)].map(([path, value]) => [
    path,
    expandPluralSkeleton(locale, path, value)
  ]))
}

function serializeOverlay(locale, strings) {
  const heading = `# Optional AI-generated translations for keys missing from ../${locale}.yaml.\n`
  return heading + dumpYaml(unflattenStrings(strings), {
    lineWidth: -1,
    noRefs: true,
    quotingType: "'"
  })
}

/**
 * Remove AI entries that now have a non-empty human translation. The YAML
 * document API keeps comments, quotes, and block scalar formatting intact for
 * every entry that remains.
 *
 * @param {string} locale
 * @param {string} overlayText
 * @param {Record<string, unknown>} humanMessages
 * @returns {{ output: string, removedPaths: string[] }}
 */
export function cleanupOverlayText(locale, overlayText, humanMessages) {
  const document = parseDocument(overlayText)
  if (document.errors.length > 0) throw document.errors[0]

  const overlay = flattenStrings(document.toJS() ?? {})
  const human = flattenStrings(humanMessages)
  const removedPaths = [...overlay.keys()].filter(path => human.has(path))

  if (removedPaths.length === 0) {
    return { output: overlayText, removedPaths }
  }

  if (removedPaths.length === overlay.size) {
    return {
      output: serializeOverlay(locale, new Map()),
      removedPaths,
    }
  }

  for (const flatPath of removedPaths) {
    const path = flatPath.split('\0')
    document.deleteIn(path)

    while (path.length > 1) {
      path.pop()
      const parent = document.getIn(path, true)
      if (!isMap(parent) || parent.items.length > 0) break
      document.deleteIn(path)
    }
  }

  return { output: document.toString(), removedPaths }
}

function assertEligibleLocale(locale) {
  if (!eligibleLocales().includes(locale)) {
    throw new Error(`Expected an active locale other than ${[...EXCLUDED_LOCALES].join(' or ')}, got "${locale}"`)
  }
}

function placeholders(value) {
  return [...(value.match(PLACEHOLDER_PATTERN) ?? [])].sort()
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function validateTranslation(locale, path, source, translation, errors) {
  const sourceForms = source.split(PLURAL_SEPARATOR)
  const translatedForms = translation.split(PLURAL_SEPARATOR)
  const multipleOnly = MULTIPLE_ONLY_PATHS.has(path)

  if (sourceForms.length === 1 && !multipleOnly) {
    if (translatedForms.length !== 1) {
      errors.push(`${path}: source is not plural but translation has ${translatedForms.length} forms`)
      return
    }

    if (!sameStrings(placeholders(source), placeholders(translation))) {
      errors.push(`${path}: expected placeholders ${JSON.stringify(placeholders(source))}, got ${JSON.stringify(placeholders(translation))}`)
    }
    return
  }

  let categories = getPluralCategories(locale, multipleOnly ? 2 : 0)
  if (multipleOnly && translatedForms.length === getPluralCategories(locale).length) {
    categories = getPluralCategories(locale)
  }
  if (translatedForms.length !== categories.length) {
    errors.push(`${path}: expected ${categories.length} plural forms (${categories.join(', ')}), got ${translatedForms.length}`)
    return
  }

  for (const [index, category] of categories.entries()) {
    const expected = placeholders(sourceFormForCategory(sourceForms, category))
    const actual = placeholders(translatedForms[index])

    if (!sameStrings(expected, actual)) {
      errors.push(`${path} [${category}]: expected placeholders ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
  }
}

export function validateOverlayMessages(locale, sourceMessages, humanMessages, overlayMessages) {
  const source = flattenStrings(sourceMessages)
  source.delete('Locale Name')
  const human = flattenStrings(humanMessages)
  const missing = new Map([...source].filter(([path]) => !human.has(path)))
  const overlay = flattenStrings(overlayMessages)
  const errors = []
  let unchangedCount = 0

  for (const path of missing.keys()) {
    if (!overlay.has(path)) errors.push(`${path}: missing from AI translation overlay`)
  }

  for (const [path, translation] of overlay) {
    if (!source.has(path)) {
      errors.push(`${path}: not present in ${SOURCE_LOCALE}`)
      continue
    }
    if (!missing.has(path)) {
      errors.push(`${path}: already has a human translation in ${locale}`)
      continue
    }

    validateTranslation(locale, path, source.get(path), translation, errors)
    if (translation === source.get(path)) unchangedCount += 1
  }

  // Product names and technical labels can stay English, but a generated file
  // that is mostly the untouched skeleton is not a translation completion.
  if (locale !== 'en-GB' && unchangedCount > overlay.size * 0.3) {
    errors.push(`${unchangedCount} of ${overlay.size} values are unchanged from ${SOURCE_LOCALE}`)
  }

  return errors
}

function generate(locale, write) {
  assertEligibleLocale(locale)
  const strings = skeletonStrings(locale)
  const output = serializeOverlay(locale, strings)

  if (!write) {
    process.stdout.write(output)
    return
  }

  const outputPath = join(AI_LOCALES_DIR, `${locale}.yaml`)
  if (existsSync(outputPath)) throw new Error(`${outputPath} already exists; refusing to overwrite it`)

  mkdirSync(AI_LOCALES_DIR, { recursive: true })
  writeFileSync(outputPath, output)
  console.log(`Wrote ${strings.size} missing keys to ${outputPath}`)
}

function validate(locale) {
  assertEligibleLocale(locale)
  const overlayPath = join(AI_LOCALES_DIR, `${locale}.yaml`)
  if (!existsSync(overlayPath)) throw new Error(`Missing AI translation overlay: ${overlayPath}`)

  const overlayMessages = readYaml(overlayPath)
  const overlay = flattenStrings(overlayMessages)
  const errors = validateOverlayMessages(
    locale,
    readYaml(join(LOCALES_DIR, `${SOURCE_LOCALE}.yaml`)),
    readYaml(join(LOCALES_DIR, `${locale}.yaml`)),
    overlayMessages
  )

  if (errors.length > 0) {
    throw new Error(`${locale} has ${errors.length} invalid AI translation entries:\n${errors.map(error => `- ${error}`).join('\n')}`)
  }

  console.log(`${locale}: ${overlay.size} AI translation entries are valid`)
}

function validateAll() {
  const locales = eligibleLocales()
  const yamlFiles = existsSync(AI_LOCALES_DIR)
    ? readdirSync(AI_LOCALES_DIR).filter(file => file.endsWith('.yaml'))
    : []
  const expectedFiles = new Set(locales.map(locale => `${locale}.yaml`))
  const unexpectedFiles = yamlFiles.filter(file => !expectedFiles.has(file))

  if (unexpectedFiles.length > 0) {
    throw new Error(`Unexpected AI locale files: ${unexpectedFiles.join(', ')}`)
  }

  for (const locale of locales) validate(locale)
}

function cleanup(locale, write, reportUnchanged = true) {
  assertEligibleLocale(locale)
  const overlayPath = join(AI_LOCALES_DIR, `${locale}.yaml`)
  if (!existsSync(overlayPath)) throw new Error(`Missing AI translation overlay: ${overlayPath}`)

  const overlayText = readFileSync(overlayPath, 'utf8')
  const humanMessages = readYaml(join(LOCALES_DIR, `${locale}.yaml`))
  const { output, removedPaths } = cleanupOverlayText(locale, overlayText, humanMessages)

  if (removedPaths.length === 0) {
    if (reportUnchanged) console.log(`${locale}: no AI entries overlap human translations`)
    return 0
  }

  if (!write) {
    console.log(`${locale}: would remove ${removedPaths.length} AI entries now covered by human translations`)
    for (const path of removedPaths) console.log(`- ${path.replaceAll('\0', ' > ')}`)
    return removedPaths.length
  }

  writeFileSync(overlayPath, output)
  console.log(`${locale}: removed ${removedPaths.length} AI entries now covered by human translations`)
  validate(locale)
  return removedPaths.length
}

function cleanupAll(write) {
  let removedCount = 0
  let affectedLocales = 0

  for (const locale of eligibleLocales()) {
    const localeRemovedCount = cleanup(locale, write, false)
    removedCount += localeRemovedCount
    if (localeRemovedCount > 0) affectedLocales += 1
  }

  const action = write ? 'Removed' : 'Would remove'
  console.log(`${action} ${removedCount} AI entries from ${affectedLocales} locales`)
  if (!write && removedCount > 0) console.log('Run again with --write to update the overlay files')
}

function status() {
  for (const locale of eligibleLocales()) {
    const missing = missingSourceStrings(locale)
    const overlayPath = join(AI_LOCALES_DIR, `${locale}.yaml`)
    const overlay = existsSync(overlayPath) ? flattenStrings(readYaml(overlayPath)) : new Map()
    const completed = [...missing.keys()].filter(path => overlay.has(path)).length
    console.log(`${locale}\t${completed}/${missing.size} missing keys covered, ${overlay.size} entries`)
  }
}

function usage() {
  console.error(`Usage:
  node _scripts/aiTranslations.mjs generate <locale> [--write]
  node _scripts/aiTranslations.mjs validate <locale>
  node _scripts/aiTranslations.mjs validate --all
  node _scripts/aiTranslations.mjs cleanup <locale> [--write]
  node _scripts/aiTranslations.mjs cleanup --all [--write]
  node _scripts/aiTranslations.mjs status`)
}

function main() {
  try {
    const [command, locale, ...flags] = process.argv.slice(2)

    if (command === 'generate' && locale) {
      const unknownFlags = flags.filter(flag => flag !== '--write')
      if (unknownFlags.length > 0) throw new Error(`Unknown flags: ${unknownFlags.join(', ')}`)
      generate(locale, flags.includes('--write'))
    } else if (command === 'validate' && locale === '--all' && flags.length === 0) {
      validateAll()
    } else if (command === 'validate' && locale && flags.length === 0) {
      validate(locale)
    } else if (command === 'cleanup' && locale) {
      const unknownFlags = flags.filter(flag => flag !== '--write')
      if (unknownFlags.length > 0) throw new Error(`Unknown flags: ${unknownFlags.join(', ')}`)
      const write = flags.includes('--write')
      if (locale === '--all') cleanupAll(write)
      else cleanup(locale, write)
    } else if (command === 'status' && locale == null) {
      status()
    } else {
      usage()
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
