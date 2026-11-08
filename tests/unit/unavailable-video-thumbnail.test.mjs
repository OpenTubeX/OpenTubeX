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

test('uses the light and dark frame colors', () => {
  assert.notEqual(createUnavailableVideoThumbnail(icon, true), createUnavailableVideoThumbnail(icon, false))
})

test('keeps the frame when the glyph is unavailable', () => {
  const svg = decode(createUnavailableVideoThumbnail(null, true))

  assert.match(svg, /<rect/)
  assert.doesNotMatch(svg, /currentColor/)
})

test('honors glyphs with their own size', () => {
  assert.match(decode(createUnavailableVideoThumbnail({ body: '<path d="M0 0"/>', width: 32, height: 16 }, false)), /viewBox="0 0 32 16"/)
  assert.match(decode(createUnavailableVideoThumbnail({ body: '<path d="M0 0"/>' }, false)), /viewBox="0 0 16 16"/)
})
