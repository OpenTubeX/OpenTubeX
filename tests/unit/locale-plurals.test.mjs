import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

import { createPluralRules } from '../../src/renderer/i18n/plurals.js'

const localeUrl = new URL('../../static/locales/en-US.yaml', import.meta.url)
const sourceDirUrl = new URL('../../src/', import.meta.url)

const locale = loadYaml(await readFile(localeUrl, 'utf8'))

/**
 * Collects the paths of all messages that declare vue-i18n plural forms ("singular | plural").
 * @param {object} messages
 * @param {string} [prefix]
 * @returns {string[]}
 */
function collectPluralPaths(messages, prefix = '') {
  const paths = []

  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') {
      if (value.includes(' | ')) {
        paths.push(path)
      }
    } else if (value != null && typeof value === 'object') {
      paths.push(...collectPluralPaths(value, path))
    }
  }

  return paths
}

/**
 * @param {URL} directory
 * @returns {Promise<URL[]>}
 */
async function collectSourceFiles(directory) {
  const files = []

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(entryUrl))
    } else if (/\.(js|vue)$/.test(entry.name)) {
      files.push(entryUrl)
    }
  }

  return files
}

/**
 * Splits the arguments of a call, starting at the index of its opening parenthesis.
 * @param {string} source
 * @param {number} openingParenthesisIndex
 * @returns {string[] | null} the arguments, or null if the call isn't terminated
 */
function splitCallArguments(source, openingParenthesisIndex) {
  const args = []
  let depth = 0
  let quote = null
  let start = openingParenthesisIndex + 1

  for (let index = start; index < source.length; index++) {
    const character = source[index]

    if (quote) {
      if (character === '\\') {
        index++
      } else if (character === quote) {
        quote = null
      }

      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character
    } else if (character === '(' || character === '[' || character === '{') {
      depth++
    } else if (character === ')' && depth === 0) {
      args.push(source.slice(start, index))
      return args
    } else if (character === ')' || character === ']' || character === '}') {
      depth--
    } else if (character === ',' && depth === 0) {
      args.push(source.slice(start, index))
      start = index + 1
    }
  }

  return null
}

const pluralPaths = collectPluralPaths(locale)
const sourceFiles = await collectSourceFiles(sourceDirUrl)

test('plural messages declare a singular and a plural form', () => {
  for (const path of pluralPaths) {
    const forms = path.split('.').reduce((messages, key) => messages[key], locale).split(' | ')

    // English groups numbers as "one" and "other", so a third form would only
    // ever be reachable through vue-i18n's built-in "zero | singular | plural"
    // rule, which the translated locales can't express.
    assert.equal(forms.length, 2, `${path} must declare exactly two plural forms`)

    for (const form of forms) {
      assert.notEqual(form.trim(), '', `${path} must not declare an empty plural form`)
    }
  }
})

test('plural messages are translated with a plural choice', async () => {
  const pluralPathSet = new Set(pluralPaths)
  const callPattern = /\$?t\(\s*(['"])(.+?)\1/gs

  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8')

    for (const match of source.matchAll(callPattern)) {
      const path = match[2]
      if (!pluralPathSet.has(path)) { continue }

      const openingParenthesisIndex = match.index + match[0].indexOf('(')
      const args = splitCallArguments(source, openingParenthesisIndex)

      assert.ok(
        args != null && args.length >= 3 && args[2].trim() !== '',
        `${file.pathname}: "${path}" has plural forms, so it needs a count as the third argument of t()`
      )
    }
  }
})

/** vue-i18n's built-in rule, which our rules fall back to. */
const builtInRule = (choice, choicesLength) => {
  choice = Math.abs(choice)

  return choicesLength === 2 ? (choice === 1 ? 0 : 1) : Math.min(choice, 2)
}

/**
 * @param {string} locale
 * @param {number} choicesLength
 * @param {number[]} counts
 * @returns {number[]}
 */
function selectForms(locale, choicesLength, counts) {
  const rule = createPluralRules([locale])[locale]

  return counts.map(count => rule(count, choicesLength, builtInRule))
}

test('plural rules pick the form each language groups the count under', () => {
  const counts = [1, 2, 3, 4, 5, 11, 12, 21, 22, 25, 112]

  // 1 komentarz | 2 komentarze | 5 komentarzy, where "few" also covers 22 but not 12
  assert.deepEqual(
    selectForms('pl', 3, counts),
    [0, 1, 1, 1, 2, 2, 2, 2, 1, 2, 2]
  )

  // Russian additionally groups 21 and 101 with 1
  assert.deepEqual(
    selectForms('ru', 3, counts),
    [0, 1, 1, 1, 2, 2, 2, 0, 1, 2, 2]
  )

  // Slovenian has a dedicated form for 2
  assert.deepEqual(
    selectForms('sl', 4, counts),
    [0, 1, 2, 2, 3, 3, 3, 3, 3, 3, 3]
  )

  // Japanese doesn't inflect for number at all
  assert.deepEqual(
    selectForms('ja', 1, counts),
    counts.map(() => 0)
  )

  // English is unchanged: singular for 1, plural for everything else
  assert.deepEqual(
    selectForms('en-US', 2, [0, ...counts]),
    [1, 0, ...counts.slice(1).map(() => 1)]
  )
})

test('plural rules fall back when a translation does not cover every form', () => {
  const counts = [0, 1, 2, 5, 22]
  const fallback = counts.map(count => builtInRule(count, 2))

  // Polish and Arabic translations that only provide a singular and a plural
  // keep behaving the way they did before the rules were introduced.
  assert.deepEqual(selectForms('pl', 2, counts), fallback)
  assert.deepEqual(selectForms('ar', 2, counts), fallback)

  // As do messages that still use vue-i18n's "zero | singular | plural" rule.
  assert.deepEqual(
    selectForms('en-US', 3, [0, 1, 2, 5]),
    [0, 1, 2, 2]
  )
})

test('every active locale gets a plural rule', async () => {
  const activeLocales = JSON.parse(await readFile(
    new URL('../../static/locales/activeLocales.json', import.meta.url),
    'utf8'
  ))

  const rules = createPluralRules(activeLocales)

  for (const activeLocale of activeLocales) {
    assert.equal(typeof rules[activeLocale], 'function', `${activeLocale} must have a plural rule`)
  }
})
