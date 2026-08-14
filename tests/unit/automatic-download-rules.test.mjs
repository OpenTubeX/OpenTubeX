import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_AUTOMATIC_DOWNLOAD_RULE,
  matchesAutomaticDownloadRule,
  normalizeAutomaticDownloadRule,
  parseAutomaticDownloadRules
} from '../../src/renderer/helpers/automaticDownloadRules.js'

const DAY = 24 * 60 * 60 * 1000
const now = Date.parse('2026-08-14T12:00:00Z')

function video(extra = {}) {
  return {
    videoId: 'abcdefghijk',
    title: 'Weekly Open Source Roundup',
    published: now - DAY,
    lengthSeconds: 600,
    isNewInSubscriptionFeed: true,
    ...extra
  }
}

test('parses and normalizes automatic download rules', () => {
  assert.deepEqual(parseAutomaticDownloadRules(''), {})
  assert.deepEqual(parseAutomaticDownloadRules('[]'), {})
  assert.deepEqual(normalizeAutomaticDownloadRule({
    includeVideos: false,
    includeShorts: true,
    minDurationSeconds: '30',
    maxFileSizeMb: 0,
    titleIncludes: null
  }), {
    ...DEFAULT_AUTOMATIC_DOWNLOAD_RULE,
    includeVideos: false,
    includeShorts: true,
    minDurationSeconds: 30,
    maxFileSizeMb: null,
    titleIncludes: ''
  })
})

test('only admits entries announced after the rule was enabled', () => {
  const rule = { enabledAt: now - 2 * DAY }

  assert.equal(matchesAutomaticDownloadRule(video(), 'videos', rule, now), true)
  assert.equal(matchesAutomaticDownloadRule(video({ published: now - 3 * DAY }), 'videos', rule, now), false)
  assert.equal(matchesAutomaticDownloadRule(video({ isNewInSubscriptionFeed: false }), 'videos', rule, now), false)
  assert.equal(matchesAutomaticDownloadRule(video({ published: undefined }), 'videos', rule, now), false)
})

test('applies content-type, duration, age, and title filters', () => {
  const rule = {
    enabledAt: now - 10 * DAY,
    includeVideos: true,
    includeShorts: false,
    includeLivestreams: false,
    minDurationSeconds: 300,
    maxDurationSeconds: 900,
    maxAgeDays: 2,
    titleIncludes: 'linux, open source',
    titleExcludes: 'sponsored, trailer'
  }

  assert.equal(matchesAutomaticDownloadRule(video(), 'videos', rule, now), true)
  assert.equal(matchesAutomaticDownloadRule(video({ lengthSeconds: '2:00' }), 'videos', rule, now), false)
  assert.equal(matchesAutomaticDownloadRule(video({ lengthSeconds: 1200 }), 'videos', rule, now), false)
  assert.equal(matchesAutomaticDownloadRule(video({ published: now - 3 * DAY }), 'videos', rule, now), false)
  assert.equal(matchesAutomaticDownloadRule(video({ title: 'A sponsored open source roundup' }), 'videos', rule, now), false)
  assert.equal(matchesAutomaticDownloadRule(video({ title: 'Unrelated update' }), 'videos', rule, now), false)
  assert.equal(matchesAutomaticDownloadRule(video(), 'shorts', rule, now), false)
  assert.equal(matchesAutomaticDownloadRule(video({ liveNow: true }), 'videos', rule, now), false)
})

test('allows opted-in Shorts and started livestreams but not upcoming streams', () => {
  const rule = {
    enabledAt: now - 2 * DAY,
    includeVideos: false,
    includeShorts: true,
    includeLivestreams: true
  }

  assert.equal(matchesAutomaticDownloadRule(video(), 'shorts', rule, now), true)
  assert.equal(matchesAutomaticDownloadRule(video({ liveNow: true }), 'live', rule, now), true)
  assert.equal(matchesAutomaticDownloadRule(video({ isUpcoming: true }), 'live', rule, now), false)
  assert.equal(matchesAutomaticDownloadRule(video({ premiere: true }), 'videos', rule, now), false)
})
