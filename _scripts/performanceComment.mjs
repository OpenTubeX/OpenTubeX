import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import {
  comparePerformanceSamples,
  minimumPerformanceSamples,
  renderPerformanceSummary,
  validatePerformanceSamples
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
  }
  validatePerformanceSamples(samples)
}

function validateResult(result, headSha, candidateCommit) {
  if (!result || typeof result !== 'object') {
    throw new Error('Performance result is invalid')
  }

  const baseCommit = result.base?.commit
  const candidateLabel = result.candidate?.commit
  assertCommit(baseCommit, 'Base')
  assertCommit(candidateLabel, 'Candidate')
  assertCommit(headSha, 'Workflow head')
  assertCommit(candidateCommit?.sha, 'GitHub candidate')

  if (!candidateCommit.sha.startsWith(candidateLabel)) {
    throw new Error('Performance result does not match the workflow candidate')
  }
  const parents = candidateCommit.parents
  if (parents?.length !== 2 || parents[1]?.sha !== headSha ||
    typeof parents[0]?.sha !== 'string' || !parents[0].sha.startsWith(baseCommit)) {
    throw new Error('Performance candidate does not merge the reported base and workflow head')
  }
  if (!Number.isSafeInteger(result.sampleCount) || result.sampleCount < minimumPerformanceSamples) {
    throw new Error('Performance sample count is invalid')
  }
  if (result.reportOnly !== false) {
    throw new Error('Performance result did not enforce regressions')
  }

  validateSamples(result.samples, result.sampleCount)

  return {
    base: { commit: baseCommit },
    candidate: { commit: candidateLabel },
    samples: result.samples
  }
}

export function renderPerformanceComment(result, { headSha, candidateCommit, runUrl }) {
  const validated = validateResult(result, headSha, candidateCommit)
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
      case '--candidate-sha':
        options.candidateSha = value
        break
      case '--repository':
        options.repository = value
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

  options.repository ??= process.env.GITHUB_REPOSITORY
  if ((!options.headSha && !options.candidateSha) || !options.repository || !options.input || !options.output || !options.runUrl) {
    throw new Error('Usage: performanceComment.mjs --input <path> --output <path> --head-sha <sha> --repository <owner/repo> --run-url <url>')
  }

  return options
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  let comment

  try {
    const result = JSON.parse(await readFile(options.input, 'utf8'))
    // Existing reporter runs retain the published --candidate-sha invocation
    // when rerun, even though they check out the current reporter script.
    if (!options.headSha) {
      assertCommit(options.candidateSha, 'Workflow candidate')
      const workflowCandidate = JSON.parse(execFileSync('gh', [
        'api', `repos/${options.repository}/commits/${options.candidateSha}`
      ], { encoding: 'utf8' }))
      options.headSha = workflowCandidate.parents?.[1]?.sha
    }
    assertCommit(result.candidate?.commit, 'Candidate')
    const candidateCommit = JSON.parse(execFileSync('gh', [
      'api', `repos/${options.repository}/commits/${result.candidate.commit}`
    ], { encoding: 'utf8' }))
    comment = renderPerformanceComment(result, { ...options, candidateCommit })
  } catch (error) {
    console.error(error)
    comment = renderUnavailablePerformanceComment(options.runUrl)
  }

  await writeFile(options.output, comment)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
