import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { babelParse, parse } from 'vue/compiler-sfc'

const source = await readFile(new URL('../../src/renderer/components/SyncSettings/SyncActivity.vue', import.meta.url), 'utf8')
const script = parse(source).descriptor.scriptSetup.content
const declaration = babelParse(script, { sourceType: 'module' }).program.body
  .find(node => node.type === 'FunctionDeclaration' && node.id.name === 'expandActivity')

test('expanding activity moves focus to the first revealed entry after rendering', async () => {
  assert.ok(declaration, 'expansion must preserve keyboard focus')
  const events = []
  const context = vm.createContext({
    showAll: { value: false },
    activityList: { value: { children: Array.from({ length: 6 }, (_, index) => ({
      focus() { events.push(`focus ${index}`) },
    })) } },
    async nextTick() {
      assert.equal(context.showAll.value, true)
      events.push('render')
    },
  })
  vm.runInContext(script.slice(declaration.start, declaration.end), context)
  await vm.runInContext('expandActivity()', context)
  assert.deepEqual(events, ['render', 'focus 3'])
  context.activityList.value = null
  await vm.runInContext('expandActivity()', context)
})
