import { normalizeSearchText as normalizeCommandText, fuzzyTextScore, fuzzyWordScore, findSubsequenceIndexes } from './textSearch.js'

export { normalizeCommandText }

export const OPEN_COMMAND_PALETTE_EVENT = 'opentubex:open-command-palette'

/**
 * Keeps keyboard-specific commands available on desktop and on Android when
 * Android reports a physical keyboard.
 * @param {{isCapacitor: boolean, hardwareKeyboardAttached: boolean}} context
 * @returns {boolean}
 */
export function shouldShowKeyboardShortcutCommand({ isCapacitor, hardwareKeyboardAttached }) {
  return !isCapacitor || hardwareKeyboardAttached
}

function scoreCommand(query, command, locale) {
  const fields = [
    { value: normalizeCommandText(command.label, locale), weight: 0 },
    ...(command.aliases ?? []).map(alias => ({
      value: normalizeCommandText(alias, locale),
      weight: 3,
    })),
    { value: normalizeCommandText(command.group, locale), weight: 6 },
  ]

  let score = Math.min(...fields.map(field => fuzzyTextScore(query, field.value) + field.weight))
  if (!Number.isFinite(score)) {
    score = 24
    for (const token of query.split(' ')) {
      const tokenScore = Math.min(...fields.map(field => fuzzyTextScore(token, field.value) + field.weight))
      if (!Number.isFinite(tokenScore)) return Number.POSITIVE_INFINITY
      score += tokenScore
    }
  }

  return score + (command.searchOnly ? 20 : 0)
}

/**
 * Fuzzy matches command labels, aliases, and groups. The original registry
 * order breaks score ties, so broad searches stay predictable as commands
 * update around the active tab.
 * @param {Array<{id: string, label: string, group: string, aliases?: string[]}>} commands
 * @param {string} query
 * @param {string} locale
 * @returns {Array<object>}
 */
export function filterCommandPaletteCommands(commands, query, locale) {
  const normalizedQuery = normalizeCommandText(query, locale)
  if (normalizedQuery === '') return commands

  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(normalizedQuery, command, locale) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((first, second) => first.score - second.score || first.index - second.index)
    .map(({ command }) => command)
}

function normalizedCharacterMap(value, locale) {
  const characters = Array.from(value)
  const normalizedCharacters = characters.flatMap((character, index) => (
    Array.from(character.toLocaleLowerCase(locale).normalize('NFKD'))
      .filter(normalizedCharacter => !/\p{Mark}/u.test(normalizedCharacter))
      .map(normalizedCharacter => ({ value: normalizedCharacter, originalIndex: index }))
  ))
  return { characters, normalizedCharacters }
}

function tokenHighlightIndexes(token, normalizedCharacters) {
  const candidate = normalizedCharacters.map(character => character.value).join('')
  const exactIndex = candidate.indexOf(token)
  if (exactIndex !== -1) {
    return Array.from({ length: token.length }, (_, index) => exactIndex + index)
  }

  let bestMatch = null
  for (const match of candidate.matchAll(/\S+/gu)) {
    const word = match[0]
    const score = fuzzyWordScore(token, word)
    if (!Number.isFinite(score) || (bestMatch && bestMatch.score <= score)) continue

    const subsequenceIndexes = findSubsequenceIndexes(token, word)
    bestMatch = {
      score,
      indexes: subsequenceIndexes
        ? subsequenceIndexes.map(index => match.index + index)
        : Array.from({ length: word.length }, (_, index) => match.index + index),
    }
  }
  if (bestMatch) return bestMatch.indexes

  const compactCharacters = normalizedCharacters.filter(character => !/\s/u.test(character.value))
  const compactCandidate = compactCharacters.map(character => character.value).join('')
  return findSubsequenceIndexes(token, compactCandidate)
    ?.map(index => normalizedCharacters.indexOf(compactCharacters[index])) ?? []
}

/**
 * Splits visible command text into plain and highlighted fuzzy-match segments.
 * @param {string} value
 * @param {string} query
 * @param {string} locale
 * @returns {Array<{text: string, highlighted: boolean}>}
 */
export function highlightCommandText(value, query, locale) {
  const normalizedQuery = normalizeCommandText(query, locale)
  const { characters, normalizedCharacters } = normalizedCharacterMap(value, locale)
  if (normalizedQuery === '') return [{ text: value, highlighted: false }]

  const highlightedIndexes = new Set()
  for (const token of normalizedQuery.split(' ')) {
    for (const index of tokenHighlightIndexes(token, normalizedCharacters)) {
      highlightedIndexes.add(normalizedCharacters[index].originalIndex)
    }
  }

  const segments = []
  for (let index = 0; index < characters.length; index++) {
    const highlighted = highlightedIndexes.has(index)
    const lastSegment = segments.at(-1)
    if (lastSegment?.highlighted === highlighted) {
      lastSegment.text += characters[index]
    } else {
      segments.push({ text: characters[index], highlighted })
    }
  }
  return segments
}

/**
 * Builds a synthetic key event for existing renderer shortcut handlers. This
 * lets palette commands invoke the same player action code as the keyboard.
 * @param {string} shortcut
 * @returns {KeyboardEventInit}
 */
export function keyboardEventInitFromShortcut(shortcut) {
  const parts = shortcut.toLowerCase().split('+')
  let key = parts.pop() ?? ''

  const implicitShiftKeys = new Set(['!', '"', '#', '$', '%', '&', "'", '(', ')', '*', '+', 'plus', ':', '<', '>', '?', '@', '^', '_', '{', '|', '}'])
  const keyValues = {
    arrowdown: 'ArrowDown',
    arrowleft: 'ArrowLeft',
    arrowright: 'ArrowRight',
    arrowup: 'ArrowUp',
    end: 'End',
    home: 'Home',
    minus: '-',
    plus: '+',
    space: ' ',
  }
  key = keyValues[key] ?? key

  const usesPortableControl = parts.includes('ctrl')
  const usesPhysicalControl = parts.includes('control')

  return {
    key,
    code: key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : '',
    bubbles: true,
    cancelable: true,
    ctrlKey: usesPhysicalControl || (usesPortableControl && process.platform !== 'darwin'),
    metaKey: parts.includes('cmd') || (usesPortableControl && process.platform === 'darwin'),
    altKey: parts.includes('alt') || parts.includes('option'),
    shiftKey: parts.includes('shift') || implicitShiftKeys.has(key.toLowerCase()),
  }
}
