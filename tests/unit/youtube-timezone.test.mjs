import assert from 'node:assert/strict'
import test from 'node:test'

import { appendYouTubeTimeZonePreference } from '../../src/main/utils.js'

test('appends the resolved timezone to an existing YouTube cookie', () => {
  assert.equal(
    appendYouTubeTimeZonePreference('SOCS=value', 'Europe/Warsaw'),
    'SOCS=value;PREF=tz=Europe.Warsaw'
  )
})

test('keeps the YouTube cookie unchanged when Intl cannot resolve the timezone', () => {
  assert.equal(appendYouTubeTimeZonePreference('SOCS=value', undefined), 'SOCS=value')
})

test('does not create a cookie when YouTube did not send one', () => {
  assert.equal(appendYouTubeTimeZonePreference(undefined, 'Europe/Warsaw'), '')
})
