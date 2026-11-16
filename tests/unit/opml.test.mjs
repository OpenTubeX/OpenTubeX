import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOpml, getOpmlYouTubeChannelId, parseOpmlFeeds } from '../../src/renderer/helpers/opml.js'

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

  // A folder inside the wrapper is a group, even when it holds every feed
  const shared = `<opml><body><outline text="YouTube Subscriptions"><outline text="Tech">
    <outline xmlUrl="${feed('UCa')}" /><outline xmlUrl="${feed('UCb')}" />
  </outline></outline></body></opml>`
  assert.deepEqual(parseOpmlFeeds(shared).map(({ folders }) => folders), [['Tech'], ['Tech']])
})

test('tells YouTube channel feeds apart from other feeds such as podcasts', () => {
  const id = `UC${'a'.repeat(22)}`
  assert.equal(getOpmlYouTubeChannelId(feed(id)), id)
  assert.equal(getOpmlYouTubeChannelId(`https://yewtu.be/feed/channel/${id}`), id)
  assert.equal(getOpmlYouTubeChannelId('https://podcast.example.test/feed/channel/episodes'), null)
  assert.equal(getOpmlYouTubeChannelId(`https://podcast.example.test/feeds/videos.xml?channel_id=${id}`), null)
  assert.equal(getOpmlYouTubeChannelId('https://podcast.example.test/rss.xml'), null)
  assert.equal(getOpmlYouTubeChannelId('not a url'), null)
})

test('writes OPML that reads back with the same feeds', () => {
  const feeds = [
    { xmlUrl: 'https://podcast.example.test/rss?a=1&b=2', title: 'Q & A <"live">' },
    { xmlUrl: 'https://feeds.example.test/show.xml', title: "It's a show" },
  ]
  assert.deepEqual(parseOpmlFeeds(buildOpml('RSS Feeds', feeds)), feeds.map(feed => ({ ...feed, folders: [] })))
})

test('names feeds by their outline text without a title', () => {
  assert.deepEqual(parseOpmlFeeds('<opml><body><outline text="Show" type="rss" xmlUrl="https://podcast.example.test/rss" /></body></opml>'), [
    { xmlUrl: 'https://podcast.example.test/rss', title: 'Show', folders: [] },
  ])
})
