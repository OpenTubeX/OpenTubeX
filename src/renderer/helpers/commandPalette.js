import { normalizeSearchText as normalizeCommandText, fuzzyTextScore, fuzzyWordScore, findSubsequenceIndexes } from './textSearch.js'
import { runCooperatively, runSynchronously } from './cooperativeTask.js'

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

function scoreCommand(query, command, normalizeText, scoreText) {
  const fields = [
    { value: command.label, weight: 0 },
    ...(command.aliases ?? []).map(alias => ({
      value: alias,
      weight: 3,
    })),
    { value: command.group, weight: 6 },
  ]

  const bestFieldScore = token => {
    let best = Number.POSITIVE_INFINITY
    for (const field of fields) {
      // A field cannot beat its minimum weight; avoid fuzzy work once a
      // better label match has already won.
      if (field.weight < best) {
        field.normalized ??= normalizeText(field.value)
        best = Math.min(best, scoreText(token, field.normalized) + field.weight)
      }
    }
    return best
  }
  let score = bestFieldScore(query)
  if (!Number.isFinite(score)) {
    if (!query.includes(' ')) return score
    score = 24
    for (const token of query.split(' ')) {
      const tokenScore = bestFieldScore(token)
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
  return runSynchronously(filterCommandSteps(commands, query, locale))
}

/** Match large libraries while allowing typing and rendering between batches. */
export function filterCommandPaletteCommandsAsync(commands, query, locale, isCancelled) {
  return runCooperatively(filterCommandSteps(commands, query, locale), isCancelled)
}

function * filterCommandSteps(commands, query, locale) {
  const normalizedQuery = normalizeCommandText(query, locale)
  if (normalizedQuery === '') return Array.isArray(commands) ? commands : Array.from(commands)

  // Source, channel and group text repeat across large libraries. Bound these
  // per-search caches so unique titles cannot retain the whole collection.
  const normalizedText = new Map()
  const scoresByQuery = new Map()
  const wordScoresByQuery = new Map()
  const normalizeText = text => {
    let candidate = normalizedText.get(text)
    if (candidate === undefined) {
      candidate = normalizeCommandText(text, locale)
      if (normalizedText.size < 1000) normalizedText.set(text, candidate)
    }
    return candidate
  }
  const scoreText = (token, candidate) => {
    let scores = scoresByQuery.get(token)
    if (!scores) {
      scores = new Map()
      scoresByQuery.set(token, scores)
    }
    if (scores.has(candidate)) return scores.get(candidate)
    let wordScores = wordScoresByQuery.get(token)
    if (!wordScores) {
      wordScores = new Map()
      wordScoresByQuery.set(token, wordScores)
    }
    const score = fuzzyTextScore(token, candidate, (query, word) => {
      if (wordScores.has(word)) return wordScores.get(word)
      const wordScore = fuzzyWordScore(query, word)
      if (wordScores.size < 1000) wordScores.set(word, wordScore)
      return wordScore
    })
    if (scores.size < 1000) scores.set(candidate, score)
    return score
  }

  const scored = []
  const videos = []
  let index = 0
  for (const command of commands) {
    yield
    const score = scoreCommand(normalizedQuery, command, normalizeText, scoreText)
    const match = { command, index: index++, score }
    if (!Number.isFinite(score)) continue
    if (!command.localVideo) {
      scored.push(match)
    } else if (videos.length < 50 || compareMatches(match, videos.at(-1)) < 0) {
      // Maintain only the best video matches during the scan. Sorting and
      // discarding every match at the end would create one large CPU burst.
      let start = 0
      let end = videos.length
      while (start < end) {
        const middle = (start + end) >>> 1
        if (compareMatches(match, videos[middle]) < 0) end = middle
        else start = middle + 1
      }
      videos.splice(start, 0, match)
      if (videos.length > 50) videos.pop()
    }
  }
  return scored.concat(videos)
    .sort(compareMatches)
    .map(({ command }) => command)
}

function compareMatches(first, second) {
  return first.score - second.score || first.index - second.index
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
  if (normalizedQuery === '') return [{ text: value, highlighted: false }]
  const { characters, normalizedCharacters } = normalizedCharacterMap(value, locale)

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
