import assert from 'node:assert/strict'
import test from 'node:test'

import {
  performanceCommentMarker,
  renderPerformanceComment,
  renderUnavailablePerformanceComment
} from '../../_scripts/performanceComment.mjs'

const headSha = 'abcdef1234567890abcdef1234567890abcdef12'
const runUrl = 'https://github.com/OpenTubeX/OpenTubeX/actions/runs/123'

function sample (overrides = {}) {
  return {
    firstSwitchElapsedMs: 100,
    firstSwitchLongestFrameMs: 50,
    repeatedSwitchElapsedMs: 80,
    repeatedSwitchLongestFrameMs: 40,
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
  assert.match(comment, /First switch elapsed \| 100\.0 ms \| 100\.0 ms \| 0\.0%/)
  assert.match(comment, /No regression crossed the configured thresholds\./)
  assert.match(comment, /\[View workflow run\]\(https:\/\/github\.com\/OpenTubeX\/OpenTubeX\/actions\/runs\/123\)/)
  assert.doesNotMatch(comment, /@maintainers/)
})

test('recomputes regressions instead of trusting artifact conclusions', () => {
  const input = result({ repeatedSwitchElapsedMs: 180 })
  input.metrics = []
  input.failures = []

  const comment = renderPerformanceComment(input, { headSha, runUrl })

  assert.match(comment, /Repeated switch elapsed .+ Regression/)
  assert.match(comment, /Repeated switch elapsed is 180\.0 ms, above the 150 ms limit/)
  assert.match(comment, /Repeated switch elapsed regressed by 100\.0 ms \(\+125\.0%\)/)
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
