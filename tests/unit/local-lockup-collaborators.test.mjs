import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const fixture = JSON.parse(await readFile(new URL('../../e2e/fixtures/innertube/watch/collaboration-lockup.json', import.meta.url), 'utf8'))
const { parseLockupView, parseLocalChannelCollaborations } = createLocalFeedParsers(() => false)

test('recommendation collaborations show every collaborator in the byline', () => {
  const video = parseLockupView(new YTNodes.LockupView(structuredClone(fixture)))

  assert.equal(video.author, 'Channel One and Channel Two')
  assert.equal(video.authorId, undefined)
  assert.equal(video.hasCollaborators, true)
  assert.deepEqual(video.collaborators.map(collaborator => collaborator.id), ['UC-sample-channel-one', 'UC-sample-channel-two'])
  assert.equal(video.viewCount, 67000)
})

test('single-channel lockups do not merge other byline parts into the channel name', () => {
  const raw = structuredClone(fixture)
  const dialog = raw.metadata.lockupMetadataViewModel.image.avatarStackViewModel.rendererContext.commandContext.onTap
    .innertubeCommand.showDialogCommand.panelLoadingStrategy.inlineContent.dialogViewModel
  dialog.customContent.listViewModel.listItems.splice(1, 1)
  const video = parseLockupView(new YTNodes.LockupView(raw))

  assert.equal(video.author, 'Channel One')
})

test('a channel\'s Home tab lists the collaborations another channel uploaded', () => {
  const lockup = () => new YTNodes.LockupView(structuredClone(fixture))

  const [video, ...rest] = parseLocalChannelCollaborations([lockup(), lockup()], 'UC-sample-channel-two')
  assert.equal(rest.length, 0)
  assert.equal(video.authorId, 'UC-sample-channel-one')
  assert.equal(video.isCollaboration, true)
  assert.deepEqual(parseLocalChannelCollaborations([lockup()], 'UC-sample-channel-one'), [])
  assert.deepEqual(parseLocalChannelCollaborations([lockup()], 'UC-unrelated-channel'), [])
})

test('classic video results on the Home tab also count as collaborations', () => {
  const dialogCommand = fixture.metadata.lockupMetadataViewModel.image.avatarStackViewModel.rendererContext.commandContext
    .onTap.innertubeCommand
  const video = new YTNodes.Video({
    videoId: 'sample-video',
    title: { runs: [{ text: 'Sample video' }] },
    ownerText: { runs: [{ text: 'Channel One and Channel Two', navigationEndpoint: dialogCommand }] },
    publishedTimeText: { simpleText: '1 day ago' },
    lengthText: { simpleText: '1:00' },
    viewCountText: { simpleText: '5 views' }
  })

  const [collaboration] = parseLocalChannelCollaborations([video], 'UC-sample-channel-two')
  assert.equal(collaboration?.authorId, 'UC-sample-channel-one')
  assert.equal(collaboration.isCollaboration, true)
})

test('a channel tab lockup without a byline keeps its channel, even when the name contains "and"', () => {
  const raw = structuredClone(fixture)
  const metadata = raw.metadata.lockupMetadataViewModel
  delete metadata.image
  metadata.metadata.contentMetadataViewModel.metadataRows.splice(0, 1)
  const video = parseLockupView(new YTNodes.LockupView(raw), 'UC-sample-channel', 'Sample and Channel')

  assert.equal(video.author, 'Sample and Channel')
  assert.equal(video.authorId, 'UC-sample-channel')
  assert.equal(video.hasCollaborators, false)
})
