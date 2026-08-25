import { execFileSync } from 'node:child_process'
import { access, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import {
  createUserDataDir,
  expect,
  launchApp
} from '../helpers/app.mjs'
import {
  largeSubscriptionsSeed,
  runLargeSubscriptionsBenchmark
} from './subscriptions.mjs'

const METRICS = [
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

function parseArguments(argv) {
  const options = {
    samples: 7,
    warmups: 2,
    reportOnly: false
  }

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--') {
      continue
    }
    if (argument === '--report-only') {
      options.reportOnly = true
      continue
    }

    const value = argv[++index]
    if (!value) {
      throw new Error(`Missing value for ${argument}`)
    }

    switch (argument) {
      case '--base':
        options.baseRoot = path.resolve(value)
        break
      case '--candidate':
        options.candidateRoot = path.resolve(value)
        break
      case '--output':
        options.output = path.resolve(value)
        break
      case '--summary':
        options.summary = path.resolve(value)
        break
      case '--samples':
        options.samples = parsePositiveInteger(argument, value)
        break
      case '--warmups':
        options.warmups = parsePositiveInteger(argument, value)
        break
      default:
        throw new Error(`Unknown argument ${argument}`)
    }
  }

  if (!options.baseRoot || !options.candidateRoot) {
    throw new Error('Usage: pnpm run test:performance -- --base <path> --candidate <path>')
  }

  return options
}

function parsePositiveInteger(argument, value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${argument} must be a positive integer`)
  }
  return parsed
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[midpoint]
  }
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2
}

function commitLabel(root) {
  return execFileSync('git', ['-C', root, 'rev-parse', '--short=9', 'HEAD'], {
    encoding: 'utf8'
  }).trim()
}

async function targetFor(name, root) {
  const mainPath = path.join(root, 'dist-e2e', 'main.js')
  await access(mainPath)

  const requireFromRoot = createRequire(path.join(root, 'package.json'))
  const executablePath = requireFromRoot('electron')
  await access(executablePath)

  return {
    name,
    root,
    commit: commitLabel(root),
    executablePath
  }
}

async function closeTutorial(page) {
  const tutorial = page.locator('.tutorialOverlay')
  await expect(tutorial).toBeVisible()
  await tutorial.locator('.tutorialActions').getByRole('button').last().click()
  await expect(tutorial).toBeHidden()
}

async function collectSample(target) {
  const userDataDir = await createUserDataDir(largeSubscriptionsSeed)
  let electronApp

  try {
    const launched = await launchApp(userDataDir, [], {
      appRoot: target.root,
      executablePath: target.executablePath
    })
    electronApp = launched.electronApp
    await closeTutorial(launched.page)
    return await runLargeSubscriptionsBenchmark(launched.page)
  } finally {
    await electronApp?.close().catch(() => {})
    await rm(userDataDir, { recursive: true, force: true })
  }
}

async function runSamples(base, candidate, options) {
  const samples = { base: [], candidate: [] }
  const warmupOrder = Array.from({ length: options.warmups }, (_, index) => (
    index % 2 === 0 ? [base, candidate] : [candidate, base]
  )).flat()

  for (const target of warmupOrder) {
    console.log(`Warm-up ${target.name}`)
    await collectSample(target)
  }

  for (let index = 0; index < options.samples; index++) {
    const order = index % 2 === 0 ? [base, candidate] : [candidate, base]
    for (const target of order) {
      console.log(`Sample ${index + 1}/${options.samples} ${target.name}`)
      samples[target.name].push(await collectSample(target))
    }
  }

  return samples
}

function compareSamples(samples) {
  const failures = []
  const metrics = METRICS.map(definition => {
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

function renderSummary(base, candidate, comparison, reportOnly) {
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

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const base = await targetFor('base', options.baseRoot)
  const candidate = await targetFor('candidate', options.candidateRoot)
  const samples = await runSamples(base, candidate, options)
  const comparison = compareSamples(samples)
  const summary = renderSummary(base, candidate, comparison, options.reportOnly)
  const result = {
    base: { root: base.root, commit: base.commit },
    candidate: { root: candidate.root, commit: candidate.commit },
    sampleCount: options.samples,
    warmupCount: options.warmups,
    reportOnly: options.reportOnly,
    samples,
    metrics: comparison.metrics,
    failures: comparison.failures
  }

  console.log(summary)
  if (options.output) {
    await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`)
  }
  if (options.summary) {
    await writeFile(options.summary, summary)
  }

  if (!options.reportOnly && comparison.failures.length > 0) {
    process.exitCode = 1
  }
}

await main()
