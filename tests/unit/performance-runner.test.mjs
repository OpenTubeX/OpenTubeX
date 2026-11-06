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
  let timestamp = 0
  const metrics = await measureVideosSwitch({
    evaluate: action => vm.runInNewContext(`(${action.toString()})()`, {
      performance: { now: () => timestamp },
      document: {
        querySelector: selector => selector.includes('data-subscription-feed-tab')
          ? { click () {}, getAttribute: () => 'true' }
          : { querySelector: () => ({}) }
      },
      requestAnimationFrame: callback => {
        timestamp = ++frame === 1 ? 100 : 400
        callback(timestamp)
      }
    })
  })
  assert.equal(metrics.elapsed, 400)
  assert.equal(metrics.longestFrame, 300)
})

test('subscription timing stays valid when frame timestamps precede the measurement start', async () => {
  const readings = [100, 110, 120]
  const frameTimestamps = [90, 95]
  const metrics = await measureVideosSwitch({
    evaluate: action => vm.runInNewContext(`(${action.toString()})()`, {
      performance: { now: () => readings.shift() },
      document: {
        querySelector: selector => selector.includes('data-subscription-feed-tab')
          ? { click () {}, getAttribute: () => 'true' }
          : { querySelector: () => ({}) }
      },
      requestAnimationFrame: callback => callback(frameTimestamps.shift())
    })
  })
  assert.equal(metrics.elapsed, 20)
  assert.equal(metrics.longestFrame, 10)
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

test('PR shard commands run packed-app projects in full and only changed network tests', async () => {
  const workflow = loadYaml(await readFile('.github/workflows/e2e.yml', 'utf8'))
  const step = workflow.jobs['e2e-shard'].steps.find(step => step.name === 'Run E2E tests')
  for (const [project, projects] of [
    ['offline', 'offline offline-95 offline-125'],
    ['performance', 'performance'],
    ['browser', 'browser'],
    ['network', 'network']
  ]) {
    /* eslint-disable no-template-curly-in-string -- GitHub Actions placeholders are literal fixture data. */
    const script = step.run
      .replaceAll('${{ matrix.shard }}', '1')
      .replaceAll('${{ matrix.shardTotal }}', '2')
      .replaceAll('${{ matrix.project }}', project)
      .replaceAll('${{ github.event_name }}', 'pull_request')
    /* eslint-enable no-template-curly-in-string */
    assert.equal(step.env.PROJECTS, '${{ matrix.projects }}') // eslint-disable-line no-template-curly-in-string
    const runnerTemp = await mkdtemp(path.join(tmpdir(), 'opentubex-shard-'))
    try {
      // The listing prints a report with each project's four tests in one file.
      const report = {
        suites: [{
          title: 'offline/a.spec.mjs',
          specs: [1, 2, 3, 4].map(n => ({
            file: 'offline/a.spec.mjs',
            title: `test ${n}`,
            tests: projects.split(' ').map(projectName => ({ projectName }))
          }))
        }]
      }
      await writeFile(path.join(runnerTemp, 'report.json'), JSON.stringify(report))
      const stubs = [
        'function xvfb-run() { printf \'%s\\n\' "$@"; }',
        'function pnpm() { printf \'%s\\n\' "$@" > "$RUNNER_TEMP/list-args"; cat "$RUNNER_TEMP/report.json"; }'
      ].join('\n')
      const args = execFileSync('bash', ['-c', `${stubs}\n${script}`], {
        encoding: 'utf8', env: { ...process.env, PROJECTS: projects, RUNNER_TEMP: runnerTemp }
      }).trim().split('\n')
      const listArgs = (await readFile(path.join(runnerTemp, 'list-args'), 'utf8')).trim().split('\n')
      for (const name of projects.split(' ')) {
        assert.ok(listArgs.includes(`--project=${name}`))
        assert.ok(args.includes(`--project=${name}`))
      }
      assert.equal(listArgs.includes('--only-changed=HEAD^1'), project === 'network')
      assert.equal(args.includes('--pass-with-no-tests'), project === 'network')

      // Shard 1 of 2 runs every other listed test instead of a --shard block.
      const testListArg = args.find(arg => arg.startsWith('--test-list='))
      assert.ok(testListArg)
      const testList = testListArg.slice('--test-list='.length)
      assert.ok(!args.some(arg => arg.startsWith('--shard') || arg.startsWith('--only-changed')))
      const all = [1, 2, 3, 4].flatMap(n => projects.split(' ').map(name => `[${name}] › offline/a.spec.mjs › test ${n}`))
      assert.deepEqual((await readFile(testList, 'utf8')).trim().split('\n'), all.filter((_, index) => index % 2 === 0))
    } finally {
      await rm(runnerTemp, { recursive: true, force: true })
    }
  }
})
