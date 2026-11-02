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
 * Pick the projects each CI event runs.
 * - Pull requests: browser checks, changed network tests and repeated changed offline tests.
 * - Pushes to development: the offline suite at 100% UI scale and browser checks.
 * - Nightly, release and manual runs: every project, or the selected one.
 */
function selectGroups(event, selectedProject) {
  if (event === 'pull_request') return { browser: SHARD_GROUPS.browser, network: SHARD_GROUPS.network }
  if (event === 'push') return { offline: ['offline'], browser: SHARD_GROUPS.browser }
  const groups = selectedProject === 'all'
    ? ['offline', 'performance', 'browser', 'network']
    : selectedProject === 'offline'
      ? ['offline', 'performance', 'browser']
      : [selectedProject]
  return Object.fromEntries(groups.map(group => [group, SHARD_GROUPS[group]]))
}

/**
 * Plan shards from the tests that will actually run in each group. Only the
 * network group, which talks to YouTube, uses the changed-test report.
 */
export function createShardMatrix(fullReport, changedReport = fullReport, { event = 'schedule', selectedProject = 'all' } = {}) {
  const fullCounts = countTests(fullReport)
  const changedCounts = countTests(changedReport)

  const include = Object.entries(selectGroups(event, selectedProject)).flatMap(([group, projects]) => {
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
  if (event === 'pull_request' && repeatCount > 0 && repeatCount <= REPEAT_LIMIT) {
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
