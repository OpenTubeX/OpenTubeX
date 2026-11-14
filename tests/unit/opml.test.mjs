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
    { xmlUrl: `${feed('UCa')}&x=1`, title: "A & B 😀 'x'", folders: [] },
    { xmlUrl: feed('UCb'), title: 'Single > quoted', folders: [] },
  ])
})

test('accepts malformed OPML and attributes containing angle brackets', () => {
  assert.deepEqual(parseOpmlFeeds(`<opml><body><outline title="a > b" xmlUrl="${feed('UCc')}"><outline xmlUrl="${feed('UCd')}">`), [
    { xmlUrl: feed('UCc'), title: 'a > b', folders: [] },
    { xmlUrl: feed('UCd'), title: null, folders: [] },
  ])
  assert.deepEqual(parseOpmlFeeds('<opml><head></head></opml>'), [])
  // commented-out subscriptions, including an unterminated comment, are not imported
  assert.deepEqual(parseOpmlFeeds(`<opml><body><!-- <outline xmlUrl="${feed('UCe')}" /> --><outline xmlUrl="${feed('UCf')}" /><!-- <outline xmlUrl="${feed('UCg')}" />`), [
    { xmlUrl: feed('UCf'), title: null, folders: [] },
  ])
  assert.deepEqual(parseOpmlFeeds('not opml'), [])
})

test('reads nested folders, except one wrapping every feed', () => {
  const content = `<opml><body>
    <outline text="YouTube Subscriptions">
      <outline text="Tech">
        <outline text="Web Design"><outline xmlUrl="${feed('UCa')}"></outline></outline>
        <outline xmlUrl="${feed('UCb')}" />
      </outline>
      <outline title="Music"><outline xmlUrl="${feed('UCc')}" /></outline>
      <outline xmlUrl="${feed('UCd')}" />
    </outline>
  </body></opml>`
  assert.deepEqual(parseOpmlFeeds(content).map(({ folders }) => folders), [
    ['Tech', 'Web Design'],
    ['Tech'],
    ['Music'],
    [],
  ])
})
