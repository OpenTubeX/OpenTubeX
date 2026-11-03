import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { babelParse, parse } from 'vue/compiler-sfc'

const source = await readFile(new URL('../../src/renderer/components/WatchVideoDescription/WatchVideoDescription.vue', import.meta.url), 'utf8')
const script = parse(source).descriptor.scriptSetup.content
const statements = babelParse(script, { sourceType: 'module' }).program.body
const expandedDeclaration = statements
  .filter(statement => statement.type === 'VariableDeclaration')
  .flatMap(statement => statement.declarations)
  .find(declaration => declaration.id.name === 'isExpanded')
const measureDeclaration = statements.find(statement => statement.type === 'FunctionDeclaration' && statement.id.name === 'measureDescription')
assert.ok(expandedDeclaration, 'isExpanded declaration must exist')
assert.ok(measureDeclaration, 'measureDescription function must exist')
const expandedExpression = script.slice(expandedDeclaration.init.start, expandedDeclaration.init.end)
const measureFunction = script.slice(measureDeclaration.start, measureDeclaration.end)
const shortDeclaration = statements.find(statement => statement.type === 'FunctionDeclaration' && statement.id.name === 'isShortDescription')
const shortFunction = script.slice(shortDeclaration.start, shortDeclaration.end)

function measure({ alwaysExpanded = false, short = true, tags = [], games = [], musicTracks = [], license = null, contentDisclosures = [], description = 'Sie haben Post\nDer Klassiker von AOL' } = {}) {
  const context = vm.createContext({
    props: { alwaysExpanded, tags, games, musicTracks, license, contentDisclosures },
    computed: getter => getter(),
    shownDescription: description,
    showFullDescription: { value: false },
    showControls: { value: false },
    userWantsExpandedDescription: false,
    hasMeasured: false,
    descriptionContainer: { value: { $el: { clientHeight: 48, scrollHeight: short ? 48 : 240 } } },
    getComputedStyle: () => ({ lineHeight: '16px' }),
    nextTick() {},
    updateDescriptionLayout() {},
  })
  vm.runInContext(`${shortFunction}\n${measureFunction}\nmeasureDescription()`, context)
  return {
    expanded: vm.runInContext(expandedExpression, context),
    measured: context.hasMeasured,
    showFullDescription: context.showFullDescription.value,
    showControls: context.showControls.value,
  }
}

test('regular descriptions expand short content and keep long content collapsed', () => {
  assert.deepEqual(measure(), {
    expanded: true, measured: true, showFullDescription: true, showControls: false,
  })
  assert.deepEqual(measure({ short: false }), {
    expanded: false, measured: true, showFullDescription: false, showControls: true,
  })
  assert.equal(measure({ description: '' }).expanded, true)
  assert.equal(measure({ alwaysExpanded: true, short: false }).expanded, true)
})

for (const metadata of [{ tags: ['video tag'] }, { games: [{ title: 'Grand Theft Auto VI' }] }, { musicTracks: [{ title: 'Never Gonna Give You Up' }] }, { license: 'Creative Commons' }, { contentDisclosures: [{ label: 'Auto-dubbed', description: 'Automatically generated audio tracks.' }] }]) {
  test(`description controls account for ${Object.keys(metadata)[0]} below short or empty text`, () => {
    for (const description of ['Short description', '']) {
      assert.deepEqual(measure({ ...metadata, description }), {
        expanded: false, measured: true, showFullDescription: false, showControls: true,
      })
    }
  })
}
