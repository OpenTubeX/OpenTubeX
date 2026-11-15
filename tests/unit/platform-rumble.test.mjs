import assert from 'node:assert/strict'
import test from 'node:test'

import rumble from '../../src/platforms/rumble.js'

const CDN = 'https://cdn.rumble.cloud'

/** @param {Record<string, unknown>} overrides */
function listedVideo(overrides) {
  return {
    object_type: 'video',
    url: 'https://rumble.com/v1abc11-example-video.html',
    relative_url: '/v1abc11-example-video.html',
    by: { type: 'channel', url: 'https://rumble.com/c/ExampleChannel', relative_url: '/c/ExampleChannel', name: 'Example Channel' },
    title: 'Example video',
    duration: 486,
    thumb: `${CDN}/video.jpg`,
    upload_date: '2026-11-12T00:30:00+00:00',
    live: false,
    live_datetime: null,
    livestream_status: null,
    watching_now: null,
    views: 2997,
    ...overrides
  }
}

/** @param {unknown[]} items */
function grid(items) {
  return `<rum-videos-grid>\n    <script type="application/json">\n        ${JSON.stringify({ items, analytics: {} })}\n    </script>\n</rum-videos-grid>`
}

// Trimmed from a channel's main page, which lists live streams first
const CHANNEL_PAGE = `<!DOCTYPE html><html><head><title>Example Channel</title>
<link rel=canonical href=https://rumble.com/c/ExampleChannel><link rel=next href="https://rumble.com/c/ExampleChannel?page=2">
<style>.channel-header--backsplash-img{width:100%}</style></head><body>
<h3 class="main-menu-heading"><span class="main-menu-item-label">Featured Channels</span></h3>
<div class="channel-header--container"><div class="channel-header--backsplash"><img class="channel-header--backsplash-img"
  src="${CDN}/banner.jpeg" alt="" width="1430" height="291" aria-hidden="true"
></div><div class="channel-header--content"><div class="channel-header--content-inner"><div class="constrained"><div
  class="channel-header--thumb"><img
    class="channel-header--img"
    src="${CDN}/avatar.jpeg"
    alt="Example Channel"
  ></div><div class="channel-header--title"><div class="flex items-center mb-1"><h1>Example &amp; Friends</h1><svg class="channel-header--verified verification-badge-icon" role=img><title>Verified</title><path d="M0 0"/></svg></div><span class="text-fjord"><span>1.2K Followers</span></span></div><div
  class="flex items-center shrink-0" hx-get="/-htmx/channel/update-action-buttons"><button class="btn-grey btn btn-medium">Join</button></div></div></div></div></div>
<section class="channel-listing__container border-box padded-content constrained">
${grid([
  listedVideo({ url: 'https://rumble.com/v1live1-example-radio.html?e9s=src_v1_ucp_a', title: 'Example radio', duration: 0, upload_date: '2022-08-26T13:09:59+00:00', live: true, livestream_status: 2, watching_now: 40, views: 23494073 }),
  listedVideo({ url: 'https://rumble.com/v1next1-example-premiere.html', title: 'Example premiere', duration: 0, live_datetime: '2099-01-01T18:00:00+00:00', livestream_status: 1, views: 0 }),
  listedVideo({}),
  { object_type: 'ad', url: 'https://ads.example.test/' }
])}
<rum-videos-grid><script type="application/json">{"items":[</script></rum-videos-grid>
${grid([
  listedVideo({ url: 'https://rumble.com/v1past1--example-broadcast.html', title: 'Example broadcast', duration: 7930, upload_date: '2026-11-11T03:39:32+00:00', livestream_status: 0, views: 4932 }),
  listedVideo({ url: 'https://rumble.com/v1repo1-example-repost.html', title: 'Example repost', upload_date: '2026-11-10T10:00:00+00:00', by: { url: 'https://rumble.com/user/OtherUser', name: 'Other User' } }),
  listedVideo({ url: 'https://evil.example.test/v1abc22-example.html', relative_url: null, title: 'Elsewhere' }),
  listedVideo({ url: 'javascript:alert(1)', relative_url: '/v1abc33-relative.html', title: 'Relative', thumb: 'http://cdn.example.test/insecure.jpg' })
])}
<a href="/c/ExampleChannel?page=2&amp;e9s=src_v1_ucp">2</a><a href="/c/ExampleChannel?page=17">17</a>
</section></body></html>`

