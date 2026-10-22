import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { load as loadYaml } from 'js-yaml'

import {
  performanceCommentMarker,
  renderPerformanceComment,
  renderUnavailablePerformanceComment
} from '../../_scripts/performanceComment.mjs'
import { isValidPerformanceValue } from '../../e2e/performance/report.mjs'

const candidateSha = 'abcdef1234567890abcdef1234567890abcdef12'
const headSha = 'fedcba9876543210fedcba9876543210fedcba98'
const candidateCommit = {
  sha: candidateSha,
  parents: [{ sha: '1234567890abcdef1234567890abcdef12345678' }, { sha: headSha }]
}
const runUrl = 'https://github.com/OpenTubeX/OpenTubeX/actions/runs/123'
const context = { headSha, candidateCommit, runUrl }

test('benchmarks the merged pull request with the fork build and test scripts', async () => {
  const workflow = loadYaml(await readFile(
    '.github/workflows/performance.yml',
    'utf8'
  ))
  const checkout = workflow.jobs.performance.steps.find(
    step => step.name === 'Check out candidate'
  )

  assert.equal(
    checkout.with.ref,
    '${{ github.sha }}'
  )
})

test('performance workflow benchmarks the pinned merge parent when the event base differs', async () => {
  const workflow = loadYaml(await readFile('.github/workflows/performance.yml', 'utf8'))
  const steps = workflow.jobs.performance.steps
  const checkout = steps.find(step => step.name === 'Check out candidate')
  const base = steps.find(step => step.name === 'Check out base')
  const root = await mkdtemp(path.join(tmpdir(), 'opentubex-performance-base-'))
  const repository = path.join(root, 'repository')
  const candidate = path.join(root, 'candidate')
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Performance test', GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Performance test', GIT_COMMITTER_EMAIL: 'test@example.com',
  }
  const git = (cwd, args, input) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-C', cwd, ...args], {
    encoding: 'utf8', env, input, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
  try {
    await mkdir(repository)
    git(repository, ['init', '--quiet'])
    const tree = git(repository, ['mktree'], '')
    const commit = (message, parents = []) => git(repository, ['commit-tree', tree, '-m', message, ...parents.flatMap(parent => ['-p', parent])])
    const eventBase = commit('Event base')
    const actualBase = commit('Updated base', [eventBase])
    const head = commit('PR head', [eventBase])
    const merge = commit('Pinned merge', [actualBase, head])
    await mkdir(candidate)
    git(candidate, ['init', '--quiet'])
    git(candidate, ['fetch', '--depth', String(checkout.with['fetch-depth'] ?? 1), repository, merge])
    git(candidate, ['checkout', '--detach', 'FETCH_HEAD'])
    let ref = base.with.ref.replace('${{ github.event.pull_request.base.sha }}', eventBase)
    for (const step of steps.filter(step => step.id && step.run)) {
      const expression = new RegExp(`\\$\\{\\{ steps\\.${step.id}\\.outputs\\.(\\w+) \\}\\}`)
      const outputKey = ref.match(expression)?.[1]
      if (!outputKey) continue
      const output = path.join(root, 'output')
      execFileSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
        cwd: root, env: { ...env, GITHUB_OUTPUT: output }, stdio: 'pipe',
      })
      const value = (await readFile(output, 'utf8')).split('\n').find(line => line.startsWith(`${outputKey}=`))?.slice(outputKey.length + 1)
      assert.ok(value)
      ref = ref.replace(expression, value)
    }
    assert.equal(ref, actualBase, 'benchmark the first parent of the exact candidate, rather than the event’s stale base')
    const artifact = result()
    artifact.base.commit = ref.slice(0, 9)
    artifact.candidate.commit = merge.slice(0, 9)
    assert.doesNotThrow(() => renderPerformanceComment(artifact, {
      headSha: head, runUrl, candidateCommit: { sha: merge, parents: [{ sha: actualBase }, { sha: head }] },
    }))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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
    largeFeedScrollElapsedMs: 1000,
    largeFeedScrollTaskMs: 30,
    hoveredWatchNavigationElapsedMs: 300,
    navigationHeapGrowthMiB: 6.5,
    playbackStartElapsedMs: 1000,
    playbackStartLongestFrameMs: 50,
    playbackHeapGrowthMiB: 0,
    packedCodeSizeKiB: 4000,
    ...overrides
  }
}

function result (candidateOverrides = {}) {
  return {
    base: { commit: '123456789' },
    candidate: { commit: candidateSha.slice(0, 9) },
    sampleCount: 7,
    warmupCount: 2,
    reportOnly: false,
    samples: {
      base: Array.from({ length: 7 }, () => sample()),
      candidate: Array.from({ length: 7 }, () => sample(candidateOverrides))
    }
  }
}

