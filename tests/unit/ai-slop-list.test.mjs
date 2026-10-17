import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { Parser, YTNodes } from 'youtubei.js'

import {
  isOnAiSlopList,
  loadCachedAiSlopList,
  parseAiSlopList,
  saveCachedAiSlopList
} from '../../src/renderer/helpers/aiSlopList.js'
import { createLocalFeedParsers, getChannelHandleFromEndpoint } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const CHANNEL_ID = 'UCabcdefghijklmnopqrstuv'

const subscriptionsSource = await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8')
const visibilityStart = subscriptionsSource.indexOf('export function isVideoHiddenByPreferences(')
const visibilitySource = subscriptionsSource.slice(visibilityStart, subscriptionsSource.indexOf('\n}\n', visibilityStart) + 2)
const isVideoHiddenByPreferences = compileFunction(`${visibilitySource.replace('export ', '')}\nreturn isVideoHiddenByPreferences`,
  ['isUpcomingPremiere', 'isOnAiSlopList'])(() => false, isOnAiSlopList)

function useLocalStorage(entries = {}) {
  const values = new Map(Object.entries(entries))
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  }
  return values
}

test('parses handles and channel IDs and skips comments and invalid lines', () => {
  const text = [
    '! Title: AISList - Blocklist',
    '! Total Channels: 4',
    '',
    '@SlopChannel',
    '  @Caf%C3%A9-x1y  ',
    '@CAFÉ',
    CHANNEL_ID,
    'UCtooShort',
    'not a channel',
  ].join('\r\n')

  assert.deepEqual(parseAiSlopList(text), ['@slopchannel', '@café-x1y', '@café', CHANNEL_ID])
})

test('matches videos by case-insensitive handle or exact channel ID', () => {
  const entries = new Set(parseAiSlopList(`@SlopChannel\n@Caf%C3%A9-x1y\n${CHANNEL_ID}`))

  assert.equal(isOnAiSlopList(entries, { authorHandle: '@slopCHANNEL' }), true)
  assert.equal(isOnAiSlopList(entries, { authorHandle: '@Café-x1y' }), true)
  assert.equal(isOnAiSlopList(entries, { authorHandle: '@Caf%C3%A9-X1Y' }), true)
  assert.equal(isOnAiSlopList(entries, { authorId: CHANNEL_ID }), true)
  assert.equal(isOnAiSlopList(entries, { authorId: CHANNEL_ID.toLowerCase() }), false)
  assert.equal(isOnAiSlopList(entries, { authorId: 'UCother', authorHandle: '@other' }), false)
  assert.equal(isOnAiSlopList(entries, {}), false)
  assert.equal(isOnAiSlopList(new Set(), { authorHandle: '@SlopChannel' }), false)
})

test('hides videos from blocklisted channels only when the blocklist is passed', () => {
  const aiSlopChannels = new Set(parseAiSlopList('@SlopChannel'))
  const video = { videoId: 'abcdefghijk', title: 'Title', author: 'Slop Channel', authorId: CHANNEL_ID, authorHandle: '@SlopChannel' }

  assert.equal(isVideoHiddenByPreferences(video, { aiSlopChannels }), true)
  assert.equal(isVideoHiddenByPreferences({ ...video, authorHandle: '@Other' }, { aiSlopChannels }), false)
  assert.equal(isVideoHiddenByPreferences(video), false)
})

test('restores cached lists and ignores malformed caches', () => {
  useLocalStorage()
  saveCachedAiSlopList({ fetchedAt: 123, blocked: ['@a', CHANNEL_ID], warned: [] })
  assert.deepEqual(loadCachedAiSlopList(), { fetchedAt: 123, blocked: ['@a', CHANNEL_ID], warned: [] })

  useLocalStorage({ aiSlopList: '{broken' })
  assert.equal(loadCachedAiSlopList(), null)

  useLocalStorage({ aiSlopList: JSON.stringify({ fetchedAt: 'yesterday', blocked: '', warned: '' }) })
  assert.equal(loadCachedAiSlopList(), null)

  useLocalStorage()
  assert.equal(loadCachedAiSlopList(), null)
})

test('reads the channel handle from browse endpoints', () => {
  assert.equal(getChannelHandleFromEndpoint(new YTNodes.NavigationEndpoint({
    browseEndpoint: { browseId: CHANNEL_ID, canonicalBaseUrl: '/@SlopChannel' }
  })), '@SlopChannel')
  assert.equal(getChannelHandleFromEndpoint(new YTNodes.NavigationEndpoint({
    browseEndpoint: { browseId: CHANNEL_ID, canonicalBaseUrl: `/channel/${CHANNEL_ID}` }
  })), undefined)
  assert.equal(getChannelHandleFromEndpoint(undefined), undefined)
})

test('keeps the channel handle on parsed search result videos', () => {
  const { parseLocalListVideo } = createLocalFeedParsers(() => false)
  const video = Parser.parseItem({
    videoRenderer: {
      videoId: 'abcdefghijk',
      title: { runs: [{ text: 'Title' }] },
      ownerText: {
        runs: [{
          text: 'Slop Channel',
          navigationEndpoint: { browseEndpoint: { browseId: CHANNEL_ID, canonicalBaseUrl: '/@SlopChannel' } }
        }]
      },
    }
  }, YTNodes.Video)

  const parsed = parseLocalListVideo(video)

  assert.equal(parsed.authorId, CHANNEL_ID)
  assert.equal(parsed.authorHandle, '@SlopChannel')
})
