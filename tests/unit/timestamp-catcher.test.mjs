import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { computed } from 'vue'
import { babelParse, parse } from 'vue/compiler-sfc'

const source = await readFile(new URL('../../src/renderer/components/FtTimestampCatcher.vue', import.meta.url), 'utf8')
const script = parse(source).descriptor.scriptSetup.content
const setup = babelParse(script, { sourceType: 'module' }).program.body
  .filter(statement => statement.type !== 'ImportDeclaration')
  .map(statement => script.slice(statement.start, statement.end)).join('\n')

function displayText(inputHtml) {
  const context = vm.createContext({
    defineProps: () => ({ inputHtml, linkTabIndex: '0', highlight: '' }),
    defineEmits: () => () => {},
    useRouter: () => ({
      currentRoute: { value: { params: { id: 'video' } } },
      resolve: ({ path, query }) => ({ href: `#${path}?timestamp=${query.timestamp}` }),
    }),
    computed,
  })
  vm.runInContext(setup, context)
  return vm.runInContext('displayText.value', context)
}

const link = (time, text) => `<a tabindex="0" href="#/watch/video?timestamp=${time}" data-time="${time}">${text}</a>`

test('links minute and hour timestamps', () => {
  assert.equal(
    displayText('Intro 0:05, part 12:34 and 1:02:03 until 10:00:00:00'),
    `Intro ${link(5, '0:05')}, part ${link(754, '12:34')} and ${link(3723, '1:02:03')} until ${link(36000, '10:00:00')}:00`
  )
})

test('scans long digit runs from remote text in linear time', () => {
  const digits = '1'.repeat(100_000)
  const started = performance.now()
  assert.equal(displayText(`${digits} ${digits}:`), `${digits} ${digits}:`)
  assert.ok(performance.now() - started < 1000)
})