test('comment workflow accepts an earlier merge after GitHub regenerates its merge SHA', async () => {
  const workflow = loadYaml(await readFile('.github/workflows/performance-comment.yml', 'utf8'))
  const render = workflow.jobs.comment.steps.find(step => step.name === 'Render performance comment')
  const root = await mkdtemp(path.join(tmpdir(), 'opentubex-performance-comment-'))
  try {
    const input = path.join(root, 'results.json')
    const output = path.join(root, 'comment.md')
    await writeFile(input, JSON.stringify(result()))
    await writeFile(path.join(root, 'gh'), `#!/bin/sh
case "$2" in
  repos/OpenTubeX/OpenTubeX/commits/abcdef123) printf '%s\\n' "$GITHUB_CANDIDATE_COMMIT" ;;
  repos/OpenTubeX/OpenTubeX/commits/1111111111111111111111111111111111111111) printf '%s\\n' "$GITHUB_WORKFLOW_CANDIDATE_COMMIT" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 })
    const script = render.run
      .replace('performance-results/performance-results.json', input)
      .replace('performance-comment.md', output)
    const run = commit => execFileSync('bash', ['-c', script], {
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH}`,
        GITHUB_CANDIDATE_COMMIT: JSON.stringify(commit),
        RUN_SHA: headSha,
        RUN_URL: runUrl,
        REPOSITORY: 'OpenTubeX/OpenTubeX',
        PR_NUMBER: '2052'
      }
    })

    run(candidateCommit)
    assert.match(await readFile(output, 'utf8'), /No regression crossed the configured thresholds/)

    run({ ...candidateCommit, parents: [candidateCommit.parents[0], { sha: candidateSha }] })
    assert.equal(await readFile(output, 'utf8'), renderUnavailablePerformanceComment(runUrl))

    // Replay the already-published workflow, whose merge SHA has changed.
    execFileSync('node', ['_scripts/performanceComment.mjs',
      '--input', input, '--output', output,
      '--candidate-sha', '1111111111111111111111111111111111111111', '--run-url', runUrl
    ], {
      stdio: 'pipe',
      env: {
        ...process.env,
        PATH: `${root}${path.delimiter}${process.env.PATH}`,
        GITHUB_REPOSITORY: 'OpenTubeX/OpenTubeX',
        GITHUB_CANDIDATE_COMMIT: JSON.stringify(candidateCommit),
        GITHUB_WORKFLOW_CANDIDATE_COMMIT: JSON.stringify({ ...candidateCommit, sha: '1111111111111111111111111111111111111111' })
      }
    })
    assert.match(await readFile(output, 'utf8'), /No regression crossed the configured thresholds/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('merge provenance rejects a different base, head or non-merge commit', () => {
  for (const parents of [
    [{ sha: headSha }, { sha: headSha }],
    [{ sha: candidateCommit.parents[0].sha }, { sha: candidateSha }],
    [candidateCommit.parents[0]]
  ]) {
    assert.throws(
      () => renderPerformanceComment(result(), { ...context, candidateCommit: { ...candidateCommit, parents } }),
      /does not merge the reported base and workflow head/
    )
  }
})

test('renders a fixed sticky comment from raw samples', () => {
  const input = result()
  input.metrics = [{ label: '@maintainers injected result' }]
  input.failures = ['@maintainers injected failure']

  const comment = renderPerformanceComment(input, context)

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

  const comment = renderPerformanceComment(input, context)

  assert.match(comment, /Repeated subscription switch elapsed .+ Regression/)
  assert.match(comment, /Repeated subscription switch elapsed is 180\.0 ms, at or above the 150\.0 ms limit/)
  assert.match(comment, /Repeated subscription switch elapsed regressed by 100\.0 ms \(\+125\.0%\)/)
})

test('does not fail an absolute limit when the candidate improves on an over-limit base', () => {
  const input = result({ firstSwitchElapsedMs: 252.5 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    firstSwitchElapsedMs: 258
  }))

  const comment = renderPerformanceComment(input, context)

  assert.match(comment, /First subscription switch elapsed .+ -2\.1% .+ Pass/)
  assert.match(comment, /First subscription switch elapsed .+ Pass \(above budget\)/)
  assert.doesNotMatch(comment, /First subscription switch elapsed is .+ at or above/)
})

test('fails when the candidate crosses an absolute limit from below', () => {
  const input = result({ firstSwitchElapsedMs: 250 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    firstSwitchElapsedMs: 240
  }))

  const comment = renderPerformanceComment(input, context)

  assert.match(comment, /First subscription switch elapsed .+ \+4\.2% .+ Regression/)
  assert.match(comment, /First subscription switch elapsed is 250\.0 ms, at or above/)
  assert.doesNotMatch(comment, /First subscription switch elapsed regressed by/)
})

