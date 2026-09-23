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
    writeFileSync(wget, `#!/bin/sh
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
        PATH: `${directory}:${process.env.PATH}`,
        RELEASE_ASSET_RETRY_DELAY: '0',
        RELEASE_ASSET_MAX_ATTEMPTS: '2',
      },
    })

    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(count, 'utf8').trim(), '24')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
