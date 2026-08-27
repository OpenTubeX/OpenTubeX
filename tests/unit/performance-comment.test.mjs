import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

import {
  performanceCommentMarker,
  renderPerformanceComment,
  renderUnavailablePerformanceComment
} from '../../_scripts/performanceComment.mjs'
import { isValidPerformanceValue } from '../../e2e/performance/report.mjs'

const headSha = 'abcdef1234567890abcdef1234567890abcdef12'
const runUrl = 'https://github.com/OpenTubeX/OpenTubeX/actions/runs/123'

test('benchmarks the pull request head reported to the comment workflow', async () => {
  const workflow = loadYaml(await readFile(
    '.github/workflows/performance.yml',
    'utf8'
  ))
  const checkout = workflow.jobs.performance.steps.find(
    step => step.name === 'Check out candidate'
  )

  assert.equal(
    checkout.with.ref,
    '${{ github.event.pull_request.head.sha }}'
  )
})

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
    navigationMemoryGrowthMiB: 2,
    playbackStartElapsedMs: 1000,
    playbackStartLongestFrameMs: 50,
    packedCodeSizeKiB: 4000,
    ...overrides
  }
}

function result (candidateOverrides = {}) {
  return {
    base: { commit: '123456789' },
    candidate: { commit: headSha.slice(0, 9) },
    sampleCount: 7,
    warmupCount: 2,
    reportOnly: false,
    samples: {
      base: Array.from({ length: 7 }, () => sample()),
      candidate: Array.from({ length: 7 }, () => sample(candidateOverrides))
    }
  }
}

test('renders a fixed sticky comment from raw samples', () => {
  const input = result()
  input.metrics = [{ label: '@maintainers injected result' }]
  input.failures = ['@maintainers injected failure']

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.ok(comment.startsWith(`${performanceCommentMarker}\n## Performance comparison`))
  assert.match(comment, /First subscription switch elapsed \| 100\.0 ms \| 100\.0 ms \| 0\.0%/)
  assert.match(comment, /No regression crossed the configured thresholds\./)
  assert.match(comment, /\[View workflow run\]\(https:\/\/github\.com\/OpenTubeX\/OpenTubeX\/actions\/runs\/123\)/)
  assert.doesNotMatch(comment, /@maintainers/)
})

test('recomputes regressions instead of trusting artifact conclusions', () => {
  const input = result({ repeatedSwitchElapsedMs: 180 })
  input.metrics = []
  input.failures = []

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.match(comment, /Repeated subscription switch elapsed .+ Regression/)
  assert.match(comment, /Repeated subscription switch elapsed is 180\.0 ms, at or above the 150\.0 ms limit/)
  assert.match(comment, /Repeated subscription switch elapsed regressed by 100\.0 ms \(\+125\.0%\)/)
})

test('ignores a one-frame shift in longest-frame samples', () => {
  const input = result({ subscribedChannelsNavigationLongestFrameMs: 83.3 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    subscribedChannelsNavigationLongestFrameMs: 66.7
  }))

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.match(comment, /Large route navigation longest frame .+ \+24\.9% .+ Pass/)
  assert.doesNotMatch(comment, /Large route navigation longest frame regressed/)
})

test('reports a two-frame shift in longest-frame samples', () => {
  const input = result({ subscribedChannelsNavigationLongestFrameMs: 100 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    subscribedChannelsNavigationLongestFrameMs: 66.7
  }))

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.match(comment, /Large route navigation longest frame .+ Regression/)
  assert.match(comment, /Large route navigation longest frame regressed by 33\.3 ms/)
})

test('reports diagnostic startup phases without gating on them', () => {
  const comment = renderPerformanceComment(
    result({ startupElectronConnectedMs: 10000 }),
    { headSha, runUrl }
  )

  assert.match(comment, /Startup: Electron connected .+ Diagnostic \| Reported/)
  assert.match(comment, /No regression crossed the configured thresholds\./)
})

test('accepts zero memory growth and renders its absolute change', () => {
  const input = result({ navigationMemoryGrowthMiB: 0 })
  input.samples.base = Array.from({ length: 7 }, () => sample({ navigationMemoryGrowthMiB: 0 }))

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.match(comment, /Memory growth after 10 navigation cycles \| 0\.0 MiB \| 0\.0 MiB \| 0\.0 MiB/)
})

test('accepts zero when a metric omits its minimum value', () => {
  assert.equal(isValidPerformanceValue({}, 0), true)
  assert.equal(isValidPerformanceValue({}, -1), false)
})

test('rejects stale, report-only, and malformed artifacts', () => {
  assert.throws(
    () => renderPerformanceComment(result(), { headSha: 'fedcba9876543210fedcba9876543210fedcba98', runUrl }),
    /does not match the workflow head/
  )

  const reportOnly = result()
  reportOnly.reportOnly = true
  assert.throws(
    () => renderPerformanceComment(reportOnly, { headSha, runUrl }),
    /did not enforce regressions/
  )

  const malformed = result()
  malformed.samples.candidate[0].firstSwitchElapsedMs = '@maintainers'
  assert.throws(
    () => renderPerformanceComment(malformed, { headSha, runUrl }),
    /candidate sample firstSwitchElapsedMs is invalid/
  )
})

test('renders a stable fallback when no valid artifact exists', () => {
  assert.equal(
    renderUnavailablePerformanceComment(runUrl),
    `${performanceCommentMarker}\n` +
      '## Performance comparison\n\n' +
      'The benchmark did not produce a valid results artifact.\n\n' +
      `[View workflow run](${runUrl})\n`
  )
})
