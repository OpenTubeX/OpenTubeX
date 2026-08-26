import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import {
  comparePerformanceSamples,
  isValidPerformanceValue,
  performanceMetrics,
  renderPerformanceSummary
} from '../e2e/performance/report.mjs'

export const performanceCommentMarker = '<!-- performance-comparison -->'

function assertCommit(commit, name) {
  if (typeof commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(commit)) {
    throw new Error(`${name} commit is invalid`)
  }
}

function validateSamples(samples, sampleCount) {
  if (!samples || !Array.isArray(samples.base) || !Array.isArray(samples.candidate)) {
    throw new Error('Performance samples are missing')
  }

  for (const name of ['base', 'candidate']) {
    if (samples[name].length !== sampleCount) {
      throw new Error(`${name} sample count does not match the report`)
    }

    for (const sample of samples[name]) {
      for (const metric of performanceMetrics) {
        const value = sample?.[metric.key]
        if (!isValidPerformanceValue(metric, value)) {
          throw new Error(`${name} sample ${metric.key} is invalid`)
        }
      }
    }
  }
}

function validateResult(result, headSha) {
  if (!result || typeof result !== 'object') {
    throw new Error('Performance result is invalid')
  }

  const baseCommit = result.base?.commit
  const candidateCommit = result.candidate?.commit
  assertCommit(baseCommit, 'Base')
  assertCommit(candidateCommit, 'Candidate')
  assertCommit(headSha, 'Workflow head')

  if (!headSha.startsWith(candidateCommit)) {
    throw new Error('Performance result does not match the workflow head')
  }
  if (!Number.isSafeInteger(result.sampleCount) || result.sampleCount < 1) {
    throw new Error('Performance sample count is invalid')
  }
  if (result.reportOnly !== false) {
    throw new Error('Performance result did not enforce regressions')
  }

  validateSamples(result.samples, result.sampleCount)

  return {
    base: { commit: baseCommit },
    candidate: { commit: candidateCommit },
    samples: result.samples
  }
}

export function renderPerformanceComment(result, { headSha, runUrl }) {
  const validated = validateResult(result, headSha)
  const comparison = comparePerformanceSamples(validated.samples)
  const summary = renderPerformanceSummary(
    validated.base,
    validated.candidate,
    comparison
  ).replace(/^# Performance comparison/, '## Performance comparison')

  return `${performanceCommentMarker}\n${summary}\n[View workflow run](${runUrl})\n`
}

export function renderUnavailablePerformanceComment(runUrl) {
  return `${performanceCommentMarker}\n` +
    '## Performance comparison\n\n' +
    'The benchmark did not produce a valid results artifact.\n\n' +
    `[View workflow run](${runUrl})\n`
}

function parseArguments(argv) {
  const options = {}

  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index]
    const value = argv[index + 1]
    if (!value) {
      throw new Error(`Missing value for ${argument}`)
    }

    switch (argument) {
      case '--head-sha':
        options.headSha = value
        break
      case '--input':
        options.input = value
        break
      case '--output':
        options.output = value
        break
      case '--run-url':
        options.runUrl = value
        break
      default:
        throw new Error(`Unknown argument ${argument}`)
    }
  }

  if (!options.headSha || !options.input || !options.output || !options.runUrl) {
    throw new Error('Usage: performanceComment.mjs --input <path> --output <path> --head-sha <sha> --run-url <url>')
  }

  return options
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  let comment

  try {
    const result = JSON.parse(await readFile(options.input, 'utf8'))
    comment = renderPerformanceComment(result, options)
  } catch (error) {
    console.error(error)
    comment = renderUnavailablePerformanceComment(options.runUrl)
  }

  await writeFile(options.output, comment)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
