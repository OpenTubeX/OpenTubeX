import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDockedPanelMemory,
  DOCKED_PANEL_CLOSE_ORDER,
  DOCKED_PANEL_RESTORE_ORDER,
} from '../../src/renderer/components/ft-shaka-video-player/opentubex/dockedPanels.js'

test('reopens each remembered panel once', () => {
  const memory = createDockedPanelMemory(['chapters', 'comments'])
  memory.set('queue', true)
  memory.set('comments', false)
  assert.deepEqual(DOCKED_PANEL_RESTORE_ORDER.filter(panel => memory.take(panel)), ['chapters', 'queue'])
  assert.deepEqual(DOCKED_PANEL_RESTORE_ORDER.filter(panel => memory.take(panel)), [])
})

test('closing covers every panel except chapters, which only reopen after a video change', () => {
  assert.deepEqual(
    [...DOCKED_PANEL_CLOSE_ORDER].sort(),
    DOCKED_PANEL_RESTORE_ORDER.filter(panel => panel !== 'chapters').sort()
  )
  assert.equal(DOCKED_PANEL_RESTORE_ORDER[0], 'chapters')
})
