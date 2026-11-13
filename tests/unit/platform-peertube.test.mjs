import assert from 'node:assert/strict'
import test from 'node:test'

import peertube from '../../src/platforms/peertube.js'

const UUID = '11111111-2222-4333-8444-555555555555'
const OTHER_UUID = '66666666-7777-4888-9999-000000000000'
const SHORT_UUID = 'aBcDeFgHiJkLmNoPqRsTuV'

/**
 * Answers requests by URL without the query, and records them.
 * @param {Record<string, unknown>} routes
 */
function fakeFetch(routes) {
  const requests = []
  const fetcher = async (url, options) => {
    requests.push({ url: new URL(url), options })
    const { origin, pathname } = new URL(url)
    const route = routes[origin + pathname]
    const body = typeof route === 'function' ? route(new URL(url)) : route
    return body === undefined ? new Response('Not found', { status: 404 }) : Response.json(body)
  }
  return { fetcher, requests }
}

function video(overrides = {}) {
  return {
    uuid: UUID,
    shortUUID: SHORT_UUID,
    url: `https://video.example.org/videos/watch/${UUID}`,
    name: 'A video',
    privacy: { id: 1, label: 'Public' },
    duration: 125,
    views: 42,
    isLive: false,
    publishedAt: '2026-03-02T10:00:00Z',
    originallyPublishedAt: null,
    thumbnailPath: '/lazy-static/thumbnails/small.jpg',
    previewPath: '/lazy-static/thumbnails/preview.jpg',
    channel: { name: 'my_channel', host: 'video.example.org', displayName: 'My Channel' },
    account: { name: 'me', host: 'video.example.org', displayName: 'Me' },
    ...overrides
  }
}

const channel = { platform: 'peertube', id: 'my_channel@video.example.org', name: 'My Channel', url: 'https://video.example.org/c/my_channel' }

test('reads channel IDs from instance pages only', () => {
  assert.equal(peertube.parseChannelUrl('https://video.example.org/c/my_channel'), 'my_channel@video.example.org')
  assert.equal(peertube.parseChannelUrl('https://Video.Example.org/video-channels/my_channel/videos?sort=-views'), 'my_channel@video.example.org')
  // Instances show remote channels, which live on their own host
  assert.equal(peertube.parseChannelUrl('https://tube.example.net/c/my_channel@Video.Example.org/videos'), 'my_channel@video.example.org')
  assert.equal(peertube.parseChannelUrl('https://tube.example.net/video-channels/my_channel%40video.example.org'), 'my_channel@video.example.org')

  for (const url of [
    'https://www.youtube.com/c/my_channel',
    'https://m.youtube.com/c/my_channel',
    'https://twitch.tv/c/my_channel',
    'https://192.0.2.1/c/my_channel',
    'https://0x7f.0x1/c/my_channel',
    'https://[::1]/c/my_channel',
    'https://localhost/c/my_channel',
    'https://tube.local/c/my_channel',
    'https://video.example.org:8443/c/my_channel',
    'https://user:pass@video.example.org/c/my_channel',
    'https://video.example.org/c/my_channel@127.0.0.1',
    'https://video.example.org/c/my_channel@youtube.com',
    'https://video.example.org/c/..',
    'https://video.example.org/c/',
    'https://video.example.org/a/my_account',
    'ftp://video.example.org/c/my_channel',
    'not a url'
  ]) {
    assert.equal(peertube.parseChannelUrl(url), null, url)
  }
})

test('loads channels from their own instance, with fitting images', async () => {
  const { fetcher, requests } = fakeFetch({
    'https://video.example.org/api/v1/video-channels/my_channel': {
      name: 'my_channel',
      host: 'video.example.org',
      displayName: '  My Channel  ',
      url: 'https://video.example.org/video-channels/my_channel',
      description: 'About',
      followersCount: 12,
      avatars: [
        { width: 1500, fileUrl: 'https://video.example.org/avatars/1500.png' },
        { width: 48, fileUrl: 'https://video.example.org/avatars/48.png' },
        { width: 600, fileUrl: 'https://video.example.org/avatars/600.png' }
      ],
      banners: [{ width: 1920, path: '/banners/1920.jpg' }]
    },
    // Older instances have one avatar with a path on the instance
    'https://old.example.net/api/v1/video-channels/old_channel': {
      name: 'old_channel',
      host: 'old.example.net',
      displayName: '',
      avatar: { path: '/static/avatars/old.png' },
      banners: []
    }
  })

  assert.deepEqual(await peertube.getChannel(fetcher, 'my_channel@video.example.org'), {
    platform: 'peertube',
    id: 'my_channel@video.example.org',
    name: 'My Channel',
    url: 'https://video.example.org/video-channels/my_channel',
    avatar: 'https://video.example.org/avatars/600.png',
    banner: 'https://video.example.org/banners/1920.jpg',
    description: 'About',
    followerCount: 12
  })
  assert.deepEqual(await peertube.getChannel(fetcher, 'old_channel@old.example.net'), {
    platform: 'peertube',
    id: 'old_channel@old.example.net',
    name: 'old_channel',
    url: 'https://old.example.net/c/old_channel',
    avatar: 'https://old.example.net/static/avatars/old.png'
  })
  assert.equal(await peertube.getChannel(fetcher, 'gone@video.example.org'), null)
  assert.equal(await peertube.getChannel(fetcher, 'my_channel@localhost'), null)
  assert.equal(requests.length, 3)
  assert.ok(requests.every(({ options }) => options.credentials === 'omit' && options.referrerPolicy === 'no-referrer' && options.signal))

  await assert.rejects(peertube.getChannel(async () => new Response('', { status: 503 }), 'my_channel@video.example.org'), /HTTP 503/)
})

