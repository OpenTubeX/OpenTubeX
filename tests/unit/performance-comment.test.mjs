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
    navigationHeapGrowthMiB: 6.5,
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

test('does not fail an absolute limit when the candidate improves on an over-limit base', () => {
  const input = result({ firstSwitchElapsedMs: 252.5 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    firstSwitchElapsedMs: 258
  }))

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.match(comment, /First subscription switch elapsed .+ -2\.1% .+ Pass/)
  assert.doesNotMatch(comment, /First subscription switch elapsed is .+ at or above/)
})

test('fails when the candidate crosses an absolute limit from below', () => {
  const input = result({ firstSwitchElapsedMs: 250 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    firstSwitchElapsedMs: 240
  }))

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.match(comment, /First subscription switch elapsed .+ \+4\.2% .+ Regression/)
  assert.match(comment, /First subscription switch elapsed is 250\.0 ms, at or above/)
  assert.doesNotMatch(comment, /First subscription switch elapsed regressed by/)
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

test('ignores a one-frame shift that reaches a longest-frame limit', () => {
  const input = result({ firstSwitchLongestFrameMs: 200 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    firstSwitchLongestFrameMs: 183.3
  }))

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.match(comment, /First subscription switch longest frame .+ \+9\.1% .+ Pass/)
  assert.doesNotMatch(comment, /First subscription switch longest frame is .+ at or above/)
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

test('ignores startup frame scheduling noise below 100 ms', () => {
  const input = result({ startupLongestFrameMs: 300 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    startupLongestFrameMs: 249.9
  }))

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.match(comment, /Startup: renderer longest frame .+ \+20\.0% .+ Pass/)
  assert.doesNotMatch(comment, /Startup: renderer longest frame regressed/)
})

test('reports startup frame regressions above the scheduling noise floor', () => {
  const input = result({ startupLongestFrameMs: 400 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    startupLongestFrameMs: 249.9
  }))

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.match(comment, /Startup: renderer longest frame .+ Regression/)
  assert.match(comment, /Startup: renderer longest frame regressed by 150\.1 ms/)
})

test('gates renderer heap growth after repeated navigation', () => {
  const input = result({ navigationHeapGrowthMiB: 12 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    navigationHeapGrowthMiB: 6.5
  }))

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.match(comment, /Renderer heap growth after 10 navigation cycles .+ \+5\.5 MiB .+ Regression/)
  assert.match(comment, /Renderer heap growth after 10 navigation cycles regressed by 5\.5 MiB/)
})

test('accepts zero heap growth and renders its absolute change', () => {
  const input = result({ navigationHeapGrowthMiB: 0 })
  input.samples.base = Array.from({ length: 7 }, () => sample({ navigationHeapGrowthMiB: 0 }))

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.match(comment, /Renderer heap growth after 10 navigation cycles \| 0\.0 MiB \| 0\.0 MiB \| 0\.0 MiB/)
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
