import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const fixture = JSON.parse(await readFile(new URL('../../e2e/fixtures/innertube/watch/review-channel-lockup.json', import.meta.url), 'utf8'))
const { parseLockupView } = createLocalFeedParsers(() => false)

for (const field of ['title', 'metadata']) {
  test(`preserves a video when its ${field} is missing`, () => {
    const card = new YTNodes.LockupView(structuredClone(fixture))
    if (field === 'metadata') delete card.metadata
    else delete card.metadata.title
    const video = parseLockupView(card, 'UCfallback', 'Fallback channel')
    assert.equal(video.videoId, card.content_id)
    assert.equal(video.title, '')
  })
}

for (const contentType of ['VIDEO', 'SHORT']) {
  test(`drops a ${contentType} card without a video ID`, () => {
    const card = new YTNodes.LockupView(structuredClone(fixture))
    card.content_type = contentType
    delete card.content_id
    assert.equal(parseLockupView(card), null)
  })
}

for (const [label, age] of [
  // YouTube uses abbreviated minute labels with a non-breaking space.
  ['57\u00a0min ago', 57 * 60_000],
  ['57m ago', 57 * 60_000],
  ['2mo ago', 2 * 2_592_000_000],
  ['Streamed 57\u00a0min ago', 57 * 60_000]
]) {
  test(`preserves the recommendation upload time for ${JSON.stringify(label)}`, (t) => {
    const now = Date.UTC(2026, 9, 11, 12)
    t.mock.method(Date, 'now', () => now)
    const raw = structuredClone(fixture)
    raw.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[1].metadataParts[1] = {
      text: { content: label }
    }
    const video = parseLockupView(new YTNodes.LockupView(raw))
    assert.equal(video.published, now - age)
  })
}

for (const name of ['Preview Channel', 'WatchingToday']) {
  test(`preserves the recommendation channel ${name} and its view count`, () => {
    const raw = structuredClone(fixture)
    raw.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0].text.content = name
    const video = parseLockupView(new YTNodes.LockupView(raw))
    assert.equal(video.author, name)
    assert.equal(video.authorId, 'UC-sample-channel')
    assert.equal(video.viewCount, 12000)
    assert.equal(video.lengthSeconds, 245)
  })
}

for (const [text, expected] of [['12K', 12000], ['123 watching', 123]]) {
  test(`keeps ${text} as view metadata when the uploader row is omitted`, () => {
    const raw = structuredClone(fixture)
    raw.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows = [
      { metadataParts: [{ text: { content: text } }] },
      { badges: [] }
    ]
    const video = parseLockupView(new YTNodes.LockupView(raw), 'UCfallback', 'Fallback Channel')
    assert.equal(video.author, 'Fallback Channel')
    assert.equal(video.viewCount, expected)
  })
}
