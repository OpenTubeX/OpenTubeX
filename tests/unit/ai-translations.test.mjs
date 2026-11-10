import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)

test('AI translation overlays cover every missing active-locale key', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['_scripts/aiTranslations.mjs', 'validate', '--all'],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
  )

  assert.match(stdout, /en-GB: \d+ AI translation entries are valid/)
  assert.match(stdout, /zh-TW: \d+ AI translation entries are valid/)
})
