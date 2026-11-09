import assert from 'node:assert/strict'
import test from 'node:test'

import { createUnavailableVideoThumbnail } from '../../src/renderer/helpers/unavailableVideoThumbnail.js'

/** @param {string} url */
function decode(url) {
  assert.match(url, /^data:image\/svg\+xml;charset=utf-8,/)
  return decodeURIComponent(url.slice(url.indexOf(',') + 1))
}

const icon = { body: '<path fill="currentColor" d="M1 1h22v22H1z"/>', width: 24, height: 24 }

test('draws the selected pack glyph in the frame without contacting any server', () => {
  const svg = decode(createUnavailableVideoThumbnail(icon, true))

  assert.ok(svg.includes(icon.body))
  assert.match(svg, /viewBox="0 0 24 24"/)
  assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/)
})
