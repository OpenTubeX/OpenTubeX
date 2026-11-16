import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

// The Android release builds QuickJS and the JPEG XL encoder from pinned
// sources, so updating either npm package needs new pins in the script.
test('the Android WebAssembly sources match the installed npm packages', () => {
  const result = spawnSync(process.execPath, ['_scripts/androidWasm.mjs', 'check'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
