import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { load } from 'js-yaml'

const source = (await readFile('_scripts/build.mjs', 'utf8')).replace(/^import .*\n/gm, '')
const { scripts } = JSON.parse(await readFile('package.json', 'utf8'))

async function runBuild(platform, hostArch, targetArch) {
  const requests = []
  const castTargets = []
  const shareArchitectures = []
  let interposerPreparations = 0
  const createTarget = (formats, arch) => ({ formats: Array.from(formats), arch })
  const argv = ['node', 'build.mjs']
  if (targetArch !== undefined) argv.push(targetArch)

  await runInNewContext(`(async () => { ${source} })()`, {
    process: { platform, arch: hostArch, argv },
    Arch: { x64: 'x64', arm64: 'arm64' },
    Platform: {
      MAC: { createTarget },
      WINDOWS: { createTarget },
      LINUX: { createTarget }
    },
    config: {},
    prepareCastSender: async (...args) => castTargets.push(args),
    prepareWindowsShare: async arch => shareArchitectures.push(arch),
    prepareWindowsInterposer: async () => { interposerPreparations++ },
    withWindowsPortable: (_config, arch) => ({ portableArch: arch }),
    build: async request => { requests.push(request); return [] },
    console: { log () {} }
  })

  return { requests, castTargets, shareArchitectures, interposerPreparations }
}

for (const platform of ['linux', 'darwin', 'win32']) {
  for (const hostArch of ['x64', 'arm64']) {
    for (const buildScript of ['build', 'build:x64', 'build:arm64']) {
      const expectedArch = buildScript.split(':')[1] ?? hostArch
      test(`${buildScript} on ${platform}/${hostArch} selects ${expectedArch}`, async () => {
        const releaseScript = scripts[buildScript].split(' && ').at(-1).replace(/^pnpm run /, '')
        const targetArch = scripts[releaseScript].split(' ')[2]
        const result = await runBuild(platform, hostArch, targetArch)

        assert.deepEqual(result.castTargets, [['dist', platform, expectedArch]])
        assert.equal(result.requests.length, platform === 'win32' ? 2 : 1)
        assert.ok(result.requests.every(request => request.targets.arch === expectedArch))
        assert.ok(result.requests.every(request => request.publish === 'never'))
        if (platform === 'win32') {
          assert.deepEqual(result.shareArchitectures, [expectedArch])
          assert.equal(result.interposerPreparations, expectedArch === 'x64' ? 1 : 0)
          assert.equal(result.requests[1].config.portableArch, expectedArch)
        }
      })
    }
  }
}

test('unsupported host architectures require an explicit supported target', async () => {
  await assert.rejects(runBuild('linux', 'arm'), /Unsupported build architecture: arm/)
})

test('unsupported explicit targets are rejected', async () => {
  await assert.rejects(runBuild('linux', 'x64', 'armv7l'), /Unsupported build architecture: armv7l/)
})

test('the x64 release job works with the commands available in older releases', async () => {
  const workflow = load(await readFile('.github/workflows/release.yml', 'utf8'))
  const step = workflow.jobs.build.steps.find(step => step.name?.startsWith('Build x64'))
  const result = spawnSync('bash', ['-euc', `
    pnpm() {
      [[ $1 == run ]] || return 1
      case $2 in
        pack) ;;
        build-release) [[ $3 == x64 ]] || return 1 ;;
        *) printf 'Missing script: %s\\n' "$2" >&2; return 1 ;;
      esac
      printf '%s\\n' "$*"
    }
    sleep() { :; }
    ${step.run}
  `], { encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'run pack\nrun build-release x64\n')
})
