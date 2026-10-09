import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const fixture = JSON.parse(await readFile(new URL('../../e2e/fixtures/innertube/watch/review-channel-lockup.json', import.meta.url), 'utf8'))
const { parseLockupView } = createLocalFeedParsers(() => false)

for (const name of ['StudioPreview', 'Preview Channel', 'Overviews', 'WatchingToday', 'Awaiting News']) {
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

for (const [text, expected] of [['12K', 12000], ['12K views', 12000], ['1 view', 1], ['123 watching', 123], ['45 waiting', 45]]) {
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
