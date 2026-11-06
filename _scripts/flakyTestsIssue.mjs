import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ENTRY_PATTERN = /<!-- flaky-test (\{.*\}) -->\s*$/
const MAX_BRANCHES = 5

// Test titles and branch names come from PR runs; keep them inert in Markdown.
function code(text) {
  return `\`${String(text).replaceAll('`', "'").replaceAll('\n', ' ')}\``
}

function parseEntries(body) {
  const entries = new Map()
  for (const line of body.split('\n')) {
    const match = ENTRY_PATTERN.exec(line)
    if (!match) continue
    try {
      const entry = JSON.parse(match[1])
      entries.set(`${entry.file}\0${entry.title}`, entry)
    } catch {
      // A hand-edited entry that no longer parses is dropped.
    }
  }
  return entries
}

/**
 * Merge one run's flaky tests into the issue body. Each list item carries its
 * own data, so deleting the line after fixing a test also resets its count.
 */
export function updateFlakyTestsBody(body, flakyTests, { runUrl, branch, date }) {
  const entries = parseEntries(body)
  for (const { project, title, file, line } of flakyTests) {
    const key = `${file}\0${title}`
    const entry = entries.get(key) ?? { file, title, line, projects: [], count: 0, branches: [] }
    entry.line = line
    entry.count++
    entry.projects = [...new Set([...entry.projects, project])].sort()
    entry.branches = [...new Set([branch, ...entry.branches])].slice(0, MAX_BRANCHES)
    entry.lastSeen = date
    entry.lastRun = runUrl
    entries.set(key, entry)
  }

  const items = [...entries.values()]
    .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen) || a.file.localeCompare(b.file))
    .map(entry => {
      // Escapes keep "|" and "-->" from ending the comment or a Markdown table.
      const data = JSON.stringify(entry).replaceAll('>', '\\u003e').replaceAll('|', '\\u007c')
      return `- **${entry.count}×** ${code(`${entry.file}:${entry.line}`)} ${code(entry.title)} ` +
        `(${entry.projects.map(code).join(', ')}), last on ${entry.lastSeen} in [this run](${entry.lastRun}) ` +
        `on ${entry.branches.map(code).join(', ')} <!-- flaky-test ${data} -->`
    })

  return [
    'E2E tests that failed and then passed on retry in CI, most frequent first. The Flaky E2E Tests workflow updates this list after every E2E run.',
    '',
    'Fix these in batches. After fixing a test, delete its line; it comes back if the test flakes again.',
    '',
    ...(items.length > 0 ? items : ['No flaky tests recorded.']),
    ''
  ].join('\n')
}

/** Read the flaky-test reports downloaded from every shard artifact. */
export function readFlakyTests(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { recursive: true })
    .filter(name => String(name).endsWith('e2e-flaky.json'))
    .flatMap(name => {
      const tests = JSON.parse(readFileSync(join(directory, String(name)), 'utf8'))
      if (!Array.isArray(tests)) throw new Error(`${name} is not a list of flaky tests`)
      return tests.filter(test => typeof test?.title === 'string' && typeof test.file === 'string' &&
        typeof test.project === 'string' && Number.isSafeInteger(test.line))
    })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [artifactsDirectory, bodyFile, outputFile] = process.argv.slice(2)
  const flakyTests = readFlakyTests(artifactsDirectory)
  if (flakyTests.length > 0) {
    const body = existsSync(bodyFile) ? readFileSync(bodyFile, 'utf8') : ''
    writeFileSync(outputFile, updateFlakyTestsBody(body, flakyTests, {
      runUrl: process.env.RUN_URL,
      branch: process.env.BRANCH,
      date: new Date().toISOString().slice(0, 10)
    }))
  }
}
