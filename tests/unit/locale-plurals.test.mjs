import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

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

    assert.ok(forms.length >= 2, `${path} must declare at least two plural forms`)

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
