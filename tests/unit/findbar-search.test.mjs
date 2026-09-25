import assert from 'node:assert/strict'
import test from 'node:test'

import { createFindbarSearch } from '../../src/renderer/helpers/findbarSearch.js'

function makeEnvironment(nodes) {
  const highlights = new Map()
  const positions = []
  const updates = []
  const root = { name: 'active-tab' }
  const document = {
    body: { name: 'other-tabs' },
    createTreeWalker(receivedRoot, _showText, { acceptNode }) {
      assert.equal(receivedRoot, root)
      let position = -1
      return {
        currentNode: null,
        nextNode() {
          while (++position < nodes.length) {
            const node = nodes[position]
            if (acceptNode(node) === 1) {
              this.currentNode = node
              return true
            }
          }
          return false
        },
      }
    },
    createRange() {
      return {
        setStart(node, offset) { this.node = node; this.start = offset },
        setEnd(_node, offset) { this.end = offset },
        getBoundingClientRect() { return { top: 100, height: 20, width: 50 } },
      }
    },
  }
  const view = {
    CSS: { highlights },
    Highlight: class Highlight {
      constructor(...ranges) { this.ranges = ranges }
    },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    getComputedStyle: element => element.style ?? { display: 'block', visibility: 'visible' },
    innerHeight: 200,
    scrollBy: options => positions.push(options),
  }
  const search = createFindbarSearch({
    document, view, getRoot: () => root,
    onMatchChange: (index, count) => updates.push({ index, count }),
  })
  return { search, highlights, positions, updates }
}

function textNode(textContent, { closest = {}, style = {} } = {}) {
  return {
    textContent,
    parentElement: {
      style,
      closest(selector) { return closest[selector] ? this : null },
    },
  }
}

test('findbar searches only visible active-tab text and selects the first match', () => {
  const visible = textNode('Marker marker')
  const { search, highlights, positions, updates } = makeEnvironment([
    textNode('marker', { closest: { '.findbar': true } }),
    textNode('marker', { closest: { 'datalist, input, option, optgroup, script, select, style, template, textarea': true } }),
    textNode('marker', { style: { display: 'none' } }),
    textNode('marker', { closest: { '[aria-hidden="true"]': true } }),
    visible,
  ])

  search.find('marker')
  assert.deepEqual(updates.at(-1), { index: 1, count: 2 })
  assert.deepEqual(highlights.get('findbarmatch').ranges.map(range => range.start), [0, 7])
  assert.equal(highlights.get('findbarmatchcurrent').ranges[0].node, visible)
  assert.deepEqual(positions, [{ top: 10, behavior: 'smooth' }])
})

test('findbar navigation wraps both ways and clear removes highlights', () => {
  const { search, highlights, updates } = makeEnvironment([textNode('abc abc')])
  search.find('abc')
  search.find('abc', true)
  assert.deepEqual(updates.at(-1), { index: 2, count: 2 })
  search.find('abc', false)
  assert.deepEqual(updates.at(-1), { index: 1, count: 2 })
  search.clear()
  assert.equal(highlights.has('findbarmatch'), false)
  assert.equal(highlights.has('findbarmatchcurrent'), false)
  assert.deepEqual(updates.at(-1), { index: 0, count: 0 })
})

test('restoring a tab selects its saved match and an empty query resets the state', () => {
  const { search, highlights, updates } = makeEnvironment([textNode('abc abc abc')])
  search.search('abc')
  search.select(2)
  assert.deepEqual(updates.at(-1), { index: 3, count: 3 })
  assert.equal(highlights.get('findbarmatchcurrent').ranges[0].start, 8)
  search.find('')
  assert.deepEqual(updates.at(-1), { index: 0, count: 0 })
  assert.equal(highlights.has('findbarmatch'), false)
})
