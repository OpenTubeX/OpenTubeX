import { execFileSync } from 'node:child_process'
import { access, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import {
  createUserDataDir,
  expect,
  launchApp
} from '../helpers/app.mjs'
import { largeSubscriptionsSeed } from './subscriptions.mjs'
import { runPerformanceScenarios } from './scenarios.mjs'
import {
  comparePerformanceSamples,
  renderPerformanceSummary
} from './report.mjs'

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
  const startupStartedAt = performance.now()
  const startup = {}

  try {
    const launched = await launchApp(userDataDir, [
      '--js-flags=--expose-gc',
      '--enable-precise-memory-info'
    ], {
      appRoot: target.root,
      executablePath: target.executablePath,
      onPhase: async (phase, page) => {
        startup[`startup${phase[0].toUpperCase()}${phase.slice(1)}Ms`] =
          performance.now() - startupStartedAt

        if (phase === 'routeCommitted') {
          await page.evaluate(() => {
            const measurement = {
              animationFrame: null,
              longestFrame: 0,
              previousFrame: performance.now()
            }
            const sampleFrame = timestamp => {
              measurement.longestFrame = Math.max(
                measurement.longestFrame,
                timestamp - measurement.previousFrame
              )
              measurement.previousFrame = timestamp
              measurement.animationFrame = requestAnimationFrame(sampleFrame)
            }
            measurement.animationFrame = requestAnimationFrame(sampleFrame)
            window.__performanceStartupFrames = measurement
          })
        } else if (phase === 'interactive') {
          startup.startupLongestFrameMs = await page.evaluate(() => {
            const measurement = window.__performanceStartupFrames
            cancelAnimationFrame(measurement.animationFrame)
            return Math.max(
              measurement.longestFrame,
              performance.now() - measurement.previousFrame
            )
          })
        }
      }
    })
    electronApp = launched.electronApp
    await closeTutorial(launched.page)
    return await runPerformanceScenarios(launched, startup, target.root)
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

function renderFailureSummary(error) {
  const message = error instanceof Error ? error.message : String(error)
  return [
    '# Performance comparison',
    '',
    'The benchmark failed before all samples completed.',
    '',
    `Error: ${message}`,
    ''
  ].join('\n')
}

async function writeReports(options, result, summary) {
  if (options.output) {
    await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`)
  }
  if (options.summary) {
    await writeFile(options.summary, summary)
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  let base
  let candidate

  try {
    base = await targetFor('base', options.baseRoot)
    candidate = await targetFor('candidate', options.candidateRoot)
    const samples = await runSamples(base, candidate, options)
    const comparison = comparePerformanceSamples(samples)
    const summary = renderPerformanceSummary(base, candidate, comparison, options.reportOnly)
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
    await writeReports(options, result, summary)

    if (!options.reportOnly && comparison.failures.length > 0) {
      process.exitCode = 1
    }
  } catch (error) {
    const summary = renderFailureSummary(error)
    const result = {
      base: base ? { root: base.root, commit: base.commit } : { root: options.baseRoot },
      candidate: candidate
        ? { root: candidate.root, commit: candidate.commit }
        : { root: options.candidateRoot },
      sampleCount: options.samples,
      warmupCount: options.warmups,
      reportOnly: options.reportOnly,
      failures: [error instanceof Error ? error.message : String(error)],
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) }
    }

    console.error(summary)
    await writeReports(options, result, summary)
    throw error
  }
}

await main()
