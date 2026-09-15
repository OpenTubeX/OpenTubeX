import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileFunction } from 'node:vm'
import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const { parseLocalSubscriberCount, parseLocalTextRuns } = createLocalFeedParsers(() => false)
import { parseLocalVideoSummary } from '../../src/renderer/helpers/video-summary.js'
import { parseLocalVideoGames } from '../../src/renderer/helpers/video-games.js'
import { parseLocalVideoCollaborators } from '../../src/renderer/helpers/video-collaborators.js'

const source = await readFile(new URL('../../src/renderer/views/Watch/Watch.js', import.meta.url), 'utf8')
const start = source.indexOf('    getVideoInformationLocal:')
const end = source.indexOf('\n    },', start)
const chapterStart = source.indexOf('    extractChaptersFromDescription:')
const chapterEnd = source.indexOf('\n    },', chapterStart)
const extractChaptersFromDescription = compileFunction(`return ({${source.slice(chapterStart, chapterEnd)}\n} }).extractChaptersFromDescription`)()

async function loadMetadata(info, avoidTranslation = 'disabled', options = {}) {
  info.streaming_data = { formats: [], adaptive_formats: [{ url: 'https://example.com/video' }] }
  const errors = []
  const dependencies = {
    initializeNetworkRecovery: () => ({ ready: Promise.resolve() }),
    getConnectionState: () => 'online',
    getLocalVideoInfo: async () => ({ info, paidPromotionDurationMs: null }),
    getOembedTitle: options.getOembedTitle ?? (async () => null),
    areLocalCommentsDisabled: () => true,
    parseLocalEndscreen: () => [],
    parseLocalVideoGames,
    parseLocalVideoSummary,
    YTNodes,
    parseLocalTextRuns,
    MANIFEST_TYPE_DASH: 'dash',
    parseLocalVideoCollaborators,
    parseLocalSubscriberCount,
    formatNumber: String,
    console: { error: error => errors.push(String(error)) },
  }
  const load = compileFunction(`return ({${source.slice(start, end)}\n} }).getVideoInformationLocal`, Object.keys(dependencies))(...Object.values(dependencies))
  let completed = false
  const watch = {
    restrictedPlaybackError: null,
    createLocalDashManifest: async () => 'manifest',
    applyDownloadedPlaybackSource: () => false,
    alignActiveFormatWithAvailableSources() {},
    applyYtDlpPlaybackSource() {},
    firstLoad: true, videoLoadGeneration: 0, videoId: 'testVideo01',
    tabRoute: { params: { id: 'testVideo01' } },
    isCurrentVideoLoad: () => true,
    $store: { getters: { getAvoidTranslation: avoidTranslation }, commit() {} },
    setTabAvatar() {}, updateSubscriptionDetails() {}, initializePlaybackRate() {}, initializeVideoQuality() {},
    extractChaptersFromDescription, finalizeChapters() {}, getSponsorBlockCommunityChapters: async () => [],
    updateShortsPlayerState() {}, updateTitle() { completed = true },
    runIpBlockRecoveryScriptAndReload: async () => false,
    finishDownloadedPlaybackWithoutMetadata: () => false,
    getUnavailableVideoThumbnail: () => '',
    hideVideoLikesAndDislikes: options.hideVideoLikesAndDislikes ?? true,
  }
  await load.call(watch)
  assert.deepEqual(errors, [])
  assert.equal(watch.errorMessage, undefined)
  assert.equal(watch.isLoading, false)
  assert.equal(completed, true)
  assert.equal(watch.manifestSrc, 'manifest')
  return watch
}

for (const views of [undefined, 1234]) {
  test(`loads player metadata without watch-page panels, view count ${views}`, async () => {
    const watch = await loadMetadata({
      playability_status: { status: 'OK' },
      basic_info: { title: ' Video title ', view_count: views, channel_id: 'channel', author: 'Author', duration: 42 },
      page: [],
    })
    assert.equal(watch.videoTitle, 'Video title')
    assert.equal(watch.hasResolvedVideoTitle, true)
    assert.equal(watch.videoViewCount, views ?? null)
    assert.equal(watch.channelId, 'channel')
    assert.equal(watch.channelName, 'Author')
    assert.equal(watch.channelThumbnail, '')
    assert.equal(watch.channelSubscriptionCountText, '')
    assert.equal(watch.license, undefined)
    assert.equal(watch.videoLengthSeconds, 42)
  })
}

