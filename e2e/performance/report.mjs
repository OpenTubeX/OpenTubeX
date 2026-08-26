export const performanceMetrics = [
  {
    key: 'firstSwitchElapsedMs',
    label: 'First switch elapsed',
    absoluteLimit: 250,
    relativeLimit: 1.15,
    minimumDelta: 20
  },
  {
    key: 'firstSwitchLongestFrameMs',
    label: 'First switch longest frame',
    absoluteLimit: 200,
    relativeLimit: 1.2,
    minimumDelta: 16
  },
  {
    key: 'repeatedSwitchElapsedMs',
    label: 'Repeated switch elapsed',
    absoluteLimit: 150,
    relativeLimit: 1.15,
    minimumDelta: 20
  },
  {
    key: 'repeatedSwitchLongestFrameMs',
    label: 'Repeated switch longest frame',
    absoluteLimit: 100,
    relativeLimit: 1.2,
    minimumDelta: 16
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

export function comparePerformanceSamples(samples) {
  const failures = []
  const metrics = performanceMetrics.map(definition => {
    const baseValues = samples.base.map(sample => sample[definition.key])
    const candidateValues = samples.candidate.map(sample => sample[definition.key])
    const baseMedian = median(baseValues)
    const candidateMedian = median(candidateValues)
    const delta = candidateMedian - baseMedian
    const ratio = candidateMedian / baseMedian
    const exceedsAbsoluteLimit = candidateMedian >= definition.absoluteLimit
    const relativeRegression = ratio > definition.relativeLimit &&
      delta > definition.minimumDelta

    if (exceedsAbsoluteLimit) {
      failures.push(
        `${definition.label} is ${candidateMedian.toFixed(1)} ms, ` +
        `above the ${definition.absoluteLimit} ms limit`
      )
    }
    if (relativeRegression) {
      failures.push(
        `${definition.label} regressed by ${delta.toFixed(1)} ms ` +
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
  const sign = value > 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(1)}%`
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
    '| Metric | Base median | Candidate median | Change | Absolute limit | Result |',
    '| --- | ---: | ---: | ---: | ---: | --- |'
  )
  for (const metric of comparison.metrics) {
    lines.push(
      `| ${metric.label} | ${metric.baseMedian.toFixed(1)} ms | ` +
      `${metric.candidateMedian.toFixed(1)} ms | ${formatPercent(metric.ratio - 1)} | ` +
      `${metric.absoluteLimit} ms | ${metric.passed ? 'Pass' : 'Regression'} |`
    )
  }

  lines.push('')
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
