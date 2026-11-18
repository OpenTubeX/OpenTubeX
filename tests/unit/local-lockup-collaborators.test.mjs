import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { YTNodes } from 'youtubei.js'
import { createLocalFeedParsers } from '../../src/renderer/helpers/api/local-feed-parsers.js'

const fixture = JSON.parse(await readFile(new URL('../../e2e/fixtures/innertube/watch/collaboration-lockup.json', import.meta.url), 'utf8'))
const { parseLockupView } = createLocalFeedParsers(() => false)

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
