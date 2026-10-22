// Recent console output kept in memory for diagnostic reports. Values are
// redacted when they are recorded, so private data never sits in the buffer.

export const DIAGNOSTIC_LOG_LEVELS = ['debug', 'log', 'info', 'warn', 'error']
export const DIAGNOSTIC_LOG_LIMIT = 500
export const DIAGNOSTIC_ENTRY_MAX_LENGTH = 4000

const MAX_DEPTH = 4
const MAX_ITEMS = 25
const MAX_STRING_LENGTH = 2000
const REDACTED = '<redacted>'

const SENSITIVE_KEY = /^(?:authorization|cookies?|set-cookie|password|passphrase|secret|signature|sig|sapisid|visitor[_-]?(?:data|id)|.*(?:token|secret|password|api[_-]?key|cookie)s?)$/i
const SENSITIVE_ASSIGNMENT = /(["']?)\b(authorization|cookies?|set-cookie|password|passphrase|secret|sapisid|visitor[_-]?(?:data|id)|[\w-]*(?:token|secret|password|api[_-]?key))\1(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi
// Brackets are valid URL characters (IPv6 hosts, `filters[]=` queries), so a
// match only ends at whitespace or quotes and loses unbalanced closers later
const URL_PATTERN = /\b(?:https?|wss?|file):\/\/[^\s"'<>]+/gi
const CLOSING_BRACKETS = { ')': '(', ']': '[', '}': '{' }
const IPV4_PATTERN = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g
const IPV6_PATTERN = /(?<![\w:])(?:(?:[\da-f]{1,4}:){3,7}[\da-f]{1,4}|(?:[\da-f]{1,4}:){1,6}:(?:[\da-f]{1,4}(?::[\da-f]{1,4})*)?)(?![\w:])/gi
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g
const HOME_DIRECTORY_PATTERN = /(\/home\/|\/Users\/|[A-Z]:\\{1,2}Users\\{1,2})[^/\\\s"']+/gi
// googlevideo hosts name the CDN node closest to the user
const GOOGLEVIDEO_NODE_PATTERN = /\brr\d+---sn-[\da-z-]+\.googlevideo\.com\b/gi
// Long opaque path segments are usually tokens, signatures or session IDs
const OPAQUE_PATH_SEGMENT = /^[\w%=.~-]{40,}$/

function countOf(text, character) {
  return text.split(character).length - 1
}

function redactUrl(match) {
  // Keep sentence punctuation and closing brackets that surround the URL
  let value = match
  for (;;) {
    const last = value.at(-1)
    if (
      '.,;:!?'.includes(last) ||
      (last in CLOSING_BRACKETS && countOf(value, last) > countOf(value, CLOSING_BRACKETS[last]))
    ) {
      value = value.slice(0, -1)
    } else {
      break
    }
  }
  const trailing = match.slice(value.length)
  let url
  try {
    url = new URL(value)
  } catch {
    return `<url>${trailing}`
  }
  const path = url.pathname
    .split('/')
    .map(segment => OPAQUE_PATH_SEGMENT.test(segment) ? REDACTED : segment)
    .join('/')
  const query = url.search ? `?${REDACTED}` : ''
  const hash = url.hash ? `#${REDACTED}` : ''
  const origin = url.protocol === 'file:' ? 'file://' : `${url.protocol}//${url.host}`
  return `${origin}${path}${query}${hash}${trailing}`
}

/**
 * Removes credentials, URL parameters and data that identifies the user or
 * their network from free-form log text.
 * @param {string} text
 * @returns {string}
 */
export function redactDiagnosticText(text) {
  return text
    .replaceAll(URL_PATTERN, redactUrl)
    .replaceAll(/\b(authorization|cookie|set-cookie)(\s*:\s*)(?!<redacted>)(?=\S)[^\r\n"]+/gi, `$1$2${REDACTED}`)
    .replaceAll(/\b(bearer|basic)\s+[\w.~+/=-]+/gi, `$1 ${REDACTED}`)
    .replaceAll(SENSITIVE_ASSIGNMENT, `$1$2$1$3${REDACTED}`)
    .replaceAll(GOOGLEVIDEO_NODE_PATTERN, '<node>.googlevideo.com')
    .replaceAll(EMAIL_PATTERN, '<email>')
    .replaceAll(IPV4_PATTERN, address => address.startsWith('127.') ? address : '<ip>')
    .replaceAll(IPV6_PATTERN, address => address === '::1' ? address : '<ip>')
    .replaceAll(HOME_DIRECTORY_PATTERN, '$1<user>')
}

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength)}… (${text.length - maxLength} more characters)` : text
}

function serialize(value, depth, seen) {
  if (value === null || value === undefined) return String(value)
  switch (typeof value) {
    case 'string':
      return depth === 0 ? value : JSON.stringify(truncate(value, MAX_STRING_LENGTH))
    case 'number':
    case 'boolean':
    case 'symbol':
      return String(value)
    case 'bigint':
      return `${value}n`
    case 'function':
      return `[Function${value.name ? ` ${value.name}` : ''}]`
  }

  if (seen.has(value)) return '[Circular]'
  if (ArrayBuffer.isView(value)) return `${value.constructor.name}(${value.length ?? value.byteLength})`
  if (value instanceof ArrayBuffer) return `ArrayBuffer(${value.byteLength})`
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  if (value instanceof RegExp) return String(value)
  if (typeof Element !== 'undefined' && value instanceof Element) return `<${value.tagName.toLowerCase()}>`
  if (typeof Blob !== 'undefined' && value instanceof Blob) return `Blob(${value.size}, ${value.type || 'unknown type'})`

  seen.add(value)
  try {
    if (value instanceof Error) {
      // Stacks are only useful at the top level; nested errors keep their message
      const header = depth === 0 && value.stack?.includes(value.message) ? value.stack : `${value.name}: ${value.message}`
      const details = Object.keys(value).filter(key => key !== 'stack' && key !== 'message')
      if (value.cause !== undefined && !details.includes('cause')) details.push('cause')
      if (details.length === 0 || depth >= MAX_DEPTH) return header
      return `${header} ${serializeEntries(details.map(key => [key, value[key]]), depth, seen, '{', '}')}`
    }
    if (depth >= MAX_DEPTH) return Array.isArray(value) ? '[Array]' : '[Object]'
    if (Array.isArray(value)) return serializeList(value, depth, seen)
    if (value instanceof Map) return `Map(${value.size}) ${serializeEntries([...value].slice(0, MAX_ITEMS), depth, seen, '{', '}', value.size)}`
    if (value instanceof Set) return `Set(${value.size}) ${serializeList([...value], depth, seen)}`
    const entries = Object.entries(value)
    const name = value.constructor?.name
    const prefix = name && name !== 'Object' ? `${name} ` : ''
    return `${prefix}${serializeEntries(entries.slice(0, MAX_ITEMS), depth, seen, '{', '}', entries.length)}`
  } catch {
    return '[Unserializable]'
  } finally {
    seen.delete(value)
  }
}

function serializeList(items, depth, seen) {
  const values = items.slice(0, MAX_ITEMS).map(item => serialize(item, depth + 1, seen))
  if (items.length > MAX_ITEMS) values.push(`… ${items.length - MAX_ITEMS} more`)
  return `[${values.join(', ')}]`
}

function serializeEntries(entries, depth, seen, open, close, total = entries.length) {
  const values = entries.map(([key, child]) => {
    const name = typeof key === 'string' ? key : serialize(key, depth + 1, seen)
    return `${name}: ${SENSITIVE_KEY.test(name) ? REDACTED : serialize(child, depth + 1, seen)}`
  })
  if (total > entries.length) values.push(`… ${total - entries.length} more`)
  return `${open}${values.join(', ')}${close}`
}

/**
 * Formats console arguments like the console does, including `%s`-style
 * substitutions, and redacts the result.
 * @param {unknown[]} args
 * @returns {string}
 */
export function formatDiagnosticMessage(args) {
  const values = [...args]
  const parts = []
  if (typeof values[0] === 'string' && values[0].includes('%')) {
    const format = values.shift()
    parts.push(format.replaceAll(/%([sdifoOc%])/g, (match, type) => {
      if (type === '%') return '%'
      if (values.length === 0) return match
      const value = values.shift()
      if (type === 'c') return ''
      if (type === 'd' || type === 'i') return String(Number.parseInt(value))
      if (type === 'f') return String(Number(value))
      return serialize(value, type === 's' ? 0 : 1, new WeakSet())
    }))
  }
  parts.push(...values.map(value => serialize(value, 0, new WeakSet())))
  return truncate(redactDiagnosticText(parts.join(' ')), DIAGNOSTIC_ENTRY_MAX_LENGTH)
}

/**
 * @typedef {object} DiagnosticLogEntry
 * @property {number} time
 * @property {string} level
 * @property {string} source
 * @property {string} message
 */

/**
 * @param {string} level
 * @param {string} source
 * @param {unknown[]} args
 * @returns {DiagnosticLogEntry}
 */
export function createDiagnosticEntry(level, source, args) {
  return { time: Date.now(), level, source, message: formatDiagnosticMessage(args) }
}

/**
 * @param {number} [limit]
 */
export function createDiagnosticLog(limit = DIAGNOSTIC_LOG_LIMIT) {
  /** @type {DiagnosticLogEntry[]} */
  let entries = []
  return {
    /** @param {DiagnosticLogEntry} entry */
    add(entry) {
      entries.push(entry)
      if (entries.length > limit) entries = entries.slice(-limit)
    },
    entries: () => [...entries],
    clear() {
      entries = []
    },
  }
}

/**
 * Records every console call through `onEntry` after it reaches the original
 * console. Logging from inside `onEntry` is not recorded again.
 * @param {Console} target
 * @param {(level: string, args: unknown[]) => void} onEntry
 * @returns {() => void} Restores the original console methods
 */
export function captureConsole(target, onEntry) {
  let recording = false
  const originals = DIAGNOSTIC_LOG_LEVELS.map(level => [level, target[level]])
  for (const [level, original] of originals) {
    target[level] = (...args) => {
      original.apply(target, args)
      if (recording) return
      recording = true
      try {
        onEntry(level, args)
      } catch {
        // Diagnostics must never break the code that logged
      } finally {
        recording = false
      }
    }
  }
  return () => {
    for (const [level, original] of originals) target[level] = original
  }
}

/**
 * @param {DiagnosticLogEntry} entry
 * @returns {string}
 */
export function formatDiagnosticEntry(entry) {
  return `${new Date(entry.time).toISOString()} ${entry.level.toUpperCase().padEnd(5)} [${entry.source}] ${entry.message}`
}
