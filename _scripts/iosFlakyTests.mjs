import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Reads the output of `xcrun xcresulttool get test-results tests` for a run
 * with `-retry-tests-on-failure`, and writes the tests that failed and then
 * passed on the retry to IOS_FLAKY_REPORT for the flaky-test issue.
 *
 * Usage: node _scripts/iosFlakyTests.mjs <test results JSON> <device family>
 */

const SOURCES = 'ios/App/AppTests'

function * testCases(nodes = []) {
  for (const node of nodes) {
    if (node.nodeType === 'Test Case') yield node
    else yield * testCases(node.children)
  }
}

/** Finds the test method's source file and line for the issue and annotations. */
function location(name) {
  const method = name.replace(/\(.*$/, '')
  for (const entry of readdirSync(SOURCES).filter(entry => entry.endsWith('.swift')).sort()) {
    const file = join(SOURCES, entry)
    const index = readFileSync(file, 'utf8').split('\n').findIndex(line => new RegExp(`\\bfunc\\s+${method}\\s*\\(`).test(line))
    if (index >= 0) return { file, line: index + 1 }
  }
  return { file: join(SOURCES, 'AppTests.swift'), line: 1 }
}

const [resultsFile, project] = process.argv.slice(2)
const results = JSON.parse(readFileSync(resultsFile, 'utf8'))
const flaky = [...testCases(results.testNodes)]
  .filter(test => {
    const runs = (test.children ?? []).filter(child => child.nodeType === 'Repetition').map(run => run.result)
    return runs.includes('Failed') && runs.at(-1) === 'Passed'
  })
  .map(test => ({ project, title: test.nodeIdentifier?.replace(/\(\)$/, '').replaceAll('/', ' › ') ?? test.name, ...location(test.name) }))

if (flaky.length > 0) {
  if (process.env.IOS_FLAKY_REPORT) writeFileSync(process.env.IOS_FLAKY_REPORT, JSON.stringify(flaky))
  for (const { title, file, line } of flaky) {
    console.log(`::warning file=${file},line=${line},title=Flaky test::${title} passed only on retry on ${project}`)
  }
}
