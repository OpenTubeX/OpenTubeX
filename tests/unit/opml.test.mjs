import assert from 'node:assert/strict'
import test from 'node:test'

import { parseOpmlFeeds } from '../../src/renderer/helpers/opml.js'

const feed = id => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`

test('reads feed outlines from an OPML subscription list', () => {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.1">
  <head><outline xmlUrl="${feed('head')}" /></head>
  <body>
    <outline text="YouTube Subscriptions" title="YouTube Subscriptions">
      <outline text="A &amp; B" title="A &amp; B &#x1F600; &#39;x&#39;" type="rss" xmlUrl="${feed('UCa')}&amp;x=1" />
      <outline title='Single &gt; quoted' xmlurl='${feed('UCb')}'/>
      <outline title="No feed" />
    </outline>
  </body>
</opml>`
  assert.deepEqual(parseOpmlFeeds(content), [
    { xmlUrl: `${feed('UCa')}&x=1`, title: "A & B 😀 'x'" },
    { xmlUrl: feed('UCb'), title: 'Single > quoted' },
  ])
})

test('accepts malformed OPML and attributes containing angle brackets', () => {
  assert.deepEqual(parseOpmlFeeds(`<opml><body><outline title="a > b" xmlUrl="${feed('UCc')}"><outline xmlUrl="${feed('UCd')}">`), [
    { xmlUrl: feed('UCc'), title: 'a > b' },
    { xmlUrl: feed('UCd'), title: null },
  ])
  assert.deepEqual(parseOpmlFeeds('<opml><head></head></opml>'), [])
  assert.deepEqual(parseOpmlFeeds('not opml'), [])
})