// Trimmed from a video search page, with unquoted attributes as Rumble sends them
const VIDEO_SEARCH_PAGE = `<html><head><link rel=canonical href="https://rumble.com/search/video?q=example">
<link rel=next href="https://rumble.com/search/video?page=2&q=example"></head><body><ol>
<li class="video-listing-entry"><article class="video-item "><a class="video-item--a" href="/v1srch1-example-video.html?e9s=src_v1_s%2Csrc_v1_s_o&amp;sci=00000000-0000-0000-0000-000000000000" data-event-data=abc><div class="video-item--img-wrapper"><img
  class="video-item--img"
  src="${CDN}/search.jpg"
  alt="Example &amp; video"
></div><span class="video-item--duration" data-value="1:09:51"></span></a><div class="video-item--info"><time class="video-item--meta video-item--time" datetime=2026-11-10T22:34:42-04:00 title="November 10, 2026">1 day ago</time><h3 class=video-item--title>Example &amp; video &#39;one&#39; &#x2014; part &#8470;2 & more</h3><address class=video-item--by><a rel=author class="video-item--by-a video-item--by-a--u2pj5g" href="/user/ExampleUser?e9s=src_v1_cmd"><div class=ellipsis-1>Example User<svg class="video-item--by-verified verification-badge-icon" role=img><title>Verified</title><path d="M0 0"/></svg></div></a></address><footer class="video-item--footer"><div class="video-counters"><div class="video-counters--item video-item--views"><svg class=video-counters--icon><path d="M0 0"/></svg>1.32K</div><div class="video-counters--item video-item--comments"><svg class=video-counters--icon><path d="M0 0"/></svg>1</div></div></footer></div></article></li>
<li class="video-listing-entry"><article class="video-item "><a class="video-item--a" href="/v1srch2-example-live.html?e9s=src_v1_s"><div class="video-item--img-wrapper video-item--img-wrapper--live"><img class="video-item--img" src="${CDN}/live.jpg" alt="Example live"><span class="video-item--watching">21 watching</span></div><span class="video-item--live" data-value="LIVE"></span></a><div class="video-item--info"><time class="video-item--meta video-item--time" datetime=2026-11-11T22:40:50-04:00>9 hours ago</time><h3 class=video-item--title>Example live</h3><address class=video-item--by><a rel=author class="video-item--by-a video-item--by-a--c735965" href="/c/ExampleChannel?e9s=src_v1_cmd"><div class=ellipsis-1>Example Channel</div></a></address><footer class="video-item--footer"><div class="video-counters--item video-item--views"><svg></svg>267</div></footer></div></article></li>
<li class="video-listing-entry"><article class="video-item "><div class="video-item--info"><h3 class=video-item--title>Removed video</h3></div></article></li>
</ol></body></html>`

