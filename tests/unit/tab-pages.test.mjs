import assert from 'node:assert/strict'
import test from 'node:test'
import { showTabPage } from '../../src/renderer/tabs/tabPages.js'

const route = fullPath => ({ fullPath, path: fullPath.split('?')[0] })

function tab(...paths) {
  let key = 0
  const history = paths.map(route)
  let pages = []
  return {
    history,
    show(index, limit = 1) {
      pages = showTabPage(pages, { index, route: history[index] }, i => history[i]?.fullPath, () => ++key, limit)
      return pages.map(page => `${page.key}:${page.route.fullPath}`)
    }
  }
}

test('Back returns to the page instance the tab left, and the page Back leaves is dropped', () => {
  const pages = tab('/channel/a', '/search/a', '/search/b')
  pages.show(0)
  pages.show(1)
  assert.deepEqual(pages.show(2), ['2:/search/a', '3:/search/b'], 'keep only the latest page left')
  assert.deepEqual(pages.show(1), ['2:/search/a'], 'reuse the kept instance')
  assert.deepEqual(pages.show(0), ['4:/channel/a'], 'mount pages that were not kept')
})

test('replacing the shown entry keeps its instance', () => {
  const pages = tab('/subscriptions', '/channel/a')
  pages.show(0)
  pages.show(1)
  pages.history[1] = route('/channel/a/shorts')
  assert.deepEqual(pages.show(1), ['1:/subscriptions', '2:/channel/a/shorts'])
})

test('a kept page that no longer matches its history entry is dropped', () => {
  const pages = tab('/subscriptions', '/history')
  pages.show(0)
  pages.history[0] = route('/trending')
  assert.deepEqual(pages.show(1), ['2:/history'], 'never show another page for an entry')
})
