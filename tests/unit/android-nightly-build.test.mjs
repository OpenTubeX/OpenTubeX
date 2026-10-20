import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { load } from 'js-yaml'

async function obtainiumApps () {
  const readme = await readFile('README.md', 'utf8')
  return Object.fromEntries([...readme.matchAll(/obtainium:\/\/app\/([^)"]*)/g)].map(([, encoded]) => {
    const app = JSON.parse(decodeURIComponent(encoded))
    return [app.name, { ...app, settings: JSON.parse(app.additionalSettings) }]
  }))
}

// Lite APKs share each release with the full APKs, so each Obtainium link must match exactly one flavor.
function assertApkFilter (settings, accepted, rejected) {
  const filter = new RegExp(settings.apkFilterRegEx)
  const accepts = name => filter.test(name) !== (settings.invertAPKFilter === true)
  for (const name of accepted) assert.ok(accepts(name), name)
  for (const name of rejected) assert.ok(!accepts(name), name)
  assert.equal(settings.autoApkFilterByArch, true)
}

const abis = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64', 'universal']
const nightlyApks = flavor => abis.map(abi => `opentubex-0.34.0-nightly-1234-android-${flavor}${abi}.apk`)
const stableApks = flavor => ['', '-arm64-v8a', '-armeabi-v7a', '-x86', '-x86_64'].map(
  suffix => `org.opentubex.app-0.34.0-beta${flavor}${suffix}.apk`
)

test('the Obtainium stable links pick only their own APK flavor', async () => {
  const apps = await obtainiumApps()
  for (const [name, id, accepted, rejected] of [
    ['OpenTubeX', 'org.opentubex.app', stableApks(''), stableApks('-lite')],
    ['OpenTubeX Lite', 'org.opentubex.app.lite', stableApks('-lite'), stableApks('')]
  ]) {
    assert.equal(apps[name].id, id)
    assert.equal(apps[name].settings.includePrereleases, undefined)
    assertApkFilter(apps[name].settings, accepted, rejected)
  }
  const readme = await readFile('README.md', 'utf8')
  assert.doesNotMatch(readme, /obtainium:\/\/add\//)
})

test('the Obtainium nightly links allow architecture APKs and the universal fallback', async () => {
  const apps = await obtainiumApps()
  for (const [name, id, accepted, rejected] of [
    ['OpenTubeX Nightly', 'org.opentubex.app.nightly', nightlyApks(''), nightlyApks('lite-')],
    ['OpenTubeX Nightly Lite', 'org.opentubex.app.nightly.lite', nightlyApks('lite-'), nightlyApks('')]
  ]) {
    const { settings } = apps[name]
    assert.equal(apps[name].id, id)
    assert.equal(settings.includePrereleases, true)
    assert.equal(settings.fallbackToOlderReleases, true)
    assert.equal(settings.filterReleaseTitlesByRegEx, 'nightly')
    assertApkFilter(settings, accepted, [
      ...rejected,
      'org.opentubex.app-0.34.0-beta-arm64-v8a.apk',
      `${accepted[0]}.sha256`
    ])
  }
})

test('embeds the generated nightly version in the Android web bundle', async () => {
  const workflow = await readFile('.github/workflows/build.yml', 'utf8')
  const buildStart = workflow.indexOf('    - name: Build signed Android APKs')
  const buildEnd = workflow.indexOf('    - name: Upload Android', buildStart)
  const build = workflow.slice(buildStart, buildEnd)

  const packageVersionUpdate = build.indexOf("jq --arg version \"$version\" '.version = $version' package.json")
  const capacitorBuild = build.indexOf('pnpm run capacitor:sync:android')

  assert.notEqual(packageVersionUpdate, -1)
  assert.ok(packageVersionUpdate < capacitorBuild)
  assert.match(
    build,
    /gradlew --project-dir android :app:assembleNightly -PsplitApks\s+\\\s+-I \.\.\/tests\/android\/build-identity\.init\.gradle\s+verifyBuildIdentity/
  )
})

test('publishes full and lite architecture APKs alongside the existing desktop artifacts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'android-nightly-assets-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const version = '0.34.0-nightly-1234'
  const desktopName = `opentubex-${version}-amd64.AppImage`
  const desktop = join(directory, 'artifacts', desktopName)
  await mkdir(desktop, { recursive: true })
  await writeFile(join(desktop, 'app.AppImage'), 'desktop')
  const names = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64', 'universal'].flatMap(
    abi => ['', 'lite-'].map(flavor => `opentubex-${version}-android-${flavor}${abi}.apk`)
  )
  const workflow = load(await readFile('.github/workflows/build.yml', 'utf8'))
  const uploads = workflow.jobs.android.steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'))
  assert.equal(uploads.length, names.length, 'Each APK must have its own artifact, with no report artifact')
  const uploadedNames = []
  for (const upload of uploads) {
    assert.equal(upload.with.archive, undefined, 'APK downloads must use the default ZIP artifact archive')
    assert.equal(upload.with['if-no-files-found'], 'error')
    const path = upload.with.path.replace('${{ steps.apk.outputs.version }}', version)
    const name = upload.with.name.replace('${{ steps.apk.outputs.version }}', version)
    assert.equal(path.split('/')[0], name.includes('-lite-') ? 'android-lite-apks' : 'android-apks')
    assert.equal(path.split('/').pop(), name)
    uploadedNames.push(name)
    const artifact = join(directory, 'artifacts', name)
    await mkdir(artifact)
    await writeFile(join(artifact, name), name)
  }
  assert.deepEqual(uploadedNames.sort(), names.sort())
  const prepare = workflow.jobs['publish-nightly'].steps.find(step => step.name === 'Prepare release assets')
  const run = () => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', prepare.run], {
    cwd: directory,
    encoding: 'utf8'
  })
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await readdir(join(directory, 'release-assets'))).sort(), [...names, desktopName].sort())
  for (const name of names) {
    assert.equal(await readFile(join(directory, 'release-assets', name), 'utf8'), name)
  }

  await rm(join(directory, 'release-assets'), { recursive: true })
  await writeFile(join(desktop, 'unexpected.txt'), 'unexpected')
  const incomplete = run()
  assert.notEqual(incomplete.status, 0)
  assert.match(incomplete.stderr, /Expected one file/)
})

