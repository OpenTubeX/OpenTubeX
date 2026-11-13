import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compile, createSSRApp } from 'vue'
import { parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

const componentUrl = new URL('../../src/renderer/components/TabBar/CapacitorPhoneTabSwitcher.vue', import.meta.url)
const { descriptor } = parse(readFileSync(componentUrl, 'utf8'))

function * elements(node) {
  if (node.type === 1) yield node
  for (const child of node.children ?? []) yield * elements(child)
}

const syncedTabButtons = [...elements(descriptor.template.ast)].filter(node => (
  node.tag === 'button' && node.props.some(prop => (
    prop.name === 'class' && prop.value?.content.split(/\s+/).includes('capacitorPhoneSyncedTabTarget')
  ))
))
assert.equal(syncedTabButtons.length, 1, 'select the synced-tab card button')
const labels = syncedTabButtons[0].children.filter(node => node.tag === 'span')
assert.equal(labels.length, 1, 'the synced-tab card has one direct title label')
const label = labels[0].loc.source

for (const [title, expected] of [
  ['', '/subscriptions'],
]) {
  test(`phone synced tab label displays ${JSON.stringify(expected)}`, async () => {
    const app = createSSRApp({
      setup: () => ({ tab: { title, url: '/subscriptions' } }),
      render: compile(label),
    })
    assert.equal(await renderToString(app), `<span dir="auto">${expected}</span>`)
  })
}
