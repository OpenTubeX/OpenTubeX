// Projects that share CI shards. Scaled runs repeat tagged layout checks.
const SHARD_GROUPS = {
  offline: ['offline', 'offline-95', 'offline-125'],
  performance: ['performance'],
  browser: ['browser'],
  network: ['network']
}

/**
 * Plan shards from the tests that will actually run in each group. Only the
 * network group, which talks to YouTube, uses the changed-test report on PRs.
 */
export function createShardMatrix(fullReport, changedReport = fullReport, selectedProject = 'all') {
  const countTests = report => {
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
  return { include }
}