// Trimmed from a channel search page, which shows avatars as background images,
// some of them on other sites
const CHANNEL_SEARCH_PAGE = `<html><head><style>.user-image--img--id-0 {
\tbackground-image: url(${CDN}/channel-avatar.jpeg);
}
.user-image--img--id-1 {
\tbackground-image: url(https://social.example.test/picture?type=small);
}</style></head><body>
<article class="flex items-center justify-between space-x-4">
  <a href="/c/ExampleChannel?e9s=src_v1_cmd%2Csrc_v1_s&sci=00000000" class="flex-none hover:no-underline">
    <i class='user-image user-image--img user-image--img--id-0 user-image--72 user-image--no-border' data-js=user-image></i></a>
  <a href="/c/ExampleChannel?e9s=src_v1_cmd" class="flex flex-grow flex-col min-w-0 hover:no-underline">
    <h3 class="flex items-center space-x-1 font-semibold text-sm">
      <span class="block truncate">Example O&#39;Channel</span>
      <span><svg class="w-3 h-3 verification-badge-icon" role=img><title>Verified</title><path d="M0 0"/></svg></span>
    </h3>
    <span class="text-sm text-fjord dark:text-bone">
      1,308,083&nbsp;
      Follower\t\t\t\t</span>
    <p class="mt-2 text-sm text-fjord">
      Example description.

Second line</p>
  </a>
  <div class="flex-none"><button>Follow</button></div>
</article>
<article class="flex items-center justify-between space-x-4">
  <a href="/user/example_user.2?e9s=src_v1_cmd" class="flex-none"><i class='user-image user-image--img user-image--img--id-1 user-image--72' data-js=user-image></i></a>
  <a href="/user/example_user.2?e9s=src_v1_cmd" class="flex flex-grow flex-col"><h3 class="flex"><span class="block truncate">example_user.2</span></h3>
    <span class="text-sm">15&nbsp; Follower </span></a>
</article>
<article class="flex items-center justify-between space-x-4">
  <a href="/category/example-news" class="flex-none"><i class='user-image user-image--letter'></i></a>
  <a href="/category/example-news"><h3><span class="block truncate">Example News</span></h3><span>20,330&nbsp; Follower</span></a>
</article>
<a class="leading-none px-2" href="/search/channel?page=2&q=example">2</a>
</body></html>`

function htmlFetch(pages) {
  const requests = []
  const fetcher = async (url, init) => {
    requests.push({ url, init })
    const html = pages[url]
    return html === undefined ? new Response('Not found', { status: 404 }) : new Response(html, { headers: { 'Content-Type': 'text/html' } })
  }
  return { fetcher, requests }
}

test('reads channel IDs from channel addresses only', () => {
  assert.equal(rumble.parseChannelUrl('https://rumble.com/c/ExampleChannel'), 'c/ExampleChannel')
  assert.equal(rumble.parseChannelUrl('https://www.rumble.com/c/ExampleChannel/videos?e9s=src_v1_cmd'), 'c/ExampleChannel')
  assert.equal(rumble.parseChannelUrl('https://rumble.com/c/c-6675109/livestreams'), 'c/c-6675109')
  assert.equal(rumble.parseChannelUrl(' https://rumble.com/user/Example_User.2 '), 'user/Example_User.2')
  assert.equal(rumble.parseChannelUrl('https://rumble.com/v1abc11-example-video.html'), null)
  assert.equal(rumble.parseChannelUrl('https://rumble.com/category/example-news'), null)
  assert.equal(rumble.parseChannelUrl('https://rumble.com/c/'), null)
  assert.equal(rumble.parseChannelUrl('https://rumble.com/c/Example%20Channel'), null)
  assert.equal(rumble.parseChannelUrl('https://rumble.com.example.test/c/ExampleChannel'), null)
  assert.equal(rumble.parseChannelUrl('https://user:pass@rumble.com/c/ExampleChannel'), null)
  assert.equal(rumble.parseChannelUrl('ftp://rumble.com/c/ExampleChannel'), null)
  assert.equal(rumble.parseChannelUrl('not a channel'), null)
})

test('reads the channel header, with the canonical case of its ID', async () => {
  const { fetcher, requests } = htmlFetch({ 'https://rumble.com/c/examplechannel': CHANNEL_PAGE })

  assert.deepEqual(await rumble.getChannel(fetcher, 'c/examplechannel'), {
    platform: 'rumble',
    id: 'c/ExampleChannel',
    name: 'Example & Friends',
    url: 'https://rumble.com/c/ExampleChannel',
    avatar: `${CDN}/avatar.jpeg`,
    banner: `${CDN}/banner.jpeg`,
    followerCount: 1200
  })
  assert.equal(requests[0].init.credentials, 'include')
  assert.ok(requests[0].init.signal instanceof AbortSignal)

  // Channels without a banner or picture, with larger counts
  const plain = '<div class="channel-header--container"><div class="channel-header--content"><div class="channel-header--letter">E</div><h1>Example</h1><span><span>3.4M Followers</span></span></div></div>'
  assert.deepEqual(await rumble.getChannel(htmlFetch({ 'https://rumble.com/user/Example': plain }).fetcher, 'user/Example'), {
    platform: 'rumble', id: 'user/Example', name: 'Example', url: 'https://rumble.com/user/Example', followerCount: 3_400_000
  })

  assert.equal(await rumble.getChannel(fetcher, 'c/Missing'), null)
  assert.equal(await rumble.getChannel(fetcher, '../search'), null)
  assert.equal(requests.length, 2)
  await assert.rejects(rumble.getChannel(async () => new Response('', { status: 503 }), 'c/ExampleChannel'), /HTTP 503/)
})

