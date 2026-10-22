import assert from 'node:assert/strict'
import test from 'node:test'

import {
  captureConsole,
  createDiagnosticLog,
  DIAGNOSTIC_ENTRY_MAX_LENGTH,
  formatDiagnosticEntry,
  formatDiagnosticMessage,
  redactDiagnosticText,
} from '../../src/diagnosticLog.js'

test('URLs keep their origin and path but lose parameters and opaque segments', () => {
  assert.equal(
    redactDiagnosticText('GET https://rr3---sn-4g5e6nzz.googlevideo.com/videoplayback?expire=1&ip=203.0.113.9&sig=abc#t=4 failed.'),
    'GET https://<node>.googlevideo.com/videoplayback?<redacted>#<redacted> failed.'
  )
  assert.equal(
    redactDiagnosticText('https://www.youtube.com/api/manifest/dash/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop/source/youtube'),
    'https://www.youtube.com/api/manifest/dash/<redacted>/source/youtube'
  )
  assert.equal(redactDiagnosticText('http://localhost:9050/'), 'http://localhost:9050/')
  assert.equal(
    redactDiagnosticText('see (https://example.com/a?filters[]=private&q=(secret)) and [https://[2001:db8::5]/watch?account=alice].'),
    'see (https://example.com/a?<redacted>) and [https://[<ip>]/watch?<redacted>].'
  )
})

test('credentials and identifying values are removed from text', () => {
  const text = redactDiagnosticText([
    'Cookie: SID=abc; HSID=def',
    'Authorization: Bearer secret-value',
    '{"poToken":"MnQ3abc","visitorData":"Cgt4"} token=xyz',
    'from 203.0.113.9 and 2001:db8:85a3::8a2e:370:7334 via 127.0.0.1',
    'mail someone@example.com',
    'yt-dlp at /home/alice/.local/bin/yt-dlp and C:\\Users\\Bob\\yt-dlp.exe',
  ].join('\n'))

  for (const secret of ['SID=abc', 'secret-value', 'MnQ3abc', 'Cgt4', 'xyz', '203.0.113.9', '2001:db8', 'someone@', 'alice', 'Bob']) {
    assert.ok(!text.includes(secret), `${secret} is still in:\n${text}`)
  }
  assert.ok(text.includes('127.0.0.1'))
  assert.ok(text.includes('/home/<user>/.local/bin/yt-dlp'))
})

test('versions, durations and timestamps are not mistaken for addresses', () => {
  const text = 'Chromium 138.0.7204.100 at 1:02:03, built 2026-10-22T10:20:30.000Z'
  assert.equal(redactDiagnosticText(text), text)
})

test('console arguments are serialized with errors, nested data and sensitive keys', () => {
  const error = new Error('Request failed')
  error.code = 1001
  error.data = ['https://example.com/a?key=1', 403, { headers: { 'set-cookie': 'a=b', 'content-type': 'video/mp4' } }, new Uint8Array(512)]
  const message = formatDiagnosticMessage(['Player error', error])

  assert.match(message, /^Player error Error: Request failed\n\s+at /)
  assert.ok(message.includes('code: 1001'))
  assert.ok(message.includes('"https://example.com/a?<redacted>", 403'))
  assert.ok(message.includes('set-cookie: <redacted>, content-type: "video/mp4"'))
  assert.ok(message.includes('Uint8Array(512)'))
})

test('values logged after a credential label are redacted', () => {
  assert.equal(formatDiagnosticMessage(['Cookie', 'SID=abc; HSID=def']), 'Cookie <redacted>')
  assert.equal(formatDiagnosticMessage(['poToken:', 'MnQ3abc', 'kept']), 'poToken: <redacted> kept')
  assert.equal(formatDiagnosticMessage(['Using token %s for %s', 'abc123', 'web']), 'Using token <redacted> for web')
  // Ordinary messages that mention a credential keep their details
  assert.equal(formatDiagnosticMessage(['Failed to refresh after a token change', 'reason']), 'Failed to refresh after a token change reason')
})

test('format substitutions, circular values and long messages are handled', () => {
  const value = { name: 'loop' }
  value.self = value
  assert.equal(formatDiagnosticMessage(['Missing key "%s" (%d)', 'play', '4.7', value]), 'Missing key "play" (4) {name: "loop", self: [Circular]}')
  assert.ok(formatDiagnosticMessage(['x'.repeat(DIAGNOSTIC_ENTRY_MAX_LENGTH + 10)]).endsWith('… (10 more characters)'))
})

test('the log keeps only the newest entries', () => {
  const log = createDiagnosticLog(2)
  for (const message of ['a', 'b', 'c']) log.add({ time: 0, level: 'log', source: 'main', message })
  assert.deepEqual(log.entries().map(entry => entry.message), ['b', 'c'])
  log.clear()
  assert.deepEqual(log.entries(), [])
  assert.equal(formatDiagnosticEntry({ time: 0, level: 'warn', source: 'main', message: 'm' }), '1970-01-01T00:00:00.000Z WARN  [main] m')
})

test('console capture forwards calls once, ignores logging from the recorder and can be undone', () => {
  const output = []
  const target = Object.fromEntries(['debug', 'log', 'info', 'warn', 'error'].map(level => [level, (...args) => output.push([level, ...args])]))
  const recorded = []
  const originalWarn = target.warn
  const restore = captureConsole(target, (level, args) => {
    recorded.push([level, ...args])
    target.error('nested')
    throw new Error('recorder failure')
  })

  target.warn('first', 1)
  assert.deepEqual(output, [['warn', 'first', 1], ['error', 'nested']])
  assert.deepEqual(recorded, [['warn', 'first', 1]])

  restore()
  assert.equal(target.warn, originalWarn)
  target.warn('after')
  assert.equal(recorded.length, 1)
})

test('huge messages are bounded before redaction and keep secrets near the cut redacted', () => {
  const beforeSecret = 'a-'.repeat((DIAGNOSTIC_ENTRY_MAX_LENGTH - 200) / 2)
  const text = `${beforeSecret} token=secret-value ${'b-'.repeat(1500000)}`
  const start = performance.now()
  const message = formatDiagnosticMessage(['Response body', text])
  const elapsed = performance.now() - start

  assert.ok(elapsed < 1000, `formatting took ${Math.round(elapsed)} ms`)
  assert.ok(message.includes(' token=<redacted> '))
  assert.ok(!message.includes('secret-value'))
  assert.ok(message.length < DIAGNOSTIC_ENTRY_MAX_LENGTH + 50, `${message.length} characters`)
  assert.match(message, /… \(\d+ more characters\)$/)

  const closersStart = performance.now()
  assert.equal(redactDiagnosticText(`https://example.com/a?b=c${')'.repeat(8000)}`), `https://example.com/a?<redacted>${')'.repeat(8000)}`)
  assert.ok(performance.now() - closersStart < 100, 'trimming closing brackets is linear')
})
