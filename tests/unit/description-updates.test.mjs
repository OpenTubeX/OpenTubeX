import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { babelParse, parse } from 'vue/compiler-sfc'
import { linkifyDescription, linkifyHashtagsAndHandles } from '../../src/renderer/helpers/descriptionLinks.js'

const source = await readFile(new URL('../../src/renderer/components/WatchVideoDescription/WatchVideoDescription.vue', import.meta.url), 'utf8')
const script = parse(source).descriptor.scriptSetup.content
const setup = babelParse(script, { sourceType: 'module' }).program.body
  .filter(statement => statement.type !== 'ImportDeclaration')
  .map(statement => script.slice(statement.start, statement.end)).join('\n')

function descriptionComponent() {
  const props = reactive({ description: '', descriptionHtml: '', tags: [], games: [], license: null, previewOnly: false, alwaysExpanded: false })
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
    useTemplateRef: () => ref(null),
    onMounted() {},
    onBeforeUnmount() {},
    store: { getters: { getSearchSettings: () => ({}) } },
    linkifyDescription,
    linkifyHashtagsAndHandles,
    copyToClipboard: async text => { copied = text },
    clampOverlayScrollTop() {},
    restoreOverlayScrollTop() {},
    document: {
      createElement: () => ({ innerHTML: '', get innerText() { return this.innerHTML.replace(/<[^>]*>/g, '') } }),
    },
  })
  vm.runInContext(setup, context)
  return {
    props,
    html: () => vm.runInContext('processedShownDescription.value', context),
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
