import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDownloadWidgetItems,
  createWatchTimeWidgetDays,
  getHomeWidgetPage,
} from '../../src/renderer/helpers/homeWidgetData.js'

test('home screen widget links open only their fixed pages and downloads', () => {
  assert.deepEqual(getHomeWidgetPage('opentubex://open/search'), { page: 'search', route: null })
  assert.deepEqual(getHomeWidgetPage('opentubex-nightly://open/subscriptions'), { page: 'subscriptions', route: { path: '/subscriptions' } })
  assert.deepEqual(getHomeWidgetPage('opentubex://open/watch-later'), {
    page: 'watch-later',
    route: { path: '/playlist/watchLater', query: { playlistType: 'user' } }
  })
  assert.deepEqual(getHomeWidgetPage('opentubex://open/downloads'), { page: 'downloads', route: { settings: 'downloads' } })
  assert.deepEqual(getHomeWidgetPage('opentubex://open/download/42'), { page: 'download', route: null, downloadId: 42 })
  for (const url of [
    'opentubex://open/settings', 'opentubex://open/__proto__', 'opentubex://open/search/../settings',
    'opentubex://open/download', 'opentubex://open/download/-1', 'opentubex://open/download/1e3', 'opentubex://open/search/1',
    'opentubex://https://www.youtube.com/watch?v=jNQXAC9IVRw', 'https://open/search', '', undefined
  ]) {
    assert.equal(getHomeWidgetPage(url), null, url)
  }
})

test('Recent downloads lists the newest downloads that still play offline', () => {
  const download = (id, completedAt, overrides = {}) => ({
    id,
    completedAt,
    status: 'completed',
    mode: 'video',
    title: `Download ${id}`,
    files: [{ videoId: 'aaaaaaaaaaa', path: `/files/${id}.mp4`, author: 'Channel', available: true }],
    ...overrides,
  })
  const items = createDownloadWidgetItems([
    download(1, 100),
    download(2, 300),
    download(3, 200, { mode: 'subtitles' }),
    download(4, 400, { files: [{ videoId: 'aaaaaaaaaaa', path: '/files/4.mp4', available: false }] }),
    download(5, 500, { status: 'queued' }),
    download(6, 50),
    download(7, 60),
    download(8, 70),
  ], item => `https://i.ytimg.com/${item.id}.jpg`)
  assert.deepEqual(items.map(item => item.id), [2, 1, 8, 7])
  assert.deepEqual(items[0], { id: 2, title: 'Download 2', author: 'Channel', thumbnail: 'https://i.ytimg.com/2.jpg' })
})

test('Watch time sends only the last seven local days', () => {
  const now = new Date(2026, 2, 3, 12).getTime()
  assert.deepEqual(createWatchTimeWidgetDays({
    '2026-03-03': 61.9,
    '2026-03-01': 120,
    '2026-02-25': 30,
    '2026-02-24': 999,
    '2026-03-02': 0,
  }, now), { '2026-03-03': 61, '2026-03-01': 120, '2026-02-25': 30 })
})
