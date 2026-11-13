import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchTwitchChannels, findTwitchChannel, getTwitchLiveNotificationTarget, parseTwitchChannelLogin } from '../../src/twitchFollows.js'

function user(overrides = {}) {
  return {
    id: '1001',
    login: 'Streamer',
    displayName: 'Streamer',
    profileImageURL: 'https://cdn.example.test/avatar.png',
    stream: null,
    videos: { edges: [] },
    clips: { edges: [] },
    ...overrides
  }
}

test('reads channel logins from names and channel addresses only', () => {
  assert.equal(parseTwitchChannelLogin(' @Streamer_1 '), 'streamer_1')
  assert.equal(parseTwitchChannelLogin('twitch.tv/Streamer'), 'streamer')
  assert.equal(parseTwitchChannelLogin('https://www.twitch.tv/streamer/videos?filter=archives'), 'streamer')
  assert.equal(parseTwitchChannelLogin('https://m.twitch.tv/streamer'), 'streamer')
  assert.equal(parseTwitchChannelLogin('https://www.twitch.tv/videos/12345'), null)
  assert.equal(parseTwitchChannelLogin('https://www.twitch.tv/directory'), null)
  assert.equal(parseTwitchChannelLogin('https://twitch.tv.example.test/streamer'), null)
  assert.equal(parseTwitchChannelLogin('https://user:pass@www.twitch.tv/streamer'), null)
  assert.equal(parseTwitchChannelLogin('not a channel'), null)
})

test('lists live streams, videos and clips without the archive of the running stream', async () => {
  const requests = []
  const fetcher = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body), clientId: options.headers['Client-ID'] })
    return Response.json({
      errors: [{ message: 'service error', path: ['users', 1, 'clips'] }],
      data: {
        users: [
          user({
            stream: {
              id: 'stream-1',
              title: '  Live now  ',
              createdAt: '2026-01-02T10:00:00Z',
              viewersCount: 50,
              previewImageURL: 'https://cdn.example.test/live.jpg',
              game: { displayName: 'Chess' },
              archiveVideo: { id: '30' }
            },
            videos: {
              edges: [
                { node: { id: '30', title: 'Running archive', publishedAt: '2026-01-02T10:00:00Z' } },
                { node: { id: '20', title: 'Older VOD', publishedAt: '2026-01-01T10:00:00Z', lengthSeconds: 3600, viewCount: 7, previewThumbnailURL: 'javascript:alert(1)' } }
              ]
            },
            clips: { edges: [{ node: { slug: 'Funny-Clip_1', title: 'Clip', createdAt: '2026-01-01T12:00:00Z', durationSeconds: 30 } }] }
          }),
          // The clip service failed for this channel
          user({
            id: '1002',
            login: 'other',
            displayName: '',
            stream: { id: 'stream-2', title: '', viewersCount: 500 },
            videos: { edges: [{ node: { id: '40', title: 'Newest VOD', publishedAt: '2026-01-03T10:00:00Z' } }] },
            clips: null
          }),
          // Deleted channels have no user
          null
        ]
      }
    })
  }

  const { channels, feed } = await fetchTwitchChannels(fetcher, ['1001', '1002', '1003', 'not-an-id', '1001'])

  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://gql.twitch.tv/gql')
  assert.ok(requests[0].clientId)
  assert.deepEqual(requests[0].body.variables, { ids: ['1001', '1002', '1003'] })
  assert.deepEqual(channels, [
    { id: '1001', login: 'streamer', name: 'Streamer', avatar: 'https://cdn.example.test/avatar.png' },
    { id: '1002', login: 'other', name: 'other', avatar: 'https://cdn.example.test/avatar.png' }
  ])
  // Most viewers first
  assert.deepEqual(feed.live.map(item => [item.id, item.url, item.title]), [
    ['stream-2', 'https://www.twitch.tv/other', 'other'],
    ['stream-1', 'https://www.twitch.tv/streamer', 'Live now']
  ])
  assert.ok(feed.live.every(item => item.isLive === true))
  assert.equal(feed.live[1].category, 'Chess')
  assert.equal(feed.live[1].published, Date.parse('2026-01-02T10:00:00Z'))
  // Newest first, without the running archive
  assert.deepEqual(feed.videos.map(item => [item.url, item.author]), [
    ['https://www.twitch.tv/videos/40', 'other'],
    ['https://www.twitch.tv/videos/20', 'Streamer']
  ])
  assert.equal(feed.videos[1].thumbnail, '')
  assert.equal(feed.videos[1].duration, 3600)
  assert.deepEqual(feed.clips.map(item => item.url), ['https://www.twitch.tv/streamer/clip/Funny-Clip_1'])
})

