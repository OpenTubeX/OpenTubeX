import assert from 'node:assert/strict'
import test from 'node:test'

import { createAppUrlNavigation } from '../../src/renderer/helpers/appUrlNavigation.js'

test('YouTube URL routes preserve route data and background-tab disposition', async () => {
  const opened = []
  const controller = createAppUrlNavigation({
    getUrlInfo: async () => ({
      urlType: 'video',
      videoId: 'abcdefghijk',
      timestamp: '42',
      playlistId: 'PL123',
      commentId: 'Ugx1',
      isShort: true,
    }),
    openInternalPath: options => opened.push(options),
    navigateTab: () => assert.fail('a new tab should use openInternalPath'),
    showUnknownUrl: () => assert.fail('known URL'),
    isElectron: true,
  })

  await controller.openYoutubeLink('https://youtu.be/abcdefghijk', {
    doCreateNewTab: true, isMiddleClick: true, tabId: 'old-tab',
  })
  assert.deepEqual(opened, [{
    path: '/watch/abcdefghijk',
    query: { short: 'true', timestamp: '42', playlistId: 'PL123', commentId: 'Ugx1' },
    doCreateNewWindow: false,
    doCreateNewTab: true,
    makeActive: false,
  }])
})

test('existing Electron tab receives parsed URL without opening a new tab', async () => {
  const navigated = []
  const controller = createAppUrlNavigation({
    getUrlInfo: async () => ({ urlType: 'playlist', playlistId: 'PL123', query: { index: '2' } }),
    openInternalPath: () => assert.fail('existing tab should be reused'),
    navigateTab: (tabId, location) => navigated.push({ tabId, location }),
    showUnknownUrl: () => assert.fail('known URL'),
    isElectron: true,
  })

  await controller.openYoutubeLink('https://youtube.com/playlist?list=PL123', { tabId: 'target-tab' })
  assert.deepEqual(navigated, [{
    tabId: 'target-tab', location: { path: '/playlist/PL123', query: { index: '2' } },
  }])
})

test('other parsed URL types preserve their existing routes', async () => {
  const opened = []
  let result
  const controller = createAppUrlNavigation({
    getUrlInfo: async () => result,
    openInternalPath: options => opened.push(options),
    navigateTab: () => assert.fail('no target tab'),
    showUnknownUrl: () => assert.fail('known URL'),
    isElectron: false,
  })

  for (const [info, path, query] of [
    [{ urlType: 'search', searchQuery: 'cats & dogs', query: { sortBy: 'date' } }, '/search/cats%20%26%20dogs', { sortBy: 'date' }],
    [{ urlType: 'hashtag', hashtag: 'cats & dogs' }, '/hashtag/cats%20%26%20dogs', undefined],
    [{ urlType: 'post', postId: 'Ug123', query: { foo: 'bar' } }, '/post/Ug123', { foo: 'bar' }],
    [{ urlType: 'channel', channelId: 'UC123', subPath: 'videos', url: 'https://youtube.com/@cats' }, '/channel/UC123/videos', { url: 'https://youtube.com/@cats' }],
    [{ urlType: 'trending' }, '/trending', undefined],
  ]) {
    result = info
    await controller.openYoutubeLink('https://youtube.com/example')
    const actual = opened.pop()
    assert.equal(actual.path, path)
    assert.deepEqual(actual.query, query)
    assert.equal(actual.makeActive, true)
  }
})

test('invalid URLs are ignored and unknown types are reported', async () => {
  let result = { urlType: 'invalid_url' }
  const unknown = []
  const controller = createAppUrlNavigation({
    getUrlInfo: async () => result,
    openInternalPath: () => assert.fail('invalid or unknown URL'),
    navigateTab: () => assert.fail('invalid or unknown URL'),
    showUnknownUrl: info => unknown.push(info),
    isElectron: false,
  })
  await controller.openYoutubeLink('invalid')
  result = { urlType: 'future_type' }
  await controller.openYoutubeLink('https://youtube.com/future')
  assert.deepEqual(unknown, [{ urlType: 'future_type' }])
})
