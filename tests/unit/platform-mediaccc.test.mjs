import assert from 'node:assert/strict'
import test from 'node:test'

import mediaccc from '../../src/platforms/mediaccc.js'

const API = 'https://api.media.ccc.de/public'

function conference(overrides = {}) {
  return {
    acronym: 'exc24',
    title: 'Example Conference 2024',
    slug: 'conferences/exc/2024',
    description: ' About the conference ',
    logo_url: 'https://static.example.test/media/exc/2024/../logo.svg',
    event_last_released_at: '2024-06-01T00:00:00.000+02:00',
    url: `${API}/conferences/exc24`,
    ...overrides
  }
}

function event(index, overrides = {}) {
  return {
    guid: `guid-${index}`,
    title: ` Talk ${index} `,
    frontend_link: `https://media.ccc.de/v/exc24-${index}-talk`,
    thumb_url: `https://static.example.test/media/exc/2024/${index}.jpg`,
    poster_url: `https://static.example.test/media/exc/2024/${index}_preview.jpg`,
    date: '2024-05-01T10:00:00.000+02:00',
    release_date: `2024-05-0${index}T00:00:00.000+02:00`,
    length: 1800 + index,
    view_count: 10 * index,
    conference_title: 'Example Conference 2024',
    conference_url: `${API}/conferences/exc24`,
    ...overrides
  }
}

/**
 * Answers requests with the response the handler returns for them.
 * @param {(url: URL) => Response} handler
 */
function fakeFetch(handler) {
  const requests = []
  const fetch = async (url, init) => {
    requests.push({ url: new URL(url), init })
    return handler(new URL(url))
  }
  return { fetch, requests }
}

test('reads conference acronyms from conference pages only', () => {
  const { parseChannelUrl } = mediaccc
  assert.equal(parseChannelUrl('https://media.ccc.de/c/exc24'), 'exc24')
  assert.equal(parseChannelUrl('https://media.ccc.de/c/ExC24/Some%20Track'), 'ExC24')
  assert.equal(parseChannelUrl('https://media.ccc.de/c/Two%20_Words'), 'Two _Words')
  assert.equal(parseChannelUrl('https://media.ccc.de/v/exc24-1-talk'), null)
  assert.equal(parseChannelUrl('https://media.ccc.de/c/..'), null)
  assert.equal(parseChannelUrl('https://media.ccc.de/c/a%2Fb'), null)
  assert.equal(parseChannelUrl('https://media.ccc.de.example.test/c/exc24'), null)
  assert.equal(parseChannelUrl('https://user@media.ccc.de/c/exc24'), null)
})

test('loads a conference with its talks newest first, and finds no unknown ones', async () => {
  const { fetch, requests } = fakeFetch(url => url.pathname.endsWith('/exc24')
    ? Response.json({ ...conference(), events: [event(1), event(3), { guid: 'no-link' }, event(4, { frontend_link: 'https://example.test/v/talk' }), event(2, { thumb_url: null, length: 0, duration: 95 })] })
    : new Response(null, { status: 404 }))

  const channel = await mediaccc.getChannel(fetch, 'exc24')
  assert.deepEqual(channel, {
    platform: 'mediaccc',
    id: 'exc24',
    name: 'Example Conference 2024',
    url: 'https://media.ccc.de/c/exc24',
    avatar: 'https://static.example.test/media/exc/logo.svg',
    description: 'About the conference'
  })
  assert.equal(requests[0].url.href, `${API}/conferences/exc24`)
  assert.equal(requests[0].init.credentials, 'omit')

  const page = await mediaccc.getChannelPage(fetch, channel, 'videos', null)
  assert.equal(page.continuation, null)
  assert.deepEqual(page.results.map(result => result.kind === 'item' && result.item.id), ['guid-3', 'guid-2', 'guid-1'])
  assert.deepEqual(page.results[0], {
    kind: 'item',
    item: {
      platform: 'mediaccc',
      id: 'guid-3',
      url: 'https://media.ccc.de/v/exc24-3-talk',
      title: 'Talk 3',
      author: 'Example Conference 2024',
      channelId: 'exc24',
      thumbnail: 'https://static.example.test/media/exc/2024/3.jpg',
      published: Date.parse('2024-05-03T00:00:00.000+02:00'),
      duration: 1803,
      viewCount: 30
    }
  })
  const second = page.results[1].kind === 'item' && page.results[1].item
  assert.equal(second.thumbnail, 'https://static.example.test/media/exc/2024/2_preview.jpg')
  assert.equal(second.duration, 95)

  assert.deepEqual((await mediaccc.getLatestItems(fetch, channel)).map(item => item.id), ['guid-3', 'guid-2', 'guid-1'])
  assert.equal(await mediaccc.getChannel(fetch, 'missing'), null)

  // The conference has its talks, so one request loads both
  let requestCount = requests.length
  const withPage = await mediaccc.getChannelWithPage(fetch, 'exc24', 'videos')
  assert.deepEqual(withPage.channel, channel)
  assert.deepEqual(await withPage.page, page)
  assert.equal(requests.length, requestCount + 1)
  assert.equal(await mediaccc.getChannelWithPage(fetch, 'missing', 'videos'), null)

  requestCount = requests.length
  assert.equal(await mediaccc.getChannel(fetch, '../events'), null)
  assert.equal(requests.length, requestCount)
})

test('pages through talk search results and links them to their conference', async () => {
  const { fetch, requests } = fakeFetch(url => Response.json(
    { events: url.searchParams.get('page') === '1' ? [event(1), event(2, { conference_url: 'https://example.test/x' })] : [event(3)] },
    { headers: { total: '3', 'per-page': '2' } }
  ))

  const first = await mediaccc.search(fetch, ' security talk ', 'videos', null)
  assert.equal(requests[0].url.href, `${API}/events/search?q=security+talk&page=1`)
  assert.equal(first.continuation, '2')
  assert.deepEqual(first.results.map(result => result.kind === 'item' && [result.item.channelId, result.item.author]), [
    ['exc24', 'Example Conference 2024'],
    ['', 'Example Conference 2024']
  ])

  const second = await mediaccc.search(fetch, 'security talk', 'videos', first.continuation)
  assert.equal(requests[1].url.searchParams.get('page'), '2')
  assert.equal(second.continuation, null)
  assert.equal(second.results.length, 1)

  assert.deepEqual(await mediaccc.search(fetch, 'security', 'videos', '0'), { results: [], continuation: null })
  assert.equal(requests.length, 2)
})

test('searches conferences by title, acronym and path, newest first', async () => {
  const { fetch, requests } = fakeFetch(() => Response.json({
    conferences: [
      conference({ acronym: 'exc23', title: 'Example Conference 2023', event_last_released_at: '2023-06-01T00:00:00.000+02:00' }),
      conference(),
      conference({ acronym: 'other', title: 'Other Meetup', slug: 'meetups/other' }),
      conference({ acronym: '../x', title: 'Example Conference Broken' })
    ]
  }))

  const page = await mediaccc.search(fetch, 'EXAMPLE conference', 'channels', null)
  assert.equal(requests[0].url.href, `${API}/conferences`)
  assert.equal(page.continuation, null)
  assert.deepEqual(page.results.map(result => result.kind === 'channel' && result.channel.id), ['exc24', 'exc23'])
  const ids = async query => (await mediaccc.search(fetch, query, 'channels', null)).results.map(result => result.kind === 'channel' && result.channel.id)
  assert.deepEqual(await ids('exc23'), ['exc23'])
  assert.deepEqual(await ids('meetups'), ['other'])
})
