/** Plan shards from the tests that will actually run in each project. */
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
  const projects = selectedProject === 'all'
    ? ['offline', 'performance', 'browser', 'network']
    : selectedProject === 'offline'
      ? ['offline', 'performance', 'browser']
      : [selectedProject]

  const include = projects.flatMap(project => {
    if (!fullCounts[project]) throw new Error(`No tests found for project ${project}`)
    const count = project === 'performance' ? fullCounts[project] : (changedCounts[project] ?? 0)
    // The browser job also runs mobile storage checks outside Playwright.
    if (project === 'browser') return [{ project, shard: 1, shardTotal: 1 }]
    // CPU throttling and repeated lifecycle checks take longer than ordinary
    // interactions. Keep these shards smaller without sharing an X server.
    const testsPerShard = project === 'performance' ? 50 : 100
    const shardTotal = Math.min(16, Math.ceil(count / testsPerShard))
    return Array.from({ length: shardTotal }, (_, index) => ({ project, shard: index + 1, shardTotal }))
  })
  return { include }
}
