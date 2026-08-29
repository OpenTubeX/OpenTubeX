import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'

import {
  cleanupOverlayText,
  validateOverlayMessages,
} from '../../_scripts/aiTranslations.mjs'

const execFileAsync = promisify(execFile)

test('AI translation cleanup removes human overlaps without reformatting retained entries', () => {
  const overlay = `# Optional AI-generated translations for keys missing from ../example.yaml.
Keep:
  Quoted: "keep this style"
  Block: |
    Keep this block.
RemoveParent:
  Remove: generated
Nested:
  Remove: generated
  Keep: generated
`
  const human = {
    RemoveParent: { Remove: 'human' },
    Nested: { Remove: 'human' },
  }

  const result = cleanupOverlayText('example', overlay, human)

  assert.deepEqual(result.removedPaths, ['RemoveParent\0Remove', 'Nested\0Remove'])
  assert.equal(result.output, `# Optional AI-generated translations for keys missing from ../example.yaml.
Keep:
  Quoted: "keep this style"
  Block: |
    Keep this block.
Nested:
  Keep: generated
`)
})

test('AI translation cleanup leaves files byte-for-byte unchanged without overlaps', () => {
  const overlay = '# heading\nKeep: generated\n'
  const result = cleanupOverlayText('example', overlay, { Other: 'human' })

  assert.deepEqual(result, { output: overlay, removedPaths: [] })
})

test('AI translation cleanup does not reflow or normalize retained scalars', () => {
  const overlay = `# heading
Keep:
  Long: "This deliberately long line stays on one line even after a sibling entry is removed from the same mapping."
  Escaped: "Arload:\\_Ivinelloù"
  Remove: generated
`
  const human = { Keep: { Remove: 'human' } }

  const result = cleanupOverlayText('example', overlay, human)

  assert.equal(result.output, `# heading
Keep:
  Long: "This deliberately long line stays on one line even after a sibling entry is removed from the same mapping."
  Escaped: "Arload:\\_Ivinelloù"
`)
})

test('AI translation validation rejects keys already covered by human translations', () => {
  const errors = validateOverlayMessages(
    'fr-FR',
    { 'Locale Name': 'English', Covered: 'Source', Missing: 'Source' },
    { Covered: 'Human' },
    { Covered: 'Generated', Missing: 'Généré' }
  )

  assert.deepEqual(errors, ['Covered: already has a human translation in fr-FR'])
})

test('AI translation overlays cover every missing active-locale key', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['_scripts/aiTranslations.mjs', 'validate', '--all'],
    { cwd: process.cwd(), maxBuffer: 1024 * 1024 }
  )

  assert.match(stdout, /en-GB: \d+ AI translation entries are valid/)
  assert.match(stdout, /zh-TW: \d+ AI translation entries are valid/)
})
