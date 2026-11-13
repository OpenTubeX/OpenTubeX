import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ENTRY_PATTERN = /<!-- flaky-test (\{.*\}) -->\s*$/
const MAX_BRANCHES = 5

/** Each kind of test has its own issue and its own report file in the shard artifacts. */
export const KINDS = {
  e2e: { report: 'e2e-flaky.json', description: 'E2E tests', workflow: 'E2E' },
  android: { report: 'android-flaky.json', description: 'Android instrumentation tests', workflow: 'Android Tests' }
}

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
export function updateFlakyTestsBody(body, flakyTests, { runUrl, branch, date, kind = 'e2e' }) {
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
    `${KINDS[kind].description} that failed and then passed on retry in CI, most frequent first. The Flaky Tests workflow updates this list after every ${KINDS[kind].workflow} run.`,
    '',
    'Fix these in batches. After fixing a test, delete its line; it comes back if the test flakes again.',
    '',
    ...(items.length > 0 ? items : ['No flaky tests recorded.']),
    ''
  ].join('\n')
}

/** Read the flaky-test reports downloaded from every shard artifact. */
export function readFlakyTests(directory, kind = 'e2e') {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { recursive: true })
    .filter(name => String(name).endsWith(KINDS[kind].report))
    .flatMap(name => {
      const tests = JSON.parse(readFileSync(join(directory, String(name)), 'utf8'))
      if (!Array.isArray(tests)) throw new Error(`${name} is not a list of flaky tests`)
      return tests.filter(test => typeof test?.title === 'string' && typeof test.file === 'string' &&
        typeof test.project === 'string' && Number.isSafeInteger(test.line))
    })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [kind, artifactsDirectory, bodyFile, outputFile] = process.argv.slice(2)
  if (!Object.hasOwn(KINDS, kind)) throw new Error(`Unknown kind of tests: ${kind}`)
  const flakyTests = readFlakyTests(artifactsDirectory, kind)
  if (flakyTests.length > 0) {
    const body = existsSync(bodyFile) ? readFileSync(bodyFile, 'utf8') : ''
    writeFileSync(outputFile, updateFlakyTestsBody(body, flakyTests, {
      runUrl: process.env.RUN_URL,
      branch: process.env.BRANCH,
      date: new Date().toISOString().slice(0, 10),
      kind
    }))
  }
}
