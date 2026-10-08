import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { load as loadYaml } from 'js-yaml'

import { parseArguments } from '../../e2e/performance/compare.mjs'
import { measureVideosSwitch } from '../../e2e/performance/subscriptions.mjs'
import { packedCodeSizeKiB } from '../../e2e/performance/scenarios.mjs'

const roots = ['--base', '.', '--candidate', '.']

test('performance enforcement needs enough samples while smoke runs remain available', () => {
  assert.equal(parseArguments(roots).samples, 7)
  assert.throws(() => parseArguments([...roots, '--samples', '6']), /at least 7 samples/)
  assert.equal(parseArguments([...roots, '--samples', '1', '--report-only']).samples, 1)
})

test('performance arguments reject malformed and fractional counts', () => {
  for (const option of ['--samples', '--warmups']) {
    for (const value of ['7junk', '7.5', '0', '-1', 'Infinity']) {
      assert.throws(() => parseArguments([...roots, option, value]), /positive integer/)
    }
  }
})

test('subscription timing includes the frame that finishes rendering', async () => {
  let frame = 0
  const metrics = await measureVideosSwitch({
    evaluate: action => vm.runInNewContext(`(${action.toString()})()`, {
      performance: { now: () => 0 },
      document: {
        querySelector: selector => selector.includes('data-subscription-feed-tab')
          ? { click () {}, getAttribute: () => 'true' }
          : { querySelector: () => ({}) }
      },
      requestAnimationFrame: callback => {
        const timestamp = ++frame === 1 ? 100 : 400
        callback(timestamp)
      }
    })
  })
  assert.equal(metrics.elapsed, 400)
  assert.equal(metrics.longestFrame, 300)
})

test('packed code size includes chunks in subdirectories and excludes maps and media', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opentubex-code-size-'))
  try {
    await mkdir(path.join(root, 'dist-e2e', 'chunks'), { recursive: true })
    await writeFile(path.join(root, 'dist-e2e', 'main.js'), Buffer.alloc(1024))
    await writeFile(path.join(root, 'dist-e2e', 'chunks', 'worker.js'), Buffer.alloc(2048))
    await writeFile(path.join(root, 'dist-e2e', 'chunks', 'renderer.css'), Buffer.alloc(512))
    await writeFile(path.join(root, 'dist-e2e', 'main.js.map'), Buffer.alloc(8192))
    await writeFile(path.join(root, 'dist-e2e', 'demo.mp4'), Buffer.alloc(8192))
    assert.equal(await packedCodeSizeKiB(root), 3.5)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('PR shard commands always run packed-app performance coverage', async () => {
  const workflow = loadYaml(await readFile('.github/workflows/e2e.yml', 'utf8'))
  const run = workflow.jobs['e2e-shard'].steps.find(step => step.name === 'Run E2E tests').run
  for (const project of ['offline', 'performance', 'browser', 'network']) {
    /* eslint-disable no-template-curly-in-string -- GitHub Actions placeholders are literal fixture data. */
    const script = run
      .replaceAll('${{ matrix.shard }}', '1')
      .replaceAll('${{ matrix.shardTotal }}', '2')
      .replaceAll('${{ matrix.project }}', project)
      .replaceAll('${{ github.event_name }}', 'pull_request')
    /* eslint-enable no-template-curly-in-string */
    const args = execFileSync('bash', ['-c', `function xvfb-run() { printf '%s\\n' "$@"; }\n${script}`], {
      encoding: 'utf8', env: { ...process.env, GITHUB_BASE_REF: 'development' }
    }).trim().split('\n')
    assert.ok(args.includes(`--project=${project}`))
    assert.ok(args.includes('--shard=1/2'))
    assert.equal(args.includes('--only-changed=origin/development'), project !== 'performance')
    assert.equal(args.includes('--pass-with-no-tests'), project !== 'performance')
  }
})
