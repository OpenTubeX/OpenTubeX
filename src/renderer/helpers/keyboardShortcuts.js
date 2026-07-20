const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift'])
const IMPLICIT_SHIFT_KEYS = new Set(['!', '"', '#', '$', '%', '&', "'", '(', ')', '*', '+', 'plus', ':', '<', '>', '?', '@', '^', '_', '{', '|', '}'])

/**
 * @param {KeyboardEvent} event
 * @param {string} shortcut
 * @returns {boolean}
 */
export function matchesKeyboardShortcut(event, shortcut) {
  if (!shortcut) {
    return false
  }

  const parts = shortcut.toLowerCase().split('+')
  const key = normalizeKeyboardKey(parts.pop() ?? '')
  const expectsCtrl = parts.includes('ctrl')
  const expectsPhysicalControl = parts.includes('control')
  const expectsCommand = parts.includes('cmd')
  const expectsAlt = parts.includes('alt') || parts.includes('option')
  const expectsShift = parts.includes('shift')
  const implicitShift = IMPLICIT_SHIFT_KEYS.has(key)
  let controlModifiersMatch = !event.ctrlKey && !event.metaKey

  if (expectsPhysicalControl) {
    controlModifiersMatch = event.ctrlKey && !event.metaKey
  } else if (expectsCtrl) {
    controlModifiersMatch = process.platform === 'darwin'
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey
  } else if (expectsCommand) {
    controlModifiersMatch = event.metaKey && !event.ctrlKey
  }

  if (
    !controlModifiersMatch ||
    event.altKey !== expectsAlt ||
    (!implicitShift && event.shiftKey !== expectsShift) ||
    (expectsShift && !event.shiftKey)
  ) {
    return false
  }

  const eventKey = normalizeKeyboardKey(event.key)
  const numericRange = /^(\d)(?:\.\.|-)(\d)$/.exec(key)
  if (numericRange) {
    return eventKey >= numericRange[1] && eventKey <= numericRange[2]
  }

  const physicalKey = event.code.startsWith('Key')
    ? event.code.slice(3).toLowerCase()
    : event.code.startsWith('Digit')
      ? event.code.slice(5)
      : ''

  return eventKey === key || physicalKey === key
}

/**
 * @param {KeyboardEvent} event
 * @returns {string | null}
 */
export function keyboardShortcutFromEvent(event) {
  if (MODIFIER_KEYS.has(event.key)) {
    return null
  }

  const key = normalizeKeyboardKey(event.key)
  const shortcut = []

  if (process.platform === 'darwin' && event.ctrlKey) {
    shortcut.push('control')
  } else if (process.platform === 'darwin' ? event.metaKey : event.ctrlKey) {
    shortcut.push('ctrl')
  } else if (event.metaKey) {
    shortcut.push('cmd')
  }
  if (event.altKey) {
    shortcut.push('alt')
  }
  if (event.shiftKey && !IMPLICIT_SHIFT_KEYS.has(key)) {
    shortcut.push('shift')
  }
  shortcut.push(key)

  return shortcut.join('+')
}

/**
 * @param {string} firstShortcut
 * @param {string} secondShortcut
 * @returns {boolean}
 */
export function keyboardShortcutsOverlap(firstShortcut, secondShortcut) {
  if (!firstShortcut || !secondShortcut) {
    return false
  }

  const first = getShortcutDescriptor(firstShortcut)
  const second = getShortcutDescriptor(secondShortcut)

  if (first.modifiers !== second.modifiers) {
    return false
  }

  const firstRange = getNumericShortcutRange(first.key)
  const secondRange = getNumericShortcutRange(second.key)
  if (firstRange && secondRange) {
    return firstRange.start <= secondRange.end && secondRange.start <= firstRange.end
  }

  return first.key === second.key
}

/**
 * @param {string} shortcut
 * @returns {{ key: string, modifiers: string }}
 */
function getShortcutDescriptor(shortcut) {
  const parts = shortcut.toLowerCase().split('+')
  const key = normalizeKeyboardKey(parts.pop() ?? '')
  const modifiers = new Set()

  for (const modifier of parts) {
    switch (modifier) {
      case 'ctrl':
        modifiers.add(process.platform === 'darwin' ? 'meta' : 'control')
        break
      case 'cmd':
        modifiers.add('meta')
        break
      case 'control':
        modifiers.add('control')
        break
      case 'alt':
      case 'option':
        modifiers.add('alt')
        break
      case 'shift':
        if (!IMPLICIT_SHIFT_KEYS.has(key)) {
          modifiers.add('shift')
        }
        break
    }
  }

  return {
    key,
    modifiers: [...modifiers].sort().join('+')
  }
}

/**
 * @param {string} key
 * @returns {{ start: string, end: string } | null}
 */
function getNumericShortcutRange(key) {
  const range = /^(\d)(?:\.\.|-)(\d)$/.exec(key)
  if (range) {
    return { start: range[1], end: range[2] }
  }
  if (/^\d$/.test(key)) {
    return { start: key, end: key }
  }
  return null
}

/**
 * @param {string} key
 * @returns {string}
 */
function normalizeKeyboardKey(key) {
  switch (key) {
    case ' ':
    case 'Spacebar':
      return 'space'
    case '+':
      return 'plus'
    default:
      return key.toLowerCase()
  }
}
