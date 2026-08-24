import assert from 'node:assert/strict'
import test from 'node:test'

import { parseLineDelimitedJson } from '../../src/renderer/helpers/line-delimited-json.js'

test('parses LF records with or without a terminal newline', () => {
  const source = '{"id":1}\n{"id":2}'
  const expected = {
    records: [{ id: 1 }, { id: 2 }],
    errors: []
  }

  assert.deepEqual(parseLineDelimitedJson(source), expected)
  assert.deepEqual(parseLineDelimitedJson(`${source}\n`), expected)
})

test('parses CRLF records and ignores whitespace-only rows', () => {
  const source = '{"id":1}\r\n \t \r\n\r\n{"id":2}\r\n'

  assert.deepEqual(parseLineDelimitedJson(source), {
    records: [{ id: 1 }, { id: 2 }],
    errors: []
  })
})

test('returns valid records and a structured one-based error for malformed rows', () => {
  const source = '{"id":1}\r\n \t \r\n\r\n{"broken":\r\n{"id":2}'
  const result = parseLineDelimitedJson(source)

  assert.deepEqual(result.records, [{ id: 1 }, { id: 2 }])
  assert.equal(result.errors.length, 1)
  assert.deepEqual(Object.keys(result.errors[0]), ['rowNumber', 'message'])
  assert.equal(result.errors[0].rowNumber, 4)
  assert.equal(typeof result.errors[0].message, 'string')
  assert.notEqual(result.errors[0].message, '')
})

test('returns no records or errors for empty and blank input', () => {
  assert.deepEqual(parseLineDelimitedJson(''), { records: [], errors: [] })
  assert.deepEqual(parseLineDelimitedJson(' \n\t\r\n'), { records: [], errors: [] })
})

test('does not validate record shapes or remove duplicates', () => {
  const source = [
    '{"id":"duplicate"}',
    '{"id":"duplicate"}',
    '{"wrongSchemaForImporters":true}'
  ].join('\n')

  assert.deepEqual(parseLineDelimitedJson(source), {
    records: [
      { id: 'duplicate' },
      { id: 'duplicate' },
      { wrongSchemaForImporters: true }
    ],
    errors: []
  })
})
