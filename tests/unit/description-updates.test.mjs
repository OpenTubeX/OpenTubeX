import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import vm from 'node:vm'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { babelParse, parse } from 'vue/compiler-sfc'
import { linkifyDescription, linkifyHashtagsAndHandles } from '../../src/renderer/helpers/descriptionLinks.js'

const source = await readFile(new URL('../../src/renderer/components/WatchVideoDescription/WatchVideoDescription.vue', import.meta.url), 'utf8')
const script = parse(source).descriptor.scriptSetup.content
const setup = babelParse(script, { sourceType: 'module' }).program.body
  .filter(statement => statement.type !== 'ImportDeclaration')
  .map(statement => script.slice(statement.start, statement.end)).join('\n')

async function flushDescriptionUpdates() {
  await nextTick()
  await setImmediate()
}

function descriptionComponent({ laidOut = false } = {}) {
  const props = reactive({ description: '', descriptionHtml: '', tags: [], games: [], musicTracks: [], license: null, contentDisclosures: [], previewOnly: false, alwaysExpanded: false })
  const htmlTextFixtures = new Map([
    ['', ''],
    ['<p>Restored HTML description</p>', 'Restored HTML description'],
    ['<p></p>', ''],
  ])
  let copied
  const stops = []
  const context = vm.createContext({
    defineProps: () => props,
    defineEmits: () => () => {},
    useI18n: () => ({ t: key => key }),
    useTabContext: () => ({}),
    computed,
    ref,
    nextTick,
    watch(...args) { stops.push(watch(...args)) },
    useTemplateRef: name => ref(laidOut && name === 'descriptionContainer'
      ? { $el: { clientHeight: 48, scrollHeight: 48 } }
      : null),
    getComputedStyle: () => ({ lineHeight: '16px' }),
    onMounted() {},
    onBeforeUnmount() {},
    store: { getters: { getSearchSettings: () => ({}) } },
    linkifyDescription,
    linkifyHashtagsAndHandles,
    copyToClipboard: async text => { copied = text },
    clampOverlayScrollTop() {},
    restoreOverlayScrollTop() {},
    document: {
      createElement: tag => {
        assert.equal(tag, 'template')
        return {
          innerHTML: '',
          get content() {
            assert.ok(htmlTextFixtures.has(this.innerHTML), 'provide a text fixture for this HTML')
            return { textContent: htmlTextFixtures.get(this.innerHTML) }
          },
        }
      },
    },
  })
  vm.runInContext(setup, context)
  return {
    props,
    html: () => vm.runInContext('processedShownDescription.value', context),
    expanded: () => vm.runInContext('isExpanded.value', context),
    controls: () => vm.runInContext('showControls.value', context),
    expand: () => vm.runInContext('expandDescription()', context),
    async copy() { await vm.runInContext('copyDescription()', context); return copied },
    dispose: () => stops.forEach(stop => stop()),
  }
}

test('download descriptions and copy text follow metadata arriving after reconnecting', async t => {
  const component = descriptionComponent()
  t.after(component.dispose)
  assert.equal(component.html(), '')
  component.props.description = 'Restored description #OpenTubeX'
  await nextTick()
  assert.match(component.html(), /Restored description/)
  assert.match(component.html(), /href="https:\/\/youtube.com\/hashtag\/OpenTubeX"/)
  assert.equal(await component.copy(), 'Restored description #OpenTubeX')
  component.props.description = ''
  await nextTick()
  assert.equal(component.html(), '')
  assert.equal(await component.copy(), '')
})

test('Invidious HTML descriptions and copy text follow reconnecting metadata', async t => {
  const component = descriptionComponent()
  t.after(component.dispose)
  assert.equal(component.html(), '')
  component.props.descriptionHtml = '<p>Restored HTML description</p>'
  await nextTick()
  assert.equal(component.html(), '<p>Restored HTML description</p>')
  assert.equal(await component.copy(), 'Restored HTML description')
  component.props.descriptionHtml = '<p></p>'
  await nextTick()
  assert.equal(component.html(), '')
  assert.equal(await component.copy(), '')
})