for (const secondary of [{}, { owner: {} }, { owner: { author: {} } }]) {
  test(`loads partial watch-page panels ${JSON.stringify(secondary)}`, async () => {
    const watch = await loadMetadata({
      playability_status: { status: 'OK' }, basic_info: {}, page: [],
      primary_info: { title: { text: 'Localized title' }, view_count: { text: '1,234 views' } },
      secondary_info: secondary,
    })
    assert.equal(watch.videoTitle, 'Localized title')
    assert.equal(watch.videoViewCount, 1234)
    assert.equal(watch.channelId, '')
    assert.equal(watch.channelName, '')
    assert.equal(watch.channelSubscriptionCountText, '')
  })
}

test('preserves complete watch-page metadata and a zero player view count', async () => {
  const watch = await loadMetadata({
    playability_status: { status: 'OK' }, basic_info: { title: 'Original', view_count: 0 }, page: [],
    primary_info: { title: { text: 'Localized' }, view_count: { text: '123 views' }, badges: [{ label: 'AI' }] },
    secondary_info: {
      metadata: { rows: [{ title: { text: 'License' }, contents: [{ text: 'Creative Commons' }] }] },
      description: { text: 'Description' },
      owner: {
        author: { id: 'channel', name: 'Author', best_thumbnail: { url: 'avatar' } },
        subscriber_count: { isEmpty: () => false, text: '42' },
      },
    },
  })
  assert.equal(watch.videoTitle, 'Localized')
  assert.equal(watch.videoViewCount, 0)
  assert.equal(watch.license, 'Creative Commons')
  assert.equal(watch.channelId, 'channel')
  assert.equal(watch.channelName, 'Author')
  assert.equal(watch.channelThumbnail, 'avatar')
  assert.equal(watch.channelSubscriptionCountText, '42')
  assert.equal(watch.hasAiGeneratedContent, true)
})

// Synthetic metadata for a response with a description panel but no main watch panels.
function descriptionPanel() {
  return new YTNodes.StructuredDescriptionContent({ items: [
    { videoDescriptionHeaderRenderer: {
      title: { simpleText: 'Description-panel title' },
      channel: { simpleText: 'Example Channel' },
      views: { simpleText: '42 views' },
      publishDate: { simpleText: 'Jan 2, 2025' },
      channelNavigationEndpoint: { browseEndpoint: { browseId: 'UC_TEST_CHANNEL' } },
      channelThumbnail: { thumbnails: [{ url: 'avatar', width: 88, height: 88 }] },
    } },
    { videoDescriptionInfocardsSectionRenderer: {
      sectionTitle: { simpleText: 'Example Channel' },
      sectionSubtitle: { simpleText: '123 subscribers' },
    } },
    { expandableVideoDescriptionBodyRenderer: {
      attributedDescriptionBodyText: { content: 'Localized description' },
    } },
  ] })
}

test('recovers metadata from the structured description when watch panels are absent', async () => {
  const content = descriptionPanel()
  const watch = await loadMetadata({
    playability_status: { status: 'OK' }, basic_info: {},
    page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content }] }],
  })
  assert.equal(watch.videoTitle, 'Description-panel title')
  assert.equal(watch.videoViewCount, 42)
  assert.equal(watch.channelName, 'Example Channel')
  assert.equal(watch.channelId, 'UC_TEST_CHANNEL')
  assert.equal(watch.channelThumbnail, 'avatar')
  assert.equal(watch.channelSubscriptionCountText, '123')
  assert.equal(watch.videoDescription, 'Localized description')
  assert.equal(watch.videoPublished, Date.parse('Jan 2, 2025'))
})


test('keeps player metadata when the description panel has no title or description', async () => {
  const content = descriptionPanel()
  content.items[0].title = { text: undefined }
  content.items[2].attributed_description_body_text = undefined
  const watch = await loadMetadata({
    playability_status: { status: 'OK' },
    basic_info: { title: 'Player title', short_description: '', view_count: 42 },
    page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content }] }],
  })
  assert.equal(watch.videoTitle, 'Player title')
  assert.equal(watch.videoDescription, '')
  assert.equal(watch.channelThumbnail, 'avatar')
  assert.equal(watch.channelSubscriptionCountText, '123')
})

