import assert from 'node:assert/strict'
import test from 'node:test'

import { comparePerformanceSamples, performanceMetrics } from '../../e2e/performance/report.mjs'

function sample (overrides = {}) {
  return {
    startupElectronConnectedMs: 500,
    startupWindowCreatedMs: 600,
    startupRouteCommittedMs: 700,
    startupInteractiveMs: 800,
    startupLongestFrameMs: 50,
    subscribedChannelsNavigationElapsedMs: 120,
    subscribedChannelsNavigationLongestFrameMs: 40,
    channelSearchElapsedMs: 60,
    channelSearchLongestFrameMs: 30,
    firstSwitchElapsedMs: 100,
    firstSwitchLongestFrameMs: 50,
    repeatedSwitchElapsedMs: 80,
    repeatedSwitchLongestFrameMs: 40,
    largeFeedScrollLongestFrameMs: 20,
    largeFeedScrollElapsedMs: 1000,
    largeFeedScrollTaskMs: 30,
    hoveredWatchNavigationElapsedMs: 300,
    navigationHeapGrowthMiB: 6.5,
    playbackStartElapsedMs: 1000,
    playbackStartLongestFrameMs: 50,
    playbackHeapGrowthMiB: 0,
    packedCodeSizeKiB: 4000,
    ...overrides
  }
}

function samplesForMetric (key, baseValues, candidateValues) {
  return {
    base: baseValues.map(value => sample({ [key]: value })),
    candidate: candidateValues.map(value => sample({ [key]: value }))
  }
}

const recoveredFlakes = [
  {
    key: 'subscribedChannelsNavigationElapsedMs',
    label: 'large route navigation elapsed',
    base: [103.8, 116.2, 148.9, 104.6, 114.9, 142.9, 120.5],
    candidate: [123.4, 152.5, 125.1, 122.4, 152, 149.7, 155.9]
  }
]

for (const flake of recoveredFlakes) {
  test(`ignores recovered ${flake.label} flake`, () => {
    const comparison = comparePerformanceSamples(samplesForMetric(
      flake.key,
      flake.base,
      flake.candidate
    ))

    const metric = comparison.metrics.find(metric => metric.key === flake.key)
    assert.equal(metric.passed, true)
    assert.deepEqual(comparison.failures, [])
  })
}

test('reports a consistent regression despite sample spread', () => {
  const comparison = comparePerformanceSamples(samplesForMetric(
    'repeatedSwitchElapsedMs',
    [90, 95, 100, 105, 110, 98, 102],
    [140, 145, 150, 155, 160, 148, 152]
  ))

  const metric = comparison.metrics.find(
    metric => metric.key === 'repeatedSwitchElapsedMs'
  )
  assert.equal(metric.passed, false)
  assert.ok(comparison.failures.some(
    failure => /Repeated subscription switch elapsed regressed/.test(failure)
  ))
})

for (const definition of performanceMetrics.filter(metric => metric.key === 'repeatedSwitchElapsedMs')) {
  test(`detects a large injected ${definition.key} regression`, () => {
    const base = sample()[definition.key]
    const candidate = Math.max(base * 3, base + definition.minimumDelta * 3)
    const comparison = comparePerformanceSamples(samplesForMetric(
      definition.key, Array(7).fill(base), Array(7).fill(candidate)
    ))
    assert.equal(comparison.metrics.find(metric => metric.key === definition.key).passed, false)
  })
}
