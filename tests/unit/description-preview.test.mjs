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

function measure({ previewOnly = false, alwaysExpanded = false, short = true, description = 'Sie haben Post\nDer Klassiker von AOL' } = {}) {
  const context = vm.createContext({
    props: { previewOnly, alwaysExpanded },
    computed: getter => getter(),
    shownDescription: description,
    showFullDescription: { value: false },
    showControls: { value: false },
    hasMeasured: false,
    descriptionContainer: { value: { $el: { clientHeight: 48, scrollHeight: short ? 48 : 240 } } },
    isShortDescription: () => short,
    nextTick() {},
    updateDescriptionLayout() {},
  })
  vm.runInContext(`${measureFunction}\nmeasureDescription()`, context)
  return {
    expanded: vm.runInContext(expandedExpression, context),
    measured: context.hasMeasured,
    showFullDescription: context.showFullDescription.value,
    showControls: context.showControls.value,
  }
}

test('mobile previews stay collapsed after measuring short descriptions', () => {
  assert.deepEqual(measure({ previewOnly: true }), {
    expanded: false, measured: false, showFullDescription: false, showControls: false,
  })
})

test('mobile previews stay collapsed for long and empty descriptions with metadata', () => {
  assert.equal(measure({ previewOnly: true, short: false }).expanded, false)
  assert.equal(measure({ previewOnly: true, description: '' }).expanded, false)
})

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
