import assert from 'node:assert/strict'
import test from 'node:test'

import { getTwitchCreatorUrl, resolveYtDlpCreatorAvatarUrl } from '../../src/main/ytDlpCreatorAvatar.js'
import { TWITCH_CHAT_CLIENT_ID } from '../../src/twitchChatReplayRequest.js'

test('uses an avatar URL supplied by yt-dlp without another request', async () => {
  const url = await resolveYtDlpCreatorAvatarUrl({
    channel_thumbnail: 'https://images.example.test/channel.png'
  }, () => { throw new Error('unexpected profile request') })
  assert.equal(url, 'https://images.example.test/channel.png')
})

test('resolves Twitch avatars when the profile page contains only the client shell', async () => {
  const avatar = await resolveYtDlpCreatorAvatarUrl({
    webpage_url: 'https://www.twitch.tv/videos/123456789',
    uploader_id: 'example_streamer'
  }, async url => url === 'https://gql.twitch.tv/gql'
    ? Response.json({ data: { user: { profileImageURL: 'https://static-cdn.jtvnw.net/profile_image-300x300.png' } } })
    : new Response('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Twitch</title></head><body><script src="client.js"></script></body></html>', {
        headers: { 'content-type': 'text/html' }
      }))
  assert.equal(avatar, 'https://static-cdn.jtvnw.net/profile_image-300x300.png')
})

test('reads the SoundCloud creator image from the uploader profile', async () => {
  const url = await resolveYtDlpCreatorAvatarUrl({
    webpage_url: 'https://soundcloud.com/creator/track',
    uploader_url: 'https://soundcloud.com/creator'
  }, async profileUrl => {
    assert.equal(profileUrl, 'https://soundcloud.com/creator')
    return new Response('<meta property="og:type" content="music.musician"><meta property="og:image" content="https://i1.sndcdn.com/avatars-creator.jpg">', {
      headers: { 'content-type': 'text/html' }
    })
  })
  assert.equal(url, 'https://i1.sndcdn.com/avatars-creator.jpg')
})

test('reads the TikTok avatar from its profile data', async () => {
  const url = await resolveYtDlpCreatorAvatarUrl({
    webpage_url: 'https://www.tiktok.com/@creator/video/123',
    uploader_url: 'https://www.tiktok.com/@creator'
  }, async () => new Response('<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{"userInfo":{"user":{"avatarThumb":"https:\\u002F\\u002Fcdn.example.test\\u002Favatar.jpg"}}}</script>', {
    headers: { 'content-type': 'text/html' }
  }))
  assert.equal(url, 'https://cdn.example.test/avatar.jpg')
})

test('reads the Twitch broadcaster image from profile metadata', async () => {
  const url = await resolveYtDlpCreatorAvatarUrl({
    webpage_url: 'https://clips.twitch.tv/SomeClip',
    channel: 'Creator_1',
    uploader_id: '12345'
  }, async (url, options) => {
    assert.equal(url, 'https://gql.twitch.tv/gql')
    assert.equal(options.method, 'POST')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'manual')
    assert.equal(options.headers['Client-ID'], TWITCH_CHAT_CLIENT_ID)
    assert.deepEqual(JSON.parse(options.body).variables, { login: 'creator_1' })
    return Response.json({ data: { user: { profileImageURL: 'https://static-cdn.jtvnw.net/profile_image-300x300.png' } } })
  })
  assert.equal(url, 'https://static-cdn.jtvnw.net/profile_image-300x300.png')
})

for (const webpageUrl of [
  'https://www.twitch.tv/videos/123456789',
  'https://www.twitch.tv/example_streamer',
  'https://go.twitch.tv/videos/123456789',
  'https://go.twitch.tv/example_streamer',
  'https://player.twitch.tv/?video=123456789',
  'https://player.twitch.tv/?channel=example_streamer'
]) {
  test(`links the Twitch uploader ID to its profile for ${webpageUrl}`, () => {
    assert.equal(getTwitchCreatorUrl({ webpage_url: webpageUrl, uploader_id: 'example_streamer' }),
      'https://www.twitch.tv/example_streamer')
  })
  test(`resolves the Twitch avatar with only an uploader ID for ${webpageUrl}`, async () => {
    const avatar = await resolveYtDlpCreatorAvatarUrl({
      webpage_url: webpageUrl,
      uploader: 'example_streamer',
      uploader_id: 'example_streamer'
    }, async (url, options) => {
      assert.equal(url, 'https://gql.twitch.tv/gql')
      assert.deepEqual(JSON.parse(options.body).variables, { login: 'example_streamer' })
      return Response.json({ data: { user: { profileImageURL: 'https://static-cdn.jtvnw.net/profile_image-300x300.png' } } })
    })
    assert.equal(avatar, 'https://static-cdn.jtvnw.net/profile_image-300x300.png')
  })
}

