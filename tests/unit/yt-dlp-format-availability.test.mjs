import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getYtDlpFormatAvailabilityWaitMs,
  MAX_YT_DLP_FORMAT_AVAILABILITY_WAIT_MS,
  waitForYtDlpFormatAvailability,
} from '../../src/renderer/helpers/player/ytDlpFormatAvailability.js'

test('yt-dlp format availability uses the current whole second', () => {
  assert.equal(getYtDlpFormatAvailabilityWaitMs(104, 100999), 4000)
  assert.equal(getYtDlpFormatAvailabilityWaitMs(null, 100999), -100000)
})

test('yt-dlp format availability rejects an unexpectedly long delay', async () => {
  const availableAt = Math.ceil(Date.now() / 1000) + (MAX_YT_DLP_FORMAT_AVAILABILITY_WAIT_MS / 1000) + 1

  assert.equal(await waitForYtDlpFormatAvailability({ availableAt }), false)
})