test('pages through channel videos and lists remote, live and private ones correctly', async () => {
  const { fetcher, requests } = fakeFetch({
    'https://video.example.org/api/v1/video-channels/my_channel/videos': {
      total: 45,
      data: [
        video({
          originallyPublishedAt: '2020-01-01T00:00:00Z',
          thumbnails: [
            { width: 1920, height: 1080, fileUrl: 'https://video.example.org/thumbnails/1920.jpg' },
            { width: 280, height: 157, fileUrl: 'https://video.example.org/thumbnails/280.jpg' },
            { width: 850, height: 480, fileUrl: 'https://video.example.org/thumbnails/850.jpg' }
          ]
        }),
        video({ uuid: OTHER_UUID, url: null, name: 'Live', isLive: true, duration: 0, channel: { name: 'remote', host: 'tube.example.net', displayName: 'Remote' } }),
        video({ name: 'Unlisted', privacy: { id: 2, label: 'Unlisted' } }),
        video({ uuid: 'not-a-uuid', shortUUID: null })
      ]
    }
  })

  const page = await peertube.getChannelPage(fetcher, channel, 'videos', '20')

  const query = requests[0].url.searchParams
  assert.deepEqual([query.get('start'), query.get('count'), query.get('sort')], ['20', '20', '-publishedAt'])
  assert.equal(page.continuation, '40')
  assert.deepEqual(page.results, [
    {
      kind: 'item',
      item: {
        platform: 'peertube',
        id: UUID,
        url: `https://video.example.org/videos/watch/${UUID}`,
        title: 'A video',
        author: 'My Channel',
        channelId: 'my_channel@video.example.org',
        thumbnail: 'https://video.example.org/thumbnails/850.jpg',
        published: Date.parse('2020-01-01T00:00:00Z'),
        duration: 125,
        viewCount: 42
      }
    },
    {
      kind: 'item',
      item: {
        platform: 'peertube',
        id: OTHER_UUID,
        url: `https://video.example.org/w/${SHORT_UUID}`,
        title: 'Live',
        author: 'Remote',
        channelId: 'remote@tube.example.net',
        // Instances serve their own copies of the images of remote videos
        thumbnail: 'https://video.example.org/lazy-static/thumbnails/preview.jpg',
        published: Date.parse('2026-03-02T10:00:00Z'),
        isLive: true,
        viewCount: 42
      }
    }
  ])

  const last = await peertube.getChannelPage(fetcher, channel, 'videos', '40')
  assert.equal(last.continuation, null)
})

test('lists the lives on air before the newest uploads', async () => {
  const LIVE_UUID = '3c2e6c87-4d2f-4f1a-9a5b-2d0c1e6f7a8b'
  const { fetcher } = fakeFetch({
    // The live started before the newest uploads, so it isn't among them
    'https://video.example.org/api/v1/video-channels/my_channel/videos': url => url.searchParams.get('isLive') === 'true'
      ? { total: 1, data: [video({ uuid: LIVE_UUID, shortUUID: null, name: 'On air', isLive: true })] }
      : { total: 1, data: [video()] }
  })
  assert.deepEqual((await peertube.getLatestItems(fetcher, channel)).map(item => [item.id, item.isLive]), [[LIVE_UUID, true], [UUID, undefined]])

  // Instances that can't filter lives still have the uploads
  const older = fakeFetch({
    'https://video.example.org/api/v1/video-channels/my_channel/videos': url => url.searchParams.has('isLive') ? undefined : { total: 1, data: [video()] }
  })
  assert.deepEqual((await peertube.getLatestItems(older.fetcher, channel)).map(item => item.id), [UUID])
})

