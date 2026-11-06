import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/components/ft-shaka-video-player/ft-shaka-video-player.js', import.meta.url), 'utf8')
const handler = source.match(/ {4}function updateSeekBarTooltip\(seekBarContainer, hoverTime, secondsPerPixel\) \{[\s\S]*?\n {4}\}/)[0]

function createTooltip() {
  const thumbnailTime = { textContent: '0:22 · Chapter' }
  const state = {
    seekBarTooltipLabels: new WeakMap(),
    isLive: { value: false },
    hidePopularityGraph: { value: false },
    props: { popularityMarkers: [] },
    isMostReplayed: () => state.mostReplayed,
    getSponsorBlockSeekBarTooltipLabel: () => state.sponsorBlockLabel,
    t: () => 'Most replayed',
    mostReplayed: true,
    sponsorBlockLabel: '',
  }
  const update = vm.runInNewContext(`(${handler})`, state)
  return {
    state,
    thumbnailTime,
    update: () => update({ querySelector: () => thumbnailTime }, 22.6, 0.01),
  }
}

test('replaces and clears labels without Shaka rewriting the preview text', () => {
  const { state, thumbnailTime, update } = createTooltip()
  update()
  update()
  assert.equal(thumbnailTime.textContent, '0:22 · Chapter · Most replayed')

  state.mostReplayed = false
  state.sponsorBlockLabel = 'Sponsor'
  update()
  assert.equal(thumbnailTime.textContent, '0:22 · Chapter · Sponsor')

  state.sponsorBlockLabel = ''
  update()
  assert.equal(thumbnailTime.textContent, '0:22 · Chapter')
})

test('removes only the changed label from a combined tooltip', () => {
  const { state, thumbnailTime, update } = createTooltip()
  state.sponsorBlockLabel = 'Sponsor'
  update()
  assert.equal(thumbnailTime.textContent, '0:22 · Chapter · Most replayed · Sponsor')
  state.sponsorBlockLabel = ''
  update()
  assert.equal(thumbnailTime.textContent, '0:22 · Chapter · Most replayed')
})

test('disabling the popularity graph removes its label while preserving SponsorBlock', () => {
  const { state, thumbnailTime, update } = createTooltip()
  state.sponsorBlockLabel = 'Sponsor'
  update()
  state.hidePopularityGraph.value = true
  update()
  assert.equal(thumbnailTime.textContent, '0:22 · Chapter · Sponsor')
})

test('preserves fresh Shaka timestamps and chapter titles, even when they end with a label', () => {
  const { state, thumbnailTime, update } = createTooltip()
  update()
  thumbnailTime.textContent = '0:23 · Most replayed'
  state.mostReplayed = false
  update()
  assert.equal(thumbnailTime.textContent, '0:23 · Most replayed')

  state.sponsorBlockLabel = 'Sponsor'
  update()
  assert.equal(thumbnailTime.textContent, '0:23 · Most replayed · Sponsor')
  thumbnailTime.textContent = '0:24 · Next chapter'
  update()
  assert.equal(thumbnailTime.textContent, '0:24 · Next chapter · Sponsor')
  state.sponsorBlockLabel = ''
  update()
  assert.equal(thumbnailTime.textContent, '0:24 · Next chapter')
})