test('honors the original-language preference with description-panel metadata', async () => {
  const content = descriptionPanel()
  const watch = await loadMetadata({
    playability_status: { status: 'OK' },
    basic_info: { title: 'Original title', short_description: 'Original description', view_count: 0 },
    page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content }] }],
  }, 'enabled')
  assert.equal(watch.videoTitle, 'Original title')
  assert.equal(watch.videoDescription, 'Original description')
  assert.equal(watch.videoViewCount, 0)
  assert.equal(watch.channelSubscriptionCountText, '123')
})


for (const [text, count] of [['2 likes', 2], ['1.2K likes', 1200]]) {
  test(`recovers ${text} from the description factoid`, async () => {
    const content = descriptionPanel()
    content.items[0].factoids.push(new YTNodes.Factoid({
      label: { simpleText: 'Likes' }, value: { simpleText: text.split(' ')[0] }, accessibilityText: text,
    }))
    const watch = await loadMetadata({
      playability_status: { status: 'OK' }, basic_info: { title: 'Title' },
      page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content }] }],
    }, 'disabled', { hideVideoLikesAndDislikes: false })
    assert.equal(watch.videoLikeCount, count)
  })
}

test('retrieves a missing title from oEmbed', async () => {
  let calls = 0
  const watch = await loadMetadata({ playability_status: { status: 'OK' }, basic_info: {}, page: [] }, 'disabled', {
    getOembedTitle: async id => { assert.equal(id, 'testVideo01'); calls++; return 'Recovered title' },
  })
  assert.equal(calls, 1)
  assert.equal(watch.videoTitle, 'Recovered title')
  assert.equal(watch.hasResolvedVideoTitle, true)
})

test('does not request oEmbed when the title is present', async () => {
  await loadMetadata({ playability_status: { status: 'OK' }, basic_info: { title: 'Title' }, page: [] }, 'disabled', {
    getOembedTitle: () => assert.fail('Unexpected oEmbed request'),
  })
})

for (const state of ['cached', 'in flight']) {
  test(`reuses the ${state} original-language title request`, async () => {
    const utils = await readFile(new URL('../../src/renderer/helpers/utils.js', import.meta.url), 'utf8')
    const oembed = utils.slice(utils.indexOf('const OEMBED_TITLE_CACHE_LIMIT')).replace(/^export /gm, '')
    let requests = 0
    let respond
    const response = new Promise(resolve => { respond = resolve })
    const getOembedTitle = compileFunction(`${oembed}\nreturn getOembedTitle`, ['fetch'])(() => {
      requests++
      return response
    })
    // The video list starts this lookup for the original-language preference.
    const listTitle = getOembedTitle('testVideo01')
    const finish = () => respond({ json: async () => ({ title: 'Original title' }) })
    if (state === 'cached') { finish(); await listTitle }
    const watch = await loadMetadata({ playability_status: { status: 'OK' }, basic_info: {}, page: [] }, 'entire_app', { getOembedTitle })
    assert.equal(watch.isLoading, false)
    if (state === 'in flight') finish()
    await listTitle
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests, 1)
    assert.equal(watch.videoTitle, 'Original title')
  })
}

for (const change of ['navigation', 'another title source']) {
  test(`ignores a late oEmbed title after ${change}`, async () => {
    let respond
    const title = new Promise(resolve => { respond = resolve })
    const watch = await loadMetadata({ playability_status: { status: 'OK' }, basic_info: {}, page: [] }, 'disabled', {
      getOembedTitle: () => title,
    })
    if (change === 'navigation') watch.isCurrentVideoLoad = () => false
    else { watch.videoTitle = 'Other title'; watch.hasResolvedVideoTitle = true }
    respond('Late title')
    await title
    assert.equal(watch.videoTitle, change === 'navigation' ? '' : 'Other title')
  })
}

for (const hidden of [false, true]) {
  test(`preserves zero likes and the hide-likes preference ${hidden}`, async () => {
    const content = descriptionPanel()
    content.items[0].factoids.push(new YTNodes.Factoid({ label: { simpleText: 'Likes' }, value: { simpleText: '2' } }))
    const watch = await loadMetadata({
      playability_status: { status: 'OK' }, basic_info: { title: 'Title', like_count: 0 },
      page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content }] }],
    }, 'disabled', { hideVideoLikesAndDislikes: hidden })
    assert.equal(watch.videoLikeCount, hidden ? null : 0)
  })
}