test('loads playlists without their removed videos', async () => {
  const base = `https://video.example.org/api/v1/video-playlists/${SHORT_UUID}`
  const { fetcher } = fakeFetch({
    [base]: {
      uuid: UUID,
      shortUUID: SHORT_UUID,
      url: `https://video.example.org/video-playlists/${UUID}`,
      displayName: 'A playlist',
      privacy: { id: 2, label: 'Unlisted' },
      videosLength: 3,
      thumbnailPath: '/lazy-static/thumbnails/playlist.jpg',
      ownerAccount: { name: 'me', host: 'video.example.org', displayName: 'Me' },
      videoChannel: null
    },
    [`${base}/videos`]: {
      total: 3,
      data: [{ position: 1, video: video() }, { position: 2, video: null }, { position: 3, video: video({ uuid: OTHER_UUID }) }]
    }
  })

  const { playlist, page } = await peertube.getPlaylist(fetcher, `${SHORT_UUID}@video.example.org`, null)

  assert.deepEqual(playlist, {
    platform: 'peertube',
    id: `${SHORT_UUID}@video.example.org`,
    url: `https://video.example.org/video-playlists/${UUID}`,
    title: 'A playlist',
    author: 'Me',
    channelId: '',
    thumbnail: 'https://video.example.org/lazy-static/thumbnails/playlist.jpg',
    itemCount: 3
  })
  assert.deepEqual(page.results.map(result => result.kind === 'item' && result.item.id), [UUID, OTHER_UUID])
  assert.equal(page.continuation, null)

  assert.deepEqual(await peertube.getPlaylist(fetcher, `${UUID}@video.example.org`, null), { playlist: null, page: { results: [], continuation: null } })
})

test('searches videos, channels and playlists on SepiaSearch', async () => {
  const { fetcher, requests } = fakeFetch({
    'https://sepiasearch.org/api/v1/search/videos': {
      total: 1,
      data: [
        video({ thumbnailPath: '/small.jpg', thumbnailUrl: 'https://video.example.org/small.jpg', previewUrl: 'https://video.example.org/preview.jpg' }),
        // Results from instances that can't be reached are left out
        video({ channel: { name: 'lan', host: '10.0.0.2', displayName: 'LAN' }, account: null })
      ]
    },
    'https://sepiasearch.org/api/v1/search/video-channels': {
      total: 30,
      data: [{
        name: 'remote',
        host: 'tube.example.net',
        displayName: 'Remote',
        url: 'https://tube.example.net/video-channels/remote',
        followersCount: 7,
        avatars: [{ width: 120, url: 'https://tube.example.net/avatars/120.png', path: '/avatars/120.png' }]
      }]
    },
    'https://sepiasearch.org/api/v1/search/video-playlists': {
      total: 1,
      data: [{
        uuid: UUID,
        url: `https://tube.example.net/videos/watch/playlist/${UUID}`,
        displayName: 'Found playlist',
        privacy: { id: 1 },
        videosLength: 4,
        thumbnailUrl: 'https://tube.example.net/playlist.jpg',
        ownerAccount: { name: 'owner', host: 'tube.example.net', displayName: 'Owner' },
        videoChannel: { name: 'remote', host: 'tube.example.net', displayName: 'Remote' }
      }]
    }
  })

  const videos = await peertube.search(fetcher, '  open movie ', 'videos', null)
  const channels = await peertube.search(fetcher, 'open movie', 'channels', '0')
  const playlists = await peertube.search(fetcher, 'open movie', 'playlists', null)

  assert.deepEqual(videos.results.map(result => result.kind === 'item' && [result.item.url, result.item.thumbnail]), [
    [`https://video.example.org/videos/watch/${UUID}`, 'https://video.example.org/preview.jpg']
  ])
  assert.equal(videos.continuation, null)
  assert.deepEqual(channels, {
    results: [{
      kind: 'channel',
      channel: {
        platform: 'peertube',
        id: 'remote@tube.example.net',
        name: 'Remote',
        url: 'https://tube.example.net/video-channels/remote',
        avatar: 'https://tube.example.net/avatars/120.png',
        followerCount: 7
      }
    }],
    continuation: '20'
  })
  assert.deepEqual(playlists.results, [{
    kind: 'playlist',
    playlist: {
      platform: 'peertube',
      id: `${UUID}@tube.example.net`,
      url: `https://tube.example.net/videos/watch/playlist/${UUID}`,
      title: 'Found playlist',
      author: 'Remote',
      channelId: 'remote@tube.example.net',
      thumbnail: 'https://tube.example.net/playlist.jpg',
      itemCount: 4
    }
  }])
  const query = requests[0].url.searchParams
  assert.deepEqual([query.get('search'), query.get('start'), query.get('count'), query.get('nsfw')], ['open movie', '0', '20', 'false'])

  assert.deepEqual(await peertube.search(fetcher, '   ', 'videos', null), { results: [], continuation: null })
  assert.deepEqual(await peertube.search(fetcher, 'open movie', 'tracks', null), { results: [], continuation: null })
  assert.equal(requests.length, 3)
})
