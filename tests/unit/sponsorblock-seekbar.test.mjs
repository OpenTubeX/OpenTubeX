import assert from 'node:assert/strict'
import test from 'node:test'

import { updateSponsorBlockSeekBarState } from '../../src/renderer/helpers/player/sponsorBlockSeekBar.js'

test('marker state follows native seekbar stops, including collapsed pending seeks and Shorts', () => {
  const colors = ['var(--seekbar-played-color, var(--primary-color))', 'rgba(255, 255, 255, 0.54)', 'rgba(255, 255, 255, 0.3)']
  for (const [stops, expected] of [
    [[0, 0, 23.3333, 23.3333, 43.3333, 43.3333], ['23.3333', '0', '43.3333']],
    [[30, 30, 20, 20, 50, 50], ['20', '30', '50']],
    [[60, 60, 60, 60, 60, 60], ['60', '60', '60']],
    [[0, 23.3333, 23.3333, 43.3333, 43.3333, 100], ['23.3333', '0', '43.3333']],
  ]) {
    const values = new Map()
    const container = {
      style: {
        background: `linear-gradient(to right, ${stops.map((stop, index) => `${colors[Math.floor(index / 2)]} ${stop}%`).join(', ')})`,
        setProperty: (name, value) => values.set(name, value),
      }
    }
    updateSponsorBlockSeekBarState(container)
    assert.deepEqual([...values.values()], expected)
  }
})

test('an unpainted seekbar does not replace existing marker state', () => {
  const container = { style: { background: '', setProperty: () => assert.fail('No native positions yet') } }
  updateSponsorBlockSeekBarState(container)
})
