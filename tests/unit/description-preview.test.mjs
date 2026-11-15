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
const metadataDeclaration = statements
  .filter(statement => statement.type === 'VariableDeclaration')
  .find(statement => statement.declarations[0].id.name === 'hasMetadata')
const metadataStatement = script.slice(metadataDeclaration.start, metadataDeclaration.end)

// Lays out the text above one metadata block of the given height, followed by the content end marker.
function descriptionLayout({ description, short, metadataHeight, hasMetadata }) {
  const contentEnd = {}
  // Without metadata, the card only renders with text.
  const textHeight = description === '' && hasMetadata ? 0 : (short ? 16 : 240)
  const metadata = {
    getBoundingClientRect: () => ({ top: textHeight, bottom: textHeight + metadataHeight, height: metadataHeight }),
    nextElementSibling: contentEnd,
  }
  return {
    contentEnd,
    description: {
      clientHeight: textHeight,
      scrollHeight: textHeight,
      getBoundingClientRect: () => ({ top: 0, bottom: textHeight, height: textHeight }),
      nextElementSibling: metadata,
    },
  }
}

function measure({ alwaysExpanded = false, short = true, tags = [], games = [], musicTracks = [], license = null, contentDisclosures = [], description = 'Sie haben Post\nDer Klassiker von AOL', metadataHeight = 200 } = {}) {
  const hasMetadata = tags.length > 0 || games.length > 0 || musicTracks.length > 0 || Boolean(license) || contentDisclosures.length > 0
  const layout = descriptionLayout({ description, short, metadataHeight, hasMetadata })
  const context = vm.createContext({
    props: { alwaysExpanded, tags, games, musicTracks, license, contentDisclosures },
    computed: getter => ({ value: getter() }),
    shownDescription: description,
    showFullDescription: { value: false },
    showControls: { value: false },
    userWantsExpandedDescription: false,
    hasMeasured: false,
    descriptionContainer: { value: { $el: layout.description } },
    descriptionContentEnd: { value: layout.contentEnd },
    descriptionCard: { value: { $el: { clientHeight: 300 } } },
    getComputedStyle: () => ({ lineHeight: '16px' }),
    nextTick() {},
    updateDescriptionLayout() {},
  })
  vm.runInContext(`${metadataStatement}\n${shortFunction}\n${measureFunction}\nmeasureDescription()`, context)
  return {
    expanded: vm.runInContext(expandedExpression, context).value,
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

for (const metadata of [{ tags: ['video tag'] }, { contentDisclosures: [{ label: 'Auto-dubbed', description: 'Automatically generated audio tracks.' }] }]) {
  test(`description controls account for ${Object.keys(metadata)[0]} below short or empty text`, () => {
    for (const description of ['Short description', '']) {
      assert.deepEqual(measure({ ...metadata, description }), {
        expanded: false, measured: true, showFullDescription: false, showControls: true,
      })
    }
  })

  test(`description controls stay hidden when ${Object.keys(metadata)[0]} fits the four-line threshold`, () => {
    // 16px lines put the threshold at 64px.
    assert.deepEqual(measure({ ...metadata, description: '', metadataHeight: 64 }), {
      expanded: true, measured: true, showFullDescription: true, showControls: false,
    })
    assert.deepEqual(measure({ ...metadata, description: 'Short description', metadataHeight: 48 }), {
      expanded: true, measured: true, showFullDescription: true, showControls: false,
    })
    assert.equal(measure({ ...metadata, description: '', metadataHeight: 66 }).showControls, true)
  })
}
