import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Misc, YTNodes } from 'youtubei.js'
import {
  createLocalFeedParsers,
  getAuthorVerification,
  getTextVerification
} from '../../src/renderer/helpers/api/local-feed-parsers.js'

const lockupFixture = JSON.parse(await readFile(new URL('../../e2e/fixtures/innertube/watch/review-channel-lockup.json', import.meta.url), 'utf8'))
const { parseLocalListVideo, parseLockupView } = createLocalFeedParsers(() => false)

const NOT_VERIFIED = { authorVerified: false, authorVerifiedArtist: false }
const VERIFIED = { authorVerified: true, authorVerifiedArtist: false }
const VERIFIED_ARTIST = { authorVerified: true, authorVerifiedArtist: true }

function ownerBadge(style) {
  return { metadataBadgeRenderer: { style, icon: { iconType: 'CHECK_CIRCLE_THICK' }, tooltip: 'Verified' } }
}

function attachedText(content, imageName) {
  return {
    content,
    attachmentRuns: imageName
      ? [{
          startIndex: content.length,
          length: 0,
          element: { type: { imageType: { image: { sources: [{ clientResource: { imageName }, width: 14, height: 14 }] } } } }
        }]
      : []
  }
}

for (const [style, expected] of [
  ['BADGE_STYLE_TYPE_VERIFIED', VERIFIED],
  ['BADGE_STYLE_TYPE_VERIFIED_ARTIST', VERIFIED_ARTIST]
]) {
  test(`maps the ${style} owner badge on search result videos`, () => {
    const video = new YTNodes.Video({
      videoId: 'video-id',
      title: { runs: [{ text: 'Video' }] },
      ownerText: { runs: [{ text: 'Channel', navigationEndpoint: { browseEndpoint: { browseId: 'UCchannel' } } }] },
      ownerBadges: [ownerBadge(style)],
      lengthText: { simpleText: '1:00' },
      thumbnailOverlays: []
    })

    assert.deepEqual(pickVerification(parseLocalListVideo(video)), expected)
  })
}

test('leaves search result videos without owner badges unverified', () => {
  const video = new YTNodes.Video({
    videoId: 'video-id',
    title: { runs: [{ text: 'Video' }] },
    ownerText: { runs: [{ text: 'Channel', navigationEndpoint: { browseEndpoint: { browseId: 'UCchannel' } } }] },
    lengthText: { simpleText: '1:00' },
    thumbnailOverlays: []
  })

  assert.deepEqual(pickVerification(parseLocalListVideo(video)), NOT_VERIFIED)
})

for (const [imageName, expected] of [
  ['CHECK_CIRCLE_FILLED', VERIFIED],
  ['AUDIO_BADGE', VERIFIED_ARTIST],
  [undefined, NOT_VERIFIED]
]) {
  test(`maps the ${imageName ?? 'missing'} channel name attachment on lockup videos`, () => {
    const raw = structuredClone(lockupFixture)
    const part = raw.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0]
    part.text = attachedText(part.text.content, imageName)

    const video = parseLockupView(new YTNodes.LockupView(raw))

    assert.equal(video.author, 'StudioPreview')
    assert.deepEqual(pickVerification(video), expected)
  })
}

for (const [name, expected] of [['CHECK_CIRCLE_FILLED', VERIFIED], ['AUDIO_BADGE', VERIFIED_ARTIST]]) {
  test(`maps the ${name} channel name part icon on lockup videos`, () => {
    const raw = structuredClone(lockupFixture)
    raw.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0].icon = {
      name, height: 14, width: 14, accessibilityLabel: 'Verified'
    }

    assert.deepEqual(pickVerification(parseLockupView(new YTNodes.LockupView(raw))), expected)
  })
}

test('maps comment author flags', () => {
  assert.deepEqual(getAuthorVerification(new Misc.Author({ simpleText: 'Creator' }, { isVerified: true, isArtist: false })), VERIFIED)
  // Comments can mark an artist as both verified and an artist
  assert.deepEqual(getAuthorVerification(new Misc.Author({ simpleText: 'Artist' }, { isVerified: true, isArtist: true })), VERIFIED_ARTIST)
  assert.deepEqual(getAuthorVerification(new Misc.Author({ simpleText: 'Artist' }, { isVerified: false, isArtist: true })), VERIFIED_ARTIST)
  assert.deepEqual(getAuthorVerification(new Misc.Author({ simpleText: 'Viewer' }, { isVerified: false, isArtist: false })), NOT_VERIFIED)
  assert.deepEqual(getAuthorVerification(undefined), NOT_VERIFIED)
})

test('maps the channel page header title attachment', () => {
  assert.deepEqual(getTextVerification(Misc.Text.fromAttributed(attachedText('Linus Tech Tips', 'CHECK_CIRCLE_FILLED'))), VERIFIED)
  assert.deepEqual(getTextVerification(Misc.Text.fromAttributed(attachedText('Rick Astley', 'AUDIO_BADGE'))), VERIFIED_ARTIST)
  assert.deepEqual(getTextVerification(Misc.Text.fromAttributed(attachedText('Small channel'))), NOT_VERIFIED)
  assert.deepEqual(getTextVerification(undefined), NOT_VERIFIED)
})

function pickVerification({ authorVerified, authorVerifiedArtist }) {
  return { authorVerified, authorVerifiedArtist }
}