test('handles unavailable Twitch metadata and rejects unsafe avatar URLs', async () => {
  const info = { webpage_url: 'https://www.twitch.tv/example_streamer', uploader_id: 'example_streamer' }
  for (const payload of [
    { data: { user: null } },
    { errors: [{ message: 'Unavailable' }] },
    { data: { user: { profileImageURL: 'http://images.example.test/avatar.png' } } },
    { data: { user: { profileImageURL: 'javascript:alert(1)' } } }
  ]) {
    assert.equal(await resolveYtDlpCreatorAvatarUrl(info, async () => Response.json(payload)), null)
  }
  assert.equal(await resolveYtDlpCreatorAvatarUrl(info, async () => new Response(null, { status: 403 })), null)
})

test('does not derive Twitch profiles from unrelated URLs or invalid logins', () => {
  for (const webpageUrl of ['https://twitch.tv.example.test/videos/1', 'http://www.twitch.tv/creator', 'not a URL']) {
    assert.equal(getTwitchCreatorUrl({ webpage_url: webpageUrl, uploader_id: 'creator' }), null)
  }
  for (const login of ['../other', 'creator/videos', '', 123, null]) {
    assert.equal(getTwitchCreatorUrl({ webpage_url: 'https://www.twitch.tv/videos/1', uploader_id: login }), null)
  }
  assert.equal(getTwitchCreatorUrl({ webpage_url: 'https://clips.twitch.tv/SomeClip', channel: 'Creator_1' }),
    'https://www.twitch.tv/creator_1')
})

test('does not replace an invalid clip broadcaster with its numeric curator ID', async () => {
  const info = { webpage_url: 'https://clips.twitch.tv/SomeClip', channel: 'Creator name', uploader_id: '12345' }
  assert.equal(getTwitchCreatorUrl(info), null)
  assert.equal(await resolveYtDlpCreatorAvatarUrl(info, () => { throw new Error('unexpected curator lookup') }), null)
})

test('reads the Dailymotion user image from the public user API', async () => {
  const url = await resolveYtDlpCreatorAvatarUrl({
    webpage_url: 'https://www.dailymotion.com/video/abc',
    uploader_id: 'x1nlbcv'
  }, async profileUrl => {
    assert.equal(profileUrl, 'https://api.dailymotion.com/user/x1nlbcv?fields=avatar_360_url')
    return new Response(JSON.stringify({ avatar_360_url: 'https://s2.dmcdn.net/u/avatar/360x360' }), {
      headers: { 'content-type': 'application/json' }
    })
  })
  assert.equal(url, 'https://s2.dmcdn.net/u/avatar/360x360')
})

test('ignores unsafe profile URLs and failed lookups', async () => {
  let requests = 0
  const fetchPage = async () => { requests++; throw new Error('offline') }
  assert.equal(await resolveYtDlpCreatorAvatarUrl({
    webpage_url: 'https://soundcloud.com/creator/track',
    uploader_url: 'http://localhost/private'
  }, fetchPage), null)
  assert.equal(requests, 0)
  assert.equal(await resolveYtDlpCreatorAvatarUrl({
    webpage_url: 'https://soundcloud.com/creator/track',
    uploader_url: 'https://soundcloud.com/creator'
  }, fetchPage), null)
  assert.equal(requests, 1)
})

test('stops reading an oversized profile response without a content length', async () => {
  let chunksRead = 0
  const body = new ReadableStream({
    pull(controller) {
      chunksRead++
      controller.enqueue(new Uint8Array(400_000))
    }
  })
  const avatar = await resolveYtDlpCreatorAvatarUrl({
    webpage_url: 'https://soundcloud.com/creator/track',
    uploader_url: 'https://soundcloud.com/creator'
  }, async () => new Response(body, { headers: { 'content-type': 'text/html' } }))
  assert.equal(avatar, null)
  assert.ok(chunksRead < 10)
})
