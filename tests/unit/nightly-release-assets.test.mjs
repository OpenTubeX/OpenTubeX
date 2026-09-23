import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const script = new URL('../../_scripts/wait-for-nightly-assets.sh', import.meta.url).pathname

test('waits until the release tag exposes every package asset', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nightly-assets-'))
  try {
    const wget = join(directory, 'wget')
    const count = join(directory, 'count')
    const requests = join(directory, 'requests')
    writeFileSync(wget, `#!/bin/sh
for argument do
  url="$argument"
done
printf '%s\\n' "$url" >> "$REQUESTS_FILE"
count=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$COUNT_FILE"
if [ "$count" -eq 1 ]; then
  exit 1
fi
exit 0
`)
    chmodSync(wget, 0o755)

    const result = spawnSync('bash', [script, 'v0.35.0-nightly-1528'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        COUNT_FILE: count,
        REQUESTS_FILE: requests,
        GITHUB_REPOSITORY: 'OpenTubeX/test-fork',
        PATH: `${directory}:${process.env.PATH}`,
        RELEASE_ASSET_RETRY_DELAY: '0',
        RELEASE_ASSET_MAX_ATTEMPTS: '2',
      },
    })

    assert.equal(result.status, 0, result.stderr)
    const version = '0.35.0-nightly-1528'
    const base = `https://github.com/OpenTubeX/test-fork/releases/download/v${version}/`
    const expected = [
      `opentubex_${version}_amd64.deb`,
      `opentubex_${version}_arm64.deb`,
      `opentubex_${version}_armv7l.deb`,
      `opentubex-${version}.amd64.rpm`,
      `opentubex-${version}.arm64.rpm`,
      `opentubex-${version}-linux-x64-portable.zip`,
      `opentubex-${version}-linux-arm64-portable.zip`,
      `opentubex-${version}-android-arm64-v8a.apk`,
      `opentubex-${version}-android-armeabi-v7a.apk`,
      `opentubex-${version}-android-x86.apk`,
      `opentubex-${version}-android-x86_64.apk`,
      `opentubex-${version}-android-universal.apk`,
    ].map(asset => `${base}${asset}`)
    assert.deepEqual(readFileSync(requests, 'utf8').trim().split('\n'), [...expected, ...expected])
    assert.equal(readFileSync(count, 'utf8').trim(), String(expected.length * 2))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
