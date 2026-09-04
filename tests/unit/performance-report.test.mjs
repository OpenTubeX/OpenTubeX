import assert from 'node:assert/strict'
import test from 'node:test'

import { comparePerformanceSamples } from '../../e2e/performance/report.mjs'

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
    navigationHeapGrowthMiB: 6.5,
    playbackStartElapsedMs: 1000,
    playbackStartLongestFrameMs: 50,
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
  },
  {
    key: 'subscribedChannelsNavigationLongestFrameMs',
    label: 'large route navigation longest frame',
    base: [66.7, 83.3, 99.9, 66.7, 66.7, 66.6, 83.3],
    candidate: [83.3, 50, 66.7, 100, 100, 100, 100]
  },
  {
    key: 'firstSwitchElapsedMs',
    label: 'first subscription switch elapsed',
    base: [176.1, 173.3, 184.5, 247.8, 178.6, 186.8, 187.9],
    candidate: [268.6, 186.5, 191.5, 262.3, 255.2, 269.3, 190.7]
  },
  {
    key: 'firstSwitchLongestFrameMs',
    label: 'first subscription switch longest frame',
    base: [116.7, 116.7, 116.5, 183.3, 116.7, 116.6, 116.7],
    candidate: [200, 116.7, 116.6, 200, 183.4, 200, 116.7]
  },
  {
    key: 'repeatedSwitchElapsedMs',
    label: 'repeated subscription switch elapsed',
    base: [89.1, 100.8, 96.5, 100.4, 91.9, 99.7, 116.6],
    candidate: [155.5, 132.3, 167.6, 116, 96.4, 99.7, 163.4]
  },
  {
    key: 'repeatedSwitchLongestFrameMs',
    label: 'repeated subscription switch longest frame',
    base: [33.3, 34.1, 33.3, 33.8, 33.3, 33.3, 50],
    candidate: [66.6, 66.6, 83.4, 50, 33.4, 33.3, 83.4]
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

test('reports a stable absolute crossing when the base upper quartile reaches the limit', () => {
  const comparison = comparePerformanceSamples(samplesForMetric(
    'firstSwitchElapsedMs',
    [230, 235, 240, 245, 250, 255, 260],
    [255, 260, 265, 270, 275, 280, 285]
  ))

  const metric = comparison.metrics.find(
    metric => metric.key === 'firstSwitchElapsedMs'
  )
  assert.equal(metric.passed, false)
  assert.ok(comparison.failures.some(
    failure => /First subscription switch elapsed is 270\.0 ms/.test(failure)
  ))
})