for (const metadata of [{ tags: ['video tag'] }, { games: [{ title: 'Test game' }] }, { musicTracks: [{ title: 'Test song' }] }, { license: 'Creative Commons' }, { contentDisclosures: [{ label: 'Auto-dubbed' }] }]) {
  test(`description controls account for ${Object.keys(metadata)[0]} arriving after short text`, async t => {
    const component = descriptionComponent({ laidOut: true })
    t.after(component.dispose)
    component.props.description = 'A short description.'
    await flushDescriptionUpdates()
    assert.equal(component.expanded(), true)
    assert.equal(component.controls(), false)
    // Clicking already-visible text is not an explicit expansion request.
    component.expand()
    await flushDescriptionUpdates()

    Object.assign(component.props, metadata)
    await flushDescriptionUpdates()
    assert.equal(component.controls(), true)
    assert.equal(component.expanded(), false)

    // Removing auto-collapsed metadata restores the original short-text card.
    Object.assign(component.props, { tags: [], games: [], musicTracks: [], license: null, contentDisclosures: [] })
    await flushDescriptionUpdates()
    assert.equal(component.controls(), false)
    assert.equal(component.expanded(), true)
    component.expand()
    Object.assign(component.props, structuredClone(metadata))
    await flushDescriptionUpdates()
    assert.equal(component.controls(), true)
    assert.equal(component.expanded(), false)

    component.expand()
    // Later metadata updates must preserve the user's explicit expansion.
    Object.assign(component.props, { tags: [], games: [], musicTracks: [], license: null, contentDisclosures: [] })
    await flushDescriptionUpdates()
    assert.equal(component.controls(), false)
    assert.equal(component.expanded(), true)
    Object.assign(component.props, structuredClone(metadata))
    await flushDescriptionUpdates()
    assert.equal(component.controls(), true)
    assert.equal(component.expanded(), true)
  })
}

const parseDescriptionHtml = vm.runInNewContext(`${setup.slice(setup.indexOf('function parseDescriptionHtml('), setup.indexOf('function processDescriptionHtml('))}; parseDescriptionHtml`)

test('Invidious HTML descriptions drop YouTube redirects and tracking attributes', () => {
  assert.equal(
    parseDescriptionHtml('<a class="yt-simple-endpoint style-scope" href="/redirect?event=video_description&amp;redir_token=QUFF&amp;q=https%3A%2F%2Fexample.com%2Fpage&amp;v=abc" rel="nofollow noopener" target="_blank" dir="auto">https://example.com/page</a>'),
    '<a  href="https://example.com/page"   dir="auto">https://example.com/page</a>'
  )
  assert.equal(
    parseDescriptionHtml('<a href="/watch?v=abc&amp;t=65s" data-onclick="jump_to_time" data-jump-time="65">1:05</a> Intro\n<a href="/hashtag/music">#music</a>'),
    '<a href="https://www.youtube.com/watch?v=abc&t=65s" data-onclick="jump_to_time" data-jump-time="65">1:05</a> Intro\n<a href="https://www.youtube.com/hashtag/music">#music</a>'
  )
  // A value that repeats the attribute name is removed with its attribute
  assert.equal(
    parseDescriptionHtml('<a class="one class=two" id="x id=y" href="/watch?v=abc">text</a> after'),
    '<a   href="https://www.youtube.com/watch?v=abc">text</a> after'
  )
})

test('Invidious HTML descriptions with repeated unterminated attributes are cleaned in linear time', () => {
  const started = performance.now()
  for (const candidate of ['/redirect', 'class=', 'id=', 'data-url=', '&v', '&redir_token']) {
    const html = candidate.repeat(100_000 / candidate.length)
    assert.equal(parseDescriptionHtml(html), html)
  }
  parseDescriptionHtml(`class="${'a'.repeat(100_000)}\n`.repeat(2))
  assert.ok(performance.now() - started < 1000)
})
