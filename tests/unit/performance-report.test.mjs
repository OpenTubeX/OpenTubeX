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

test('reports a stable absolute crossing despite a noisy base upper quartile', () => {
  const comparison = comparePerformanceSamples(samplesForMetric(
    'startupLongestFrameMs',
    [450, 475, 490, 495, 500, 525, 550],
    [600, 605, 610, 615, 620, 625, 630]
  ))

  const metric = comparison.metrics.find(
    metric => metric.key === 'startupLongestFrameMs'
  )
  assert.equal(metric.passed, false)
  assert.ok(comparison.failures.some(
    failure => /Startup: renderer longest frame is 615\.0 ms/.test(failure)
  ))
})

test('catches a material slowdown in every paired sample despite overlapping quartiles', () => {
  const comparison = comparePerformanceSamples(samplesForMetric(
    'repeatedSwitchElapsedMs',
    [40, 90, 50, 100, 60, 110, 70],
    [70, 120, 80, 130, 90, 140, 100]
  ))
  const metric = comparison.metrics.find(metric => metric.key === 'repeatedSwitchElapsedMs')
  assert.ok(metric.candidateLowerQuartile < metric.baseUpperQuartile)
  assert.equal(metric.passed, false)
})

test('does not gate a paired shift below the minimum material change', () => {
  const comparison = comparePerformanceSamples(samplesForMetric(
    'repeatedSwitchElapsedMs',
    [40, 90, 50, 100, 60, 110, 70],
    [55, 105, 65, 115, 75, 125, 85]
  ))
  assert.deepEqual(comparison.failures, [])
})

test('rejects missing, unequal, empty and invalid samples before comparing', () => {
  for (const input of [
    {},
    { base: [], candidate: [] },
    { base: [sample()], candidate: [] },
    { base: [sample()], candidate: [sample({ repeatedSwitchElapsedMs: undefined })] },
    { base: [sample()], candidate: [sample({ repeatedSwitchElapsedMs: NaN })] },
    { base: [sample()], candidate: [sample({ repeatedSwitchElapsedMs: Infinity })] },
    { base: [sample()], candidate: [sample({ repeatedSwitchElapsedMs: -1 })] },
  ]) {
    assert.throws(() => comparePerformanceSamples(input), /sample/i)
  }
})

test('requires seven materially slower pairs before using the paired gate', () => {
  const base = [40, 90, 50, 100, 60, 110, 70]
  for (const candidate of [
    [70, 120, 80, 130, 90, 140, 70],
    [70, 120, 80, 130, 90, 140],
  ]) {
    assert.deepEqual(comparePerformanceSamples(samplesForMetric(
      'repeatedSwitchElapsedMs', base.slice(0, candidate.length), candidate
    )).failures, [])
  }
})

test('supports shipped artifacts while rejecting partially missing or omitted current metrics', () => {
  const samples = { base: [sample()], candidate: [sample()] }
  for (const entry of [...samples.base, ...samples.candidate]) {
    delete entry.largeFeedScrollTaskMs
    delete entry.largeFeedScrollElapsedMs
    delete entry.playbackHeapGrowthMiB
  }
  assert.deepEqual(comparePerformanceSamples(samples).failures, [])
  assert.throws(() => comparePerformanceSamples(samples, { requireAllMetrics: true }), /largeFeedScrollElapsedMs/)
  samples.base[0].largeFeedScrollTaskMs = 30
  assert.throws(() => comparePerformanceSamples(samples), /candidate sample largeFeedScrollTaskMs/)
})

for (const definition of performanceMetrics.filter(metric => metric.gate !== false)) {
  test(`detects a large injected ${definition.key} regression`, () => {
    const base = sample()[definition.key]
    const candidate = Math.max(base * 3, base + definition.minimumDelta * 3)
    const comparison = comparePerformanceSamples(samplesForMetric(
      definition.key, Array(7).fill(base), Array(7).fill(candidate)
    ))
    assert.equal(comparison.metrics.find(metric => metric.key === definition.key).passed, false)
  })
}