for (const file of ['build', 'release']) {
  test(`${file} workflow installs the pinned Cast sender NDK before building APKs`, async () => {
    const gradle = await readFile('android/app/build.gradle', 'utf8')
    const ndkVersion = gradle.match(/ndkVersion '([^']+)'/)[1]
    const workflow = load(await readFile(`.github/workflows/${file}.yml`, 'utf8'))
    const steps = Object.values(workflow.jobs).find(job =>
      job.steps?.some(step => step.name === 'Build signed Android APKs')
    ).steps
    const setup = steps.find(step => step.name === 'Set up Android SDK')
    assert.deepEqual(setup.with.packages.split(/\s+/), ['platform-tools', `ndk;${ndkVersion}`])
    assert.ok(steps.indexOf(setup) < steps.findIndex(step => step.name === 'Build signed Android APKs'))
  })

  test(`${file} workflow omits Android build summaries and shrinking report uploads`, async () => {
    const workflow = load(await readFile(`.github/workflows/${file}.yml`, 'utf8'))
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps ?? [])
    const build = steps.find(step => step.name === 'Build signed Android APKs')
    assert.doesNotMatch(build.run, /GITHUB_STEP_SUMMARY/)
    const uploads = steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'))
    assert.ok(uploads.every(step => !/shrinking|mapping/.test(`${step.with.name} ${step.with.path}`)))
  })
}

test('stable releases build only production APKs and sort between nightlies by version code', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'android-stable-promotion-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'android'))
  await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.35.0' }))
  const stubs = {
    git: '#!/bin/sh\necho 12345\n',
    pnpm: '#!/bin/sh\nexit 0\n',
    'android/gradlew': '#!/bin/sh\nprintf "%s|%s|%s\\n" "$*" "$ANDROID_VERSION_CODE" "$ANDROID_VERSION_NAME" >> gradle.log\n',
    python3: '#!/bin/sh\nprintf "%s\\n" "$*" >> packaging.log\n'
  }
  for (const [name, script] of Object.entries(stubs)) {
    await writeFile(join(directory, name), script)
    await chmod(join(directory, name), 0o755)
  }
  const workflow = load(await readFile('.github/workflows/release.yml', 'utf8'))
  const build = workflow.jobs.build.steps.find(step => step.name === 'Build signed Android APKs')
  const result = spawnSync('bash', ['-c', build.run], {
    cwd: directory,
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      ANDROID_RELEASE_KEYSTORE_BASE64: Buffer.from('fixture').toString('base64'),
      ANDROID_RELEASE_STORE_PASSWORD: 'fixture',
      ANDROID_RELEASE_KEYSTORE: join(directory, 'android/release.keystore')
    },
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  const invocations = (await readFile(join(directory, 'gradle.log'), 'utf8')).trim().split('\n')
  const stableCode = Number(invocations[0].split('|')[1])
  assert.equal(invocations.length, 2)
  for (const invocation of invocations) {
    assert.ok(invocation.includes(':app:assembleRelease'))
    assert.ok(!invocation.includes(':app:assembleNightly'))
    assert.ok(invocation.endsWith(`|${stableCode}|0.35.0`))
  }
  assert.ok(!invocations[0].includes('-Plite'))
  assert.ok(invocations[1].includes('-Plite'))
  const packaging = await readFile(join(directory, 'packaging.log'), 'utf8')
  assert.match(packaging, /apk\/release android-apks --release\n/)
  assert.match(packaging, /apk\/release android-lite-apks --release --lite/)
  assert.doesNotMatch(packaging, /apk\/nightly/)

  const nightlyWorkflow = load(await readFile('.github/workflows/build.yml', 'utf8'))
  const nightlyBuild = nightlyWorkflow.jobs.android.steps.find(step => step.name === 'Build signed Android APKs')
  for (const commitCount of [12345, 12346]) {
    await writeFile(join(directory, 'git'), `#!/bin/sh\necho ${commitCount}\n`)
    await writeFile(join(directory, 'gradle.log'), '')
    await writeFile(join(directory, 'packaging.log'), '')
    await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.35.0' }))
    const nightly = spawnSync('bash', ['-c', nightlyBuild.run], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        GITHUB_REF: 'refs/heads/development',
        GITHUB_RUN_NUMBER: '1234',
        GITHUB_OUTPUT: join(directory, 'output')
      },
      encoding: 'utf8'
    })
    assert.equal(nightly.status, 0, nightly.stderr)
    const nightlyInvocations = (await readFile(join(directory, 'gradle.log'), 'utf8')).trim().split('\n')
    const nightlyCode = Number(nightlyInvocations[0].split('|')[1])
    assert.equal(nightlyInvocations.length, 2)
    for (const invocation of nightlyInvocations) {
      assert.ok(invocation.includes(':app:assembleNightly -PsplitApks'))
      assert.ok(invocation.includes('verifyBuildIdentity'))
      assert.ok(invocation.endsWith(`|${nightlyCode}|0.35.0-nightly-1234`))
    }
    assert.ok(!nightlyInvocations[0].includes('-Plite'))
    assert.ok(nightlyInvocations[1].includes('-Plite'))
    assert.equal(await readFile(join(directory, 'packaging.log'), 'utf8'),
      '_scripts/android_apks.py android/app/build/outputs/apk/nightly android-apks\n' +
      '_scripts/android_apks.py android/app/build/outputs/apk/nightly android-lite-apks --lite\n')
    assert.ok(commitCount === 12345 ? nightlyCode < stableCode : nightlyCode > stableCode,
      'Stable promotion must update the same-commit nightly and accept the next nightly update')
  }
})