test('uses description-panel text when parsed main-panel text is empty', async () => {
  const content = descriptionPanel()
  const watch = await loadMetadata({
    playability_status: { status: 'OK' }, basic_info: {},
    secondary_info: new YTNodes.VideoSecondaryInfo({ owner: { videoOwnerRenderer: {} } }),
    primary_info: new YTNodes.VideoPrimaryInfo({}),
    page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content }] }],
  })
  assert.equal(watch.videoDescription, 'Localized description')
  assert.equal(watch.channelName, 'Example Channel')
  assert.equal(watch.channelId, 'UC_TEST_CHANNEL')
  assert.equal(watch.channelSubscriptionCountText, '123')
  assert.equal(watch.videoPublished, Date.parse('Jan 2, 2025'))
})

for (const title of ['', '   ']) {
  test(`skips blank localized title ${JSON.stringify(title)} without requesting oEmbed`, async () => {
    const watch = await loadMetadata({
      playability_status: { status: 'OK' }, basic_info: { title: 'Player title' },
      primary_info: new YTNodes.VideoPrimaryInfo({ title: { simpleText: title } }), page: [],
    }, 'disabled', { getOembedTitle: () => assert.fail('Title already available') })
    assert.equal(watch.videoTitle, 'Player title')
  })
}

for (const [text, expected] of [['No views', 0], ['1.2K views', 1200], ['Views unavailable', null]]) {
  test(`parses description-panel view count ${text}`, async () => {
    const content = descriptionPanel()
    content.items[0].views.text = text
    const watch = await loadMetadata({
      playability_status: { status: 'OK' }, basic_info: {},
      page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content }] }],
    })
    assert.equal(watch.videoViewCount, expected)
  })
}

test('uses a parsed title header before requesting oEmbed', async () => {
  const content = descriptionPanel()
  content.items[0].title = { text: undefined }
  // The parser-panel fix retains this existing node class in structured descriptions.
  content.items.unshift(new YTNodes.VideoTitleHeaderView({ videoTitle: { content: 'Header title' } }))
  const watch = await loadMetadata({
    playability_status: { status: 'OK' }, basic_info: {},
    page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content }] }],
  }, 'disabled', { getOembedTitle: () => assert.fail('Title already available') })
  assert.equal(watch.videoTitle, 'Header title')
})

test('tolerates a loading placeholder in the description panel', async () => {
  const watch = await loadMetadata({
    playability_status: { status: 'OK' }, basic_info: { title: 'Player title' },
    page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content: { type: 'ContentLoading', use_spinner: true } }] }],
  })
  assert.equal(watch.videoTitle, 'Player title')
})

test('falls back from a non-finite player view count', async () => {
  const content = descriptionPanel()
  const watch = await loadMetadata({
    playability_status: { status: 'OK' }, basic_info: { view_count: Number.NaN },
    page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content }] }],
  })
  assert.equal(watch.videoViewCount, 42)
})

test('tolerates omitted raw description-header fields after parsing', async () => {
  const content = new YTNodes.StructuredDescriptionContent({ items: [{ videoDescriptionHeaderRenderer: {} }] })
  const watch = await loadMetadata({
    playability_status: { status: 'OK' }, basic_info: { title: 'Player title' },
    page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content }] }],
  }, 'disabled', { hideVideoLikesAndDislikes: false })
  assert.equal(watch.videoTitle, 'Player title')
  assert.equal(watch.videoViewCount, null)
  assert.equal(watch.channelThumbnail, '')
  assert.equal(watch.videoPublished, 0)
})


for (const original of [false, true]) {
  test(`extracts plain-text chapters with the original-language preference ${original}`, async () => {
    const content = descriptionPanel()
    content.items[2] = new YTNodes.ExpandableVideoDescriptionBody({
      attributedDescriptionBodyText: { content: '0:00 Intro & setup\n0:10 Main topic' },
    })
    const watch = await loadMetadata({
      playability_status: { status: 'OK' }, basic_info: { short_description: original ? '0:00 Original chapter' : '' },
      page: [{}, { engagement_panels: [{ panel_identifier: 'engagement-panel-structured-description', content }] }],
    }, original ? 'entire_app' : 'disabled')
    assert.deepEqual(watch.videoChapters.map(chapter => chapter.title), original ? ['Original chapter'] : ['Intro & setup', 'Main topic'])
  })
}
