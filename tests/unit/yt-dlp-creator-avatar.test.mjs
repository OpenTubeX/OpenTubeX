import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveYtDlpCreatorAvatarUrl } from '../../src/main/ytDlpCreatorAvatar.js'

test('uses an avatar URL supplied by yt-dlp without another request', async () => {
  const url = await resolveYtDlpCreatorAvatarUrl({
    channel_thumbnail: 'https://images.example.test/channel.png'
  }, () => { throw new Error('unexpected profile request') })
  assert.equal(url, 'https://images.example.test/channel.png')
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

test('reads the Twitch channel image from its profile page', async () => {
  const url = await resolveYtDlpCreatorAvatarUrl({
    webpage_url: 'https://clips.twitch.tv/SomeClip',
    channel: 'creator_1'
  }, async profileUrl => {
    assert.equal(profileUrl, 'https://www.twitch.tv/creator_1')
    return new Response('<meta property="og:image" content="https://static-cdn.jtvnw.net/profile_image-300x300.png">', {
      headers: { 'content-type': 'text/html' }
    })
  })
  assert.equal(url, 'https://static-cdn.jtvnw.net/profile_image-300x300.png')
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