test('stable releases attach only production APKs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'android-release-assets-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'android-apks')
  await mkdir(source)
  const nightlySource = join(directory, 'android-nightly-apks')
  await mkdir(nightlySource)
  const names = ['', '-arm64-v8a', '-armeabi-v7a', '-x86', '-x86_64'].map(
    suffix => `org.opentubex.app-0.34.0-beta${suffix}.apk`
  )
  for (const name of names) await writeFile(join(source, name), name)
  const liteSource = join(directory, 'android-lite-apks')
  await mkdir(liteSource)
  const liteNames = ['', '-arm64-v8a', '-armeabi-v7a', '-x86', '-x86_64'].map(
    suffix => `org.opentubex.app-0.34.0-beta-lite${suffix}.apk`
  )
  for (const name of liteNames) await writeFile(join(liteSource, name), name)
  const nightlyNames = ['universal', 'arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'].map(
    abi => `opentubex-0.34.0-android-${abi}.apk`
  )
  for (const name of nightlyNames) await writeFile(join(nightlySource, name), name)
  const workflow = load(await readFile('.github/workflows/release.yml', 'utf8'))
  const prepare = workflow.jobs.build.steps.find(step => step.name === 'Prepare release assets')
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', prepare.run], {
    cwd: directory,
    env: { ...process.env, RUNTIME: 'android', VERSION: '0.34.0' },
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual((await readdir(join(directory, 'release-assets'))).sort(), [...names, ...liteNames].sort())
  for (const name of [...names, ...liteNames]) {
    assert.equal(await readFile(join(directory, 'release-assets', name), 'utf8'), name)
  }
  const upload = workflow.jobs.build.steps.find(step => step.name === 'Upload release assets')
  assert.equal(upload.with.files, 'release-assets/*')
})

for (const [channel, resourceDir, badge] of [['nightly', 'debug', 'wrench'], ['dev', 'dev', 'flask']]) {
  test(`gives Android ${channel} builds their ${badge} launcher icon`, async () => {
    const icon = await readFile(
      `android/app/src/${resourceDir}/res/drawable/ic_launcher_${channel}_foreground.xml`,
      'utf8'
    )

    assert.ok(icon.includes(badge))

    for (const api of [26, 33]) {
      for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
        const adaptiveIcon = await readFile(
          `android/app/src/${resourceDir}/res/mipmap-anydpi-v${api}/${name}`,
          'utf8'
        )

        assert.ok(adaptiveIcon.includes(`@drawable/ic_launcher_${channel}_foreground`))
        if (api === 33) {
          assert.ok(adaptiveIcon.includes(`@drawable/ic_launcher_${channel}_monochrome`))
        }
      }
    }

    for (const [density, size] of Object.entries({
      mdpi: 48,
      hdpi: 72,
      xhdpi: 96,
      xxhdpi: 144,
      xxxhdpi: 192
    })) {
      for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
        const png = await readFile(
          `android/app/src/${resourceDir}/res/mipmap-${density}/${name}`
        )

        assert.deepEqual(
          png.subarray(0, 8),
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        )
        assert.equal(png.readUInt32BE(16), size)
        assert.equal(png.readUInt32BE(20), size)
      }
    }
  })
}
