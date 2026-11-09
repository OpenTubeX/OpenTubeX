import assert from 'node:assert/strict'
import test from 'node:test'

import { getHomeWidgetPage } from '../../src/renderer/helpers/homeWidgetData.js'

test('Quick access widget links open only their fixed pages', () => {
  assert.deepEqual(getHomeWidgetPage('opentubex://open/search'), { page: 'search', route: null })
  assert.deepEqual(getHomeWidgetPage('opentubex-nightly://open/subscriptions'), { page: 'subscriptions', route: { path: '/subscriptions' } })
  assert.deepEqual(getHomeWidgetPage('opentubex://open/watch-later'), {
    page: 'watch-later',
    route: { path: '/playlist/watchLater', query: { playlistType: 'user' } }
  })
  for (const url of [
    'opentubex://open/settings', 'opentubex://open/__proto__', 'opentubex://open/search/../settings',
    'opentubex://https://www.youtube.com/watch?v=jNQXAC9IVRw', 'https://open/search', '', undefined
  ]) {
    assert.equal(getHomeWidgetPage(url), null, url)
  }
})
