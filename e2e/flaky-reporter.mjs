import { writeFileSync } from 'node:fs'
import { relative } from 'node:path'

/**
 * Lists tests that failed and then passed on retry. CI sets E2E_FLAKY_REPORT
 * to collect them for the flaky-test issue and annotates each one.
 */
export default class FlakyReporter {
  onBegin(config, suite) {
    this.suite = suite
  }

  onEnd() {
    const output = process.env.E2E_FLAKY_REPORT
    if (!output) return
    const flaky = this.suite.allTests().filter(test => test.outcome() === 'flaky').map(test => ({
      project: test.parent.project().name,
      // titlePath: root, project, file, then describe blocks and the title.
      title: test.titlePath().slice(3).join(' › '),
      // CI runs from the repository root, which annotations resolve against.
      file: relative(process.cwd(), test.location.file),
      line: test.location.line
    }))
    if (flaky.length === 0) return
    writeFileSync(output, JSON.stringify(flaky))
    if (process.env.GITHUB_ACTIONS) {
      for (const { project, title, file, line } of flaky) {
        console.log(`::warning file=${file},line=${line},title=Flaky test::[${project}] ${title} passed only on retry`)
      }
    }
  }

  printsToStdio() {
    return false
  }
}