test('ignores a one-frame shift in longest-frame samples', () => {
  const input = result({ subscribedChannelsNavigationLongestFrameMs: 83.3 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    subscribedChannelsNavigationLongestFrameMs: 66.7
  }))

  const comment = renderPerformanceComment(input, context)

  assert.match(comment, /Large route navigation longest frame .+ \+24\.9% .+ Pass/)
  assert.doesNotMatch(comment, /Large route navigation longest frame regressed/)
})

test('ignores a one-frame shift that reaches a longest-frame limit', () => {
  const input = result({ firstSwitchLongestFrameMs: 200 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    firstSwitchLongestFrameMs: 183.3
  }))

  const comment = renderPerformanceComment(input, context)

  assert.match(comment, /First subscription switch longest frame .+ \+9\.1% .+ Pass/)
  assert.doesNotMatch(comment, /First subscription switch longest frame is .+ at or above/)
})

test('reports a two-frame shift in longest-frame samples', () => {
  const input = result({ subscribedChannelsNavigationLongestFrameMs: 100 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    subscribedChannelsNavigationLongestFrameMs: 66.7
  }))

  const comment = renderPerformanceComment(input, context)

  assert.match(comment, /Large route navigation longest frame .+ Regression/)
  assert.match(comment, /Large route navigation longest frame regressed by 33\.3 ms/)
})

test('reports diagnostic startup phases without gating on them', () => {
  const comment = renderPerformanceComment(
    result({ startupElectronConnectedMs: 10000 }),
    context
  )

  assert.match(comment, /Startup: Electron connected .+ Diagnostic \| Reported/)
  assert.match(comment, /No regression crossed the configured thresholds\./)
})

test('ignores startup frame scheduling noise below 100 ms', () => {
  const input = result({ startupLongestFrameMs: 300 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    startupLongestFrameMs: 249.9
  }))

  const comment = renderPerformanceComment(input, context)

  assert.match(comment, /Startup: renderer longest frame .+ \+20\.0% .+ Pass/)
  assert.doesNotMatch(comment, /Startup: renderer longest frame regressed/)
})

test('reports startup frame regressions above the scheduling noise floor', () => {
  const input = result({ startupLongestFrameMs: 400 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    startupLongestFrameMs: 249.9
  }))

  const comment = renderPerformanceComment(input, context)

  assert.match(comment, /Startup: renderer longest frame .+ Regression/)
  assert.match(comment, /Startup: renderer longest frame regressed by 150\.1 ms/)
})

test('gates renderer heap growth after repeated navigation', () => {
  const input = result({ navigationHeapGrowthMiB: 12 })
  input.samples.base = Array.from({ length: 7 }, () => sample({
    navigationHeapGrowthMiB: 6.5
  }))

  const comment = renderPerformanceComment(input, context)

  assert.match(comment, /Renderer heap growth after 10 navigation cycles .+ \+5\.5 MiB .+ Regression/)
  assert.match(comment, /Renderer heap growth after 10 navigation cycles regressed by 5\.5 MiB/)
})

test('accepts zero heap growth and renders its absolute change', () => {
  const input = result({ navigationHeapGrowthMiB: 0 })
  input.samples.base = Array.from({ length: 7 }, () => sample({ navigationHeapGrowthMiB: 0 }))

  const comment = renderPerformanceComment(input, context)

  assert.match(comment, /Renderer heap growth after 10 navigation cycles \| 0\.0 MiB \| 0\.0 MiB \| 0\.0 MiB/)
})

test('accepts zero when a metric omits its minimum value', () => {
  assert.equal(isValidPerformanceValue({}, 0), true)
  assert.equal(isValidPerformanceValue({}, -1), false)
})

test('rejects stale, report-only, and malformed artifacts', () => {
  assert.throws(
    () => renderPerformanceComment(result(), { ...context, candidateCommit: { ...candidateCommit, sha: headSha } }),
    /does not match the workflow candidate/
  )

  const reportOnly = result()
  reportOnly.reportOnly = true
  assert.throws(
    () => renderPerformanceComment(reportOnly, context),
    /did not enforce regressions/
  )

  const malformed = result()
  malformed.samples.candidate[0].firstSwitchElapsedMs = '@maintainers'
  assert.throws(
    () => renderPerformanceComment(malformed, context),
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

test('rejects reports that enforce thresholds with too few samples', () => {
  const input = result()
  input.sampleCount = 1
  input.samples.base.length = 1
  input.samples.candidate.length = 1
  assert.throws(() => renderPerformanceComment(input, context), /sample count is invalid/)
})
