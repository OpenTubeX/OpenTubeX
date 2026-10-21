import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { ref } from 'vue'

function loadComposable() {
  const lists = []
  const window = {
    matchMedia(media) {
      const listeners = new Set()
      const list = {
        media,
        matches: false,
        listeners,
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener),
        change(matches) {
          list.matches = matches
          for (const listener of listeners) listener()
        },
      }
      lists.push(list)
      return list
    },
  }
  const unmounts = []
  const code = readFileSync(new URL('../../src/renderer/composables/usePhoneLayout.js', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '')
    .replace(/^export /gm, '')
  const { usePhoneLayout, PHONE_LAYOUT_QUERY } = vm.runInNewContext(`${code}\n;({ usePhoneLayout, PHONE_LAYOUT_QUERY })`, {
    ref, window, onBeforeUnmount: callback => unmounts.push(callback),
  })
  return {
    PHONE_LAYOUT_QUERY,
    lists,
    mount(query) {
      const matches = usePhoneLayout(query)
      return { matches, unmount: unmounts.at(-1) }
    },
  }
}

test('200 cards with two buttons each share one MediaQueryList and listener per query', () => {
  const { PHONE_LAYOUT_QUERY, lists, mount } = loadComposable()
  const modalQuery = '(max-width: 900px), (max-height: 600px)'
  const consumers = Array.from({ length: 200 }, () => [
    mount(PHONE_LAYOUT_QUERY), mount(PHONE_LAYOUT_QUERY), mount(modalQuery),
  ]).flat()

  assert.deepEqual(lists.map(list => list.media), [PHONE_LAYOUT_QUERY, modalQuery])
  assert.deepEqual(lists.map(list => list.listeners.size), [1, 1])
  assert.ok(consumers.every(consumer => consumer.matches.value === false))

  lists[0].change(true)
  assert.equal(consumers.filter(consumer => consumer.matches.value).length, 400)

  for (const consumer of consumers) consumer.unmount()
  assert.deepEqual(lists.map(list => list.listeners.size), [0, 0])

  // Nothing listened while unmounted, so a new consumer must not see the stale value.
  lists[0].matches = false
  const late = mount(PHONE_LAYOUT_QUERY)
  assert.equal(lists.length, 2)
  assert.equal(late.matches.value, false)
  assert.equal(lists[0].listeners.size, 1)
  late.unmount()
  assert.equal(lists[0].listeners.size, 0)
})
