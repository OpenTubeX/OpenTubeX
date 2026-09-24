import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import YAML from 'yaml'

import {
  cleanupOverlayText,
  validateOverlayMessages,
} from '../../_scripts/aiTranslations.mjs'
import { selectPluralForm } from '../../src/renderer/i18n/plurals.js'

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

test('AI translation validation allows count-aware external metric labels', () => {
  const source = { Video: { 'External Media': { Dislikes: 'dislike | dislikes', Reposts: 'repost | reposts', Saves: 'save | saves' } } }
  const overlay = { Video: { 'External Media': {
    Dislikes: 'дизлайк | дизлайки | дизлайків',
    Reposts: 'репост | репости | репостів',
    Saves: 'збереження | збереження | збережень'
  } } }

  assert.deepEqual(validateOverlayMessages('uk', source, {}, overlay), [])
  assert.equal(selectPluralForm('uk', overlay.Video['External Media'].Dislikes, 1), 'дизлайк')
  assert.equal(selectPluralForm('uk', overlay.Video['External Media'].Dislikes, 2), 'дизлайки')
  assert.equal(selectPluralForm('uk', overlay.Video['External Media'].Dislikes, 5), 'дизлайків')
  assert.equal(selectPluralForm('uk', overlay.Video['External Media'].Saves, 5), 'збережень')
  assert.deepEqual(validateOverlayMessages('uk', { Label: 'label' }, {}, { Label: 'one | few | many' }), [
    'Label: source is not plural but translation has 3 forms'
  ])
})

test('external metric labels use the correct counted noun forms', async () => {
  const cases = [
    ['hu', 'Saves', 2, 'Mentés'],
    ['fi', 'Reposts', 2, 'Uudelleenjulkaisua'],
    ['br', 'Dislikes', 2, 'Displijadennoù'],
    ['hr', 'Reposts', 5, 'Ponovnih objava'],
    ['fa', 'Reposts', 2, 'بازنشرها'],
    ['nn', 'Dislikes', 2, 'Mislikingar'],
    ['nb-NO', 'Dislikes', 1, 'Misliking'],
    ['sk', 'Reposts', 5, 'Opätovných zdieľaní'],
    ['da', 'Saves', 2, 'Gemte elementer'],
    ['lt', 'Saves', 10, 'Išsaugojimų'],
    ['lt', 'Reposts', 10, 'Pakartotinių įrašų'],
    ['ta', 'Saves', 2, 'சேமிப்புகள்'],
    ['ar', 'Dislikes', 1, 'عدم إعجاب']
  ]
  for (const [locale, key, count, expected] of cases) {
    const messages = YAML.parse(await readFile(new URL(`../../static/locales/ai/${locale}.yaml`, import.meta.url), 'utf8'))
    assert.equal(selectPluralForm(locale, messages.Video['External Media'][key], count), expected, `${locale} ${key} ${count}`)
  }
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
