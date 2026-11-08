import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const fixture = JSON.parse(await readFile(new URL('../../e2e/fixtures/innertube/watch/collaboration-lockup.json', import.meta.url), 'utf8'))
const { parseLockupView } = createLocalFeedParsers(() => false)

function firstRowParts(raw) {
  return raw.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[0].metadataParts
}

test('recommendation collaborations show every collaborator in the byline', () => {
  const video = parseLockupView(new YTNodes.LockupView(structuredClone(fixture)))

  assert.equal(video.author, 'Channel One and Channel Two')
  assert.equal(video.authorId, undefined)
  assert.equal(video.hasCollaborators, true)
  assert.deepEqual(video.collaborators.map(collaborator => collaborator.id), ['UC-sample-channel-one', 'UC-sample-channel-two'])
  assert.equal(video.viewCount, 67000)
})

test('recommendation collaborations keep the localized remaining-collaborators text', () => {
  const raw = structuredClone(fixture)
  firstRowParts(raw)[1].text.content = 'und 2 weitere'
  const video = parseLockupView(new YTNodes.LockupView(raw))

  assert.equal(video.author, 'Channel One und 2 weitere')
  assert.equal(video.collaborators.length, 2)
})

test('recommendation collaborations with a single byline part keep it unchanged', () => {
  const raw = structuredClone(fixture)
  firstRowParts(raw).splice(1, 1)
  const video = parseLockupView(new YTNodes.LockupView(raw))

  assert.equal(video.author, 'Channel One')
  assert.equal(video.collaborators.length, 2)
})

test('single-channel lockups do not merge other byline parts into the channel name', () => {
  const raw = structuredClone(fixture)
  const dialog = raw.metadata.lockupMetadataViewModel.image.avatarStackViewModel.rendererContext.commandContext.onTap
    .innertubeCommand.showDialogCommand.panelLoadingStrategy.inlineContent.dialogViewModel
  dialog.customContent.listViewModel.listItems.splice(1, 1)
  const video = parseLockupView(new YTNodes.LockupView(raw))

  assert.equal(video.author, 'Channel One')
})
