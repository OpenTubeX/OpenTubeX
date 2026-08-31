import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIME_FORMAT,
  formatDate,
  formatDateTime,
  formatTime,
  normalizeDateFormat,
  normalizeTimeFormat,
} from '../../src/renderer/helpers/dateFormat.js'

const date = new Date('2024-04-15T19:05:00Z')
const dateOptions = { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' }

test('uses the locale date order by default', () => {
  assert.equal(formatDate(date, 'en-US', DEFAULT_DATE_FORMAT, dateOptions), '4/15/2024')
  assert.equal(formatDate(date, 'en-GB', DEFAULT_DATE_FORMAT, dateOptions), '15/04/2024')
})

test('supports each explicit date format independently of the locale', () => {
  const expectedFormats = {
    'MM/DD/YYYY': '04/15/2024',
    'DD/MM/YYYY': '15/04/2024',
    'YYYY-MM-DD': '2024-04-15',
    'YYYY/MM/DD': '2024/04/15',
    'DD.MM.YYYY': '15.04.2024',
    'MM.DD.YYYY': '04.15.2024',
  }

  for (const [format, expected] of Object.entries(expectedFormats)) {
    assert.equal(formatDate(date, 'en-US', format, dateOptions), expected)
  }
})

test('uses the locale clock by default and supports explicit 12-hour and 24-hour clocks', () => {
  const timeOptions = { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }

  assert.equal(formatTime(date, 'en-US', DEFAULT_TIME_FORMAT, timeOptions), '7:05 PM')
  assert.equal(formatTime(date, 'en-US', '12-hour', timeOptions), '7:05 PM')
  assert.equal(formatTime(date, 'en-US', '24-hour', timeOptions), '19:05')
  assert.equal(formatTime(date, 'de-DE', DEFAULT_TIME_FORMAT, timeOptions), '19:05')
  assert.equal(formatTime(date, 'de-DE', '12-hour', timeOptions), '7:05 PM')
})

test('combines independently selected date and time formats', () => {
  assert.equal(
    formatDateTime(
      date,
      'en-US',
      'DD.MM.YYYY',
      { timeZone: 'UTC' },
      { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' },
      '24-hour'
    ),
    '15.04.2024, 19:05'
  )
})

test('falls back to locale formatting for unknown saved values', () => {
  assert.equal(normalizeDateFormat('unknown'), DEFAULT_DATE_FORMAT)
  assert.equal(normalizeTimeFormat('unknown'), DEFAULT_TIME_FORMAT)
  assert.equal(formatDate(date, 'en-US', 'unknown', dateOptions), '4/15/2024')
  assert.equal(
    formatTime(date, 'en-US', 'unknown', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }),
    '7:05 PM'
  )
})