test('lists the videos of a channel page, with live streams first in the feed', async () => {
  const lastPage = CHANNEL_PAGE.replace(/<link rel=next[^>]*>/, '').replace(/<a href="\/c\/ExampleChannel\?page=[^>]*>\d+<\/a>/g, '')
  const { fetcher, requests } = htmlFetch({
    'https://rumble.com/c/ExampleChannel': CHANNEL_PAGE,
    'https://rumble.com/c/ExampleChannel?page=2': lastPage
  })
  const channel = { platform: 'rumble', id: 'c/ExampleChannel', name: 'Example Channel', url: 'https://rumble.com/c/ExampleChannel' }

  const page = await rumble.getChannelPage(fetcher, channel, 'videos', null)
  assert.equal(page.continuation, '2')
  const items = page.results.map(result => result.item)
  assert.deepEqual(items.map(item => [item.url, item.title, item.channelId, item.author]), [
    ['https://rumble.com/v1live1-example-radio.html', 'Example radio', 'c/ExampleChannel', 'Example Channel'],
    ['https://rumble.com/v1next1-example-premiere.html', 'Example premiere', 'c/ExampleChannel', 'Example Channel'],
    ['https://rumble.com/v1abc11-example-video.html', 'Example video', 'c/ExampleChannel', 'Example Channel'],
    ['https://rumble.com/v1past1--example-broadcast.html', 'Example broadcast', 'c/ExampleChannel', 'Example Channel'],
    ['https://rumble.com/v1repo1-example-repost.html', 'Example repost', 'user/OtherUser', 'Other User'],
    ['https://rumble.com/v1abc33-relative.html', 'Relative', 'c/ExampleChannel', 'Example Channel']
  ])
  assert.ok(page.results.every(result => result.kind === 'item' && result.item.platform === 'rumble'))
  assert.deepEqual(items[0], {
    platform: 'rumble',
    id: 'v1live1',
    url: 'https://rumble.com/v1live1-example-radio.html',
    title: 'Example radio',
    author: 'Example Channel',
    channelId: 'c/ExampleChannel',
    thumbnail: `${CDN}/video.jpg`,
    published: Date.parse('2022-08-26T13:09:59+00:00'),
    viewCount: 40,
    isLive: true
  })
  assert.equal(items[1].isUpcoming, true)
  assert.equal(items[1].published, Date.parse('2099-01-01T18:00:00+00:00'))
  assert.equal(items[1].duration, undefined)
  assert.equal(items[2].duration, 486)
  assert.equal(items[2].viewCount, 2997)
  assert.equal(items[2].published, Date.parse('2026-11-12T00:30:00+00:00'))
  assert.equal(items[3].isLive, undefined)
  assert.equal(items[5].thumbnail, '')

  const next = await rumble.getChannelPage(fetcher, channel, 'videos', page.continuation)
  assert.equal(next.continuation, null)
  // Pages after the last one are missing
  assert.deepEqual(await rumble.getChannelPage(fetcher, channel, 'videos', '3'), { results: [], continuation: null })
  assert.deepEqual(requests.map(request => request.url), [
    'https://rumble.com/c/ExampleChannel',
    'https://rumble.com/c/ExampleChannel?page=2',
    'https://rumble.com/c/ExampleChannel?page=3'
  ])
  assert.deepEqual(await rumble.getChannelPage(fetcher, channel, 'playlists', null), { results: [], continuation: null })
  assert.deepEqual(await rumble.getChannelPage(fetcher, channel, 'videos', 'invalid'), { results: [], continuation: null })
  assert.equal(requests.length, 3)

  const latest = await rumble.getLatestItems(fetcher, channel)
  assert.deepEqual(latest.map(item => item.id), ['v1live1', 'v1next1', 'v1abc11', 'v1abc33', 'v1past1', 'v1repo1'])

  // A channel without videos has none, in each language Rumble has, but a
  // page without a listing it can read fails, so the feed keeps the channel's
  // earlier items
  const other = htmlFetch({
    'https://rumble.com/c/EmptyChannel': '<main><section class="channel-listing__container border-box">\n\t\t\tKeine Videos gefunden\t\t</section></main>',
    'https://rumble.com/c/LoadingChannel': '<main><section class="channel-listing__container">Loading videos...</section></main>',
    'https://rumble.com/c/ChangedChannel': '<main><section class="channel-listing__container"><div class="videos-grid"><a href="/v1abc11-example.html">Video</a></div></section></main>'
  })
  assert.deepEqual(await rumble.getChannelPage(other.fetcher, { ...channel, id: 'c/EmptyChannel' }, 'videos', null), { results: [], continuation: null })
  for (const id of ['c/ChangedChannel', 'c/LoadingChannel']) {
    await assert.rejects(rumble.getLatestItems(other.fetcher, { ...channel, id }), /no videos it can read/)
  }
})

test('searches videos', async () => {
  const { fetcher, requests } = htmlFetch({ 'https://rumble.com/search/video?q=example+query': VIDEO_SEARCH_PAGE })

  const page = await rumble.search(fetcher, ' example query ', 'videos', null)
  assert.equal(requests[0].init.credentials, 'include')
  assert.equal(page.continuation, '2')
  assert.deepEqual(page.results, [
    {
      kind: 'item',
      item: {
        platform: 'rumble',
        id: 'v1srch1',
        url: 'https://rumble.com/v1srch1-example-video.html',
        title: 'Example & video \'one\' — part №2 & more',
        author: 'Example User',
        channelId: 'user/ExampleUser',
        thumbnail: `${CDN}/search.jpg`,
        published: Date.parse('2026-11-10T22:34:42-04:00'),
        duration: 4191,
        viewCount: 1320
      }
    },
    {
      kind: 'item',
      item: {
        platform: 'rumble',
        id: 'v1srch2',
        url: 'https://rumble.com/v1srch2-example-live.html',
        title: 'Example live',
        author: 'Example Channel',
        channelId: 'c/ExampleChannel',
        thumbnail: `${CDN}/live.jpg`,
        published: Date.parse('2026-11-11T22:40:50-04:00'),
        viewCount: 21,
        isLive: true
      }
    }
  ])

  await rumble.search(fetcher, 'example', 'videos', '2')
  assert.equal(requests[1].url, 'https://rumble.com/search/video?q=example&page=2')
  assert.deepEqual(await rumble.search(fetcher, '  ', 'videos', null), { results: [], continuation: null })
  assert.deepEqual(await rumble.search(fetcher, 'example', 'playlists', null), { results: [], continuation: null })
  assert.equal(requests.length, 2)
})

test('searches channels', async () => {
  const { fetcher } = htmlFetch({ 'https://rumble.com/search/channel?q=example': CHANNEL_SEARCH_PAGE })

  const page = await rumble.search(fetcher, 'example', 'channels', null)
  assert.equal(page.continuation, '2')
  assert.deepEqual(page.results, [
    {
      kind: 'channel',
      channel: {
        platform: 'rumble',
        id: 'c/ExampleChannel',
        name: 'Example O\'Channel',
        url: 'https://rumble.com/c/ExampleChannel',
        avatar: `${CDN}/channel-avatar.jpeg`,
        description: 'Example description. Second line',
        followerCount: 1_308_083
      }
    },
    {
      kind: 'channel',
      channel: {
        platform: 'rumble',
        id: 'user/example_user.2',
        name: 'example_user.2',
        url: 'https://rumble.com/user/example_user.2',
        followerCount: 15
      }
    }
  ])
})
