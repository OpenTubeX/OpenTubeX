export const performanceMetrics = [
  {
    key: 'startupElectronConnectedMs',
    label: 'Startup: Electron connected',
    unit: 'ms',
    gate: false
  },
  {
    key: 'startupWindowCreatedMs',
    label: 'Startup: window created',
    unit: 'ms',
    gate: false
  },
  {
    key: 'startupRouteCommittedMs',
    label: 'Startup: initial route committed',
    unit: 'ms',
    gate: false
  },
  {
    key: 'startupInteractiveMs',
    label: 'Startup: interactive',
    unit: 'ms',
    absoluteLimit: 6_000,
    relativeLimit: 1.15,
    minimumDelta: 250
  },
  {
    key: 'startupLongestFrameMs',
    label: 'Startup: renderer longest frame',
    unit: 'ms',
    absoluteLimit: 500,
    relativeLimit: 1.2,
    minimumDelta: 16
  },
  {
    key: 'subscribedChannelsNavigationElapsedMs',
    label: 'Large route navigation elapsed',
    unit: 'ms',
    absoluteLimit: 500,
    relativeLimit: 1.15,
    minimumDelta: 30
  },
  {
    key: 'subscribedChannelsNavigationLongestFrameMs',
    label: 'Large route navigation longest frame',
    unit: 'ms',
    absoluteLimit: 200,
    relativeLimit: 1.2,
    minimumDelta: 16
  },
  {
    key: 'channelSearchElapsedMs',
    label: 'Channel search elapsed',
    unit: 'ms',
    absoluteLimit: 200,
    relativeLimit: 1.15,
    minimumDelta: 20
  },
  {
    key: 'channelSearchLongestFrameMs',
    label: 'Channel search longest frame',
    unit: 'ms',
    absoluteLimit: 100,
    relativeLimit: 1.2,
    minimumDelta: 16
  },
  {
    key: 'firstSwitchElapsedMs',
    label: 'First subscription switch elapsed',
    unit: 'ms',
    absoluteLimit: 250,
    relativeLimit: 1.15,
    minimumDelta: 20
  },
  {
    key: 'firstSwitchLongestFrameMs',
    label: 'First subscription switch longest frame',
    unit: 'ms',
    absoluteLimit: 200,
    relativeLimit: 1.2,
    minimumDelta: 16
  },
  {
    key: 'repeatedSwitchElapsedMs',
    label: 'Repeated subscription switch elapsed',
    unit: 'ms',
    absoluteLimit: 150,
    relativeLimit: 1.15,
    minimumDelta: 20
  },
  {
    key: 'repeatedSwitchLongestFrameMs',
    label: 'Repeated subscription switch longest frame',
    unit: 'ms',
    absoluteLimit: 100,
    relativeLimit: 1.2,
    minimumDelta: 16
  },
  {
    key: 'largeFeedScrollLongestFrameMs',
    label: 'Large feed scrolling longest frame',
    unit: 'ms',
    absoluteLimit: 100,
    relativeLimit: 1.2,
    minimumDelta: 16
  },
  {
    key: 'navigationMemoryGrowthMiB',
    label: 'Memory growth after 10 navigation cycles',
    unit: 'MiB',
    minimumValue: 0,
    absoluteLimit: 96,
    relativeLimit: 1.25,
    relativeBaselineFloor: 4,
    minimumDelta: 8,
    absoluteChange: true
  },
  {
    key: 'playbackStartElapsedMs',
    label: 'Local playback start elapsed',
    unit: 'ms',
    absoluteLimit: 5_000,
    relativeLimit: 1.15,
    minimumDelta: 150
  },
  {
    key: 'playbackStartLongestFrameMs',
    label: 'Local playback start longest frame',
    unit: 'ms',
    absoluteLimit: 750,
    relativeLimit: 1.2,
    minimumDelta: 16
  },
  {
    key: 'packedCodeSizeKiB',
    label: 'Packed JavaScript and CSS',
    unit: 'KiB',
    relativeLimit: 1.05,
    minimumDelta: 64
  }
]

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[midpoint]
  }
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2
}

function metricValue(definition, value) {
  return `${value.toFixed(1)} ${definition.unit}`
}

export function isValidPerformanceValue(definition, value) {
  const minimumValue = definition.minimumValue ?? 0
  return Number.isFinite(value) && value >= minimumValue
}

