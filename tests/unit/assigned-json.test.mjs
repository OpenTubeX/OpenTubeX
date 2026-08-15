import assert from 'node:assert/strict'
import test from 'node:test'

import { extractAssignedJsonObject } from '../../src/renderer/helpers/assigned-json.js'

test('extracts a multiline assigned JSON object', () => {
  const json = `{
    "videoDetails": {
      "isLive": true,
      "isLiveContent": false
    }
  }`

  assert.equal(
    extractAssignedJsonObject(`ytInitialPlayerResponse = ${json};`, 'ytInitialPlayerResponse'),
    json
  )
})

test('ignores braces and assignment terminators inside JSON strings', () => {
  const json = JSON.stringify({
    message: 'contains }; and { braces',
    escaped: 'a quote: " and a slash: \\',
    nested: { isLive: true }
  })

  assert.equal(
    extractAssignedJsonObject(`ytInitialPlayerResponse = ${json}; nextCall();`, 'ytInitialPlayerResponse'),
    json
  )
})

test('returns no object for missing or incomplete assignments', () => {
  assert.equal(extractAssignedJsonObject('const other = {};', 'ytInitialPlayerResponse'), undefined)
  assert.equal(extractAssignedJsonObject('ytInitialPlayerResponse = {"open": true', 'ytInitialPlayerResponse'), undefined)
})

test('skips non-assignment occurrences before the player response', () => {
  const json = '{"videoDetails":{"isLive":true}}'
  const source = `"ytInitialPlayerResponse is documented here"; ytInitialPlayerResponse = ${json};`

  assert.equal(extractAssignedJsonObject(source, 'ytInitialPlayerResponse'), json)
})
