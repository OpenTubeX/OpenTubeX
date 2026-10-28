// Projects that share CI shards. Scaled runs repeat tagged layout checks.
const SHARD_GROUPS = {
  offline: ['offline', 'offline-95', 'offline-125'],
  performance: ['performance'],
  browser: ['browser'],
  network: ['network']
}

// PRs rerun changed offline tests to catch flaky tests before they merge.
// A change to a shared helper selects most of the suite; skip those PRs.
export const REPEAT_EACH = 5
export const REPEAT_LIMIT = 100

/**
 * Plan shards from the tests that will actually run in each group. Only the
 * network group, which talks to YouTube, uses the changed-test report on PRs.
 * With `repeatChanged`, a `repeat` group reruns changed offline tests.
 */
export function createShardMatrix(fullReport, changedReport = fullReport, selectedProject = 'all', repeatChanged = false) {
  const fullCounts = countTests(fullReport)
  const changedCounts = countTests(changedReport)
  const groups = selectedProject === 'all'
    ? ['offline', 'performance', 'browser', 'network']
    : selectedProject === 'offline'
      ? ['offline', 'performance', 'browser']
      : [selectedProject]

  const include = groups.flatMap(group => {
    const projects = SHARD_GROUPS[group]
    for (const project of projects) {
      if (!fullCounts[project]) throw new Error(`No tests found for project ${project}`)
    }
    const counts = group === 'network' ? changedCounts : fullCounts
    const count = projects.reduce((total, project) => total + (counts[project] ?? 0), 0)
    const entry = { project: group, projects: projects.join(' ') }
    // The browser job also runs mobile storage checks outside Playwright.
    if (group === 'browser') return [{ ...entry, shard: 1, shardTotal: 1 }]
    // CPU throttling and repeated lifecycle checks take longer than ordinary
    // interactions. Keep these shards smaller without sharing an X server.
    const testsPerShard = group === 'performance' ? 50 : 100
    const shardTotal = Math.min(16, Math.ceil(count / testsPerShard))
    return Array.from({ length: shardTotal }, (_, index) => ({ ...entry, shard: index + 1, shardTotal }))
  })
  const repeatCount = countRepeatTests(changedReport)
  if (repeatChanged && repeatCount > 0 && repeatCount <= REPEAT_LIMIT) {
    const shardTotal = Math.ceil(repeatCount * REPEAT_EACH / 100)
    const entry = { project: 'repeat', projects: SHARD_GROUPS.offline.join(' '), repeatEach: REPEAT_EACH }
    include.push(...Array.from({ length: shardTotal }, (_, index) => ({ ...entry, shard: index + 1, shardTotal })))
  }
  return { include }
}

/** Count the offline tests in a report, including their scaled runs. */
export function countRepeatTests(report) {
  const counts = countTests(report)
  return SHARD_GROUPS.offline.reduce((total, project) => total + (counts[project] ?? 0), 0)
}

function countTests(report) {
  const counts = {}
  const visit = suite => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        counts[test.projectName] = (counts[test.projectName] ?? 0) + 1
      }
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  visit(report)
  return counts
}