export function comparePerformanceSamples(samples) {
  const failures = []
  const metrics = performanceMetrics.map(definition => {
    const baseValues = samples.base.map(sample => sample[definition.key])
    const candidateValues = samples.candidate.map(sample => sample[definition.key])
    const baseMedian = median(baseValues)
    const candidateMedian = median(candidateValues)
    const delta = candidateMedian - baseMedian
    const ratio = baseMedian === 0
      ? (candidateMedian === 0 ? 1 : Number.POSITIVE_INFINITY)
      : candidateMedian / baseMedian
    const thresholdRatio = candidateMedian /
      Math.max(baseMedian, definition.relativeBaselineFloor ?? Number.MIN_VALUE)
    const gated = definition.gate !== false
    const exceedsAbsoluteLimit = gated && definition.absoluteLimit !== undefined &&
      candidateMedian >= definition.absoluteLimit
    const relativeRegression = gated && definition.relativeLimit !== undefined &&
      thresholdRatio > definition.relativeLimit && delta > definition.minimumDelta

    if (exceedsAbsoluteLimit) {
      failures.push(
        `${definition.label} is ${metricValue(definition, candidateMedian)}, ` +
        `at or above the ${metricValue(definition, definition.absoluteLimit)} limit`
      )
    }
    if (relativeRegression) {
      failures.push(
        `${definition.label} regressed by ${metricValue(definition, delta)} ` +
        `(${formatPercent(ratio - 1)})`
      )
    }

    return {
      ...definition,
      baseValues,
      candidateValues,
      baseMedian,
      candidateMedian,
      delta,
      ratio,
      exceedsAbsoluteLimit,
      relativeRegression,
      passed: !exceedsAbsoluteLimit && !relativeRegression
    }
  })

  return { metrics, failures }
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return value > 0 ? '+∞' : '-∞'
  }
  const sign = value > 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(1)}%`
}

function formatChange(metric) {
  if (metric.absoluteChange) {
    const sign = metric.delta > 0 ? '+' : ''
    return `${sign}${metricValue(metric, metric.delta)}`
  }
  return formatPercent(metric.ratio - 1)
}

function formatLimit(metric) {
  if (metric.gate === false) {
    return 'Diagnostic'
  }
  const relativeLimit = `+${((metric.relativeLimit - 1) * 100).toFixed(0)}% and ` +
    `+${metricValue(metric, metric.minimumDelta)}`
  if (metric.absoluteLimit === undefined) {
    return relativeLimit
  }
  return `${metricValue(metric, metric.absoluteLimit)}<br>or ${relativeLimit}`
}

export function renderPerformanceSummary(base, candidate, comparison, reportOnly = false) {
  const lines = [
    '# Performance comparison',
    '',
    `Compared \`${base.commit}\` with \`${candidate.commit}\` on the same runner.`,
    ''
  ]

  if (reportOnly) {
    lines.push('This workflow reports regressions without failing while thresholds are calibrated.', '')
  }

  lines.push(
    '| Metric | Base median | Candidate median | Change | Limit | Result |',
    '| --- | ---: | ---: | ---: | ---: | --- |'
  )
  for (const metric of comparison.metrics) {
    lines.push(
      `| ${metric.label} | ${metricValue(metric, metric.baseMedian)} | ` +
      `${metricValue(metric, metric.candidateMedian)} | ${formatChange(metric)} | ` +
      `${formatLimit(metric)} | ${metric.gate === false ? 'Reported' : (metric.passed ? 'Pass' : 'Regression')} |`
    )
  }

  lines.push(
    '',
    '<details>',
    '<summary>What these scenarios measure</summary>',
    '',
    '- Startup phases are cumulative from launching Electron. Interactive means the top navigation and tab bar are visible. Startup frame sampling runs from the initial route commit until that point.',
    '- Large route navigation opens 933 subscribed channels. Channel search filters that list down to one channel.',
    '- Subscription switches process 33,588 cached video records. Scrolling moves through the first rendered page for 60 animation frames.',
    '- Memory growth is the renderer working-set increase after 10 Subscribed Channels and Trending navigation cycles, with renderer garbage collection before each reading.',
    '- Local playback start runs from submitting a watch URL until the bundled demo video emits `playing`. It makes no network requests.',
    '- Packed code size totals all emitted JavaScript and CSS, including renderer chunks, the main process, preload, and BotGuard.',
    '',
    '</details>',
    ''
  )
  if (comparison.failures.length === 0) {
    lines.push('No regression crossed the configured thresholds.')
  } else {
    lines.push('Detected regressions:', '')
    for (const failure of comparison.failures) {
      lines.push(`- ${failure}`)
    }
  }

  return `${lines.join('\n')}\n`
}