test('loads many channels in batches and only the live status when asked', async () => {
  const requests = []
  const fetcher = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    return Response.json({ data: { users: body.variables.ids.map(id => user({ id, login: `user${id}` })) } })
  }

  const ids = Array.from({ length: 45 }, (_, index) => String(index + 1))
  const { channels } = await fetchTwitchChannels(fetcher, ids, { liveOnly: true })

  // Each channel once, split over several requests
  assert.ok(requests.length > 1)
  assert.deepEqual(requests.flatMap(body => body.variables.ids).sort((a, b) => a - b), ids)
  assert.equal(channels.length, 45)
  assert.ok(requests.every(body => !body.query.includes('videos(') && !body.query.includes('clips(')))
})

test('fails for errors that leave no data, and finds no unknown channels', async () => {
  await assert.rejects(fetchTwitchChannels(async () => new Response('', { status: 503 }), ['1']), /HTTP 503/)
  await assert.rejects(fetchTwitchChannels(async () => Response.json({ errors: [{ message: 'failed' }] }), ['1']), /no data/)
  // A failed list of channels isn't an empty one, which would clear their cached items
  await assert.rejects(fetchTwitchChannels(async () => Response.json({ data: { users: null }, errors: [{ message: 'failed' }] }), ['1']), /no channels/)

  assert.equal(await findTwitchChannel(async () => Response.json({ data: { user: null } }), 'unknown'), null)
  let requested = false
  assert.equal(await findTwitchChannel(async () => { requested = true }, 'not a login'), null)
  assert.equal(requested, false)
})

test('notifications only lead to the live page of a valid channel, one per broadcast', () => {
  assert.deepEqual(getTwitchLiveNotificationTarget('Streamer', '123'), {
    kind: 'live',
    path: '/external-media',
    query: { url: 'https://www.twitch.tv/streamer', stream: '123' }
  })
  assert.equal(getTwitchLiveNotificationTarget('../settings', '123'), null)
  assert.equal(getTwitchLiveNotificationTarget('streamer', '1&url=https://example.test'), null)
  assert.equal(getTwitchLiveNotificationTarget({ login: 'streamer' }, '123'), null)
})

test('loads channels with all-digit logins by their login, not as user IDs', async () => {
  const { default: twitch } = await import('../../src/platforms/twitch.js')
  const requests = []
  const fetcher = async (_url, options) => {
    requests.push(JSON.parse(options.body).variables)
    return Response.json({ data: { user: { id: '987', login: '123456', displayName: 'Digits' } } })
  }

  assert.equal(twitch.parseChannelUrl('https://www.twitch.tv/123456'), '@123456')
  assert.equal(twitch.parseChannelUrl('https://www.twitch.tv/Streamer'), 'streamer')
  assert.equal(twitch.parseChannelUrl('https://www.twitch.tv/streamer/videos?filter=archives'), 'streamer')
  // Clips and videos aren't pages of the channel
  assert.equal(twitch.parseChannelUrl('https://www.twitch.tv/streamer/clip/Some-Slug_1'), null)
  assert.equal(twitch.parseChannelUrl('https://www.twitch.tv/streamer/v/123'), null)
  assert.equal((await twitch.getChannel(fetcher, '@123456'))?.id, '987')
  await twitch.getChannel(fetcher, '987')
  assert.deepEqual(requests, [{ login: '123456' }, { id: '987' }])
})
