import assert from 'node:assert/strict'
import test from 'node:test'
import { getTabsKeptLoaded, keepTabLoaded } from '../../src/renderer/tabs/TabResidency.js'
import { tabMediaCoordinator } from '../../src/renderer/tabs/TabMediaCoordinator.js'

test('keeps a tab loaded until every reason is released', () => {
  keepTabLoaded('casting-tab', 'casting', true)
  keepTabLoaded('casting-tab', 'unsavedEdits', true)
  keepTabLoaded(null, 'casting', true)
  assert.deepEqual(getTabsKeptLoaded(), ['casting-tab'])

  keepTabLoaded('casting-tab', 'casting', false)
  assert.deepEqual(getTabsKeptLoaded(), ['casting-tab'])
  keepTabLoaded('casting-tab', 'unsavedEdits', false)
  keepTabLoaded('other-tab', 'casting', false)
  assert.deepEqual(getTabsKeptLoaded(), [])
})

test('keeps the Picture-in-Picture and mini player tabs loaded', () => {
  for (const tabId of ['pip-1', 'pip-2', 'mini-player']) tabMediaCoordinator.setPlaybackState(tabId, 'paused')

  tabMediaCoordinator.setPictureInPicture('pip-1', true)
  tabMediaCoordinator.setMiniPlayer('mini-player', true)
  assert.deepEqual(getTabsKeptLoaded().toSorted(), ['mini-player', 'pip-1'])

  // Only one video can be in Picture-in-Picture.
  tabMediaCoordinator.setPictureInPicture('pip-2', true)
  assert.deepEqual(getTabsKeptLoaded().toSorted(), ['mini-player', 'pip-2'])

  tabMediaCoordinator.setPictureInPicture('pip-1', false)
  tabMediaCoordinator.setMiniPlayer('mini-player', false)
  assert.deepEqual(getTabsKeptLoaded(), ['pip-2'])

  tabMediaCoordinator.unregister('pip-2')
  assert.deepEqual(getTabsKeptLoaded(), [])
})
