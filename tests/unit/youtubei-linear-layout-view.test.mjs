import assert from 'node:assert/strict'
import test from 'node:test'

import { Parser, YTNodes } from 'youtubei.js'

test('parses linear layouts without runtime parser generation and retains their header and list items', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  // Reconstruct the response shape reported by the generated LinearLayoutView parser.
  const layout = Parser.parseItem({
    linearLayoutViewModel: {
      items: [
        { sectionHeaderViewModel: { headline: { content: 'Options' } } },
        {
          listViewModel: {
            listItems: [{ listItemViewModel: { title: { content: 'First option' } } }]
          }
        }
      ],
      rendererContext: {
        loggingContext: {
          loggingDirectives: {
            trackingParams: 'fixture',
            visibility: { types: '1' }
          }
        }
      }
    }
  })

  assert.equal(warn.mock.callCount(), 0)
  assert.ok(layout instanceof YTNodes.LinearLayoutView)
  assert.equal(layout.items.length, 2)
  assert.ok(layout.items[0] instanceof YTNodes.SectionHeaderView)
  assert.equal(layout.items[0].headline.toString(), 'Options')
  assert.ok(layout.items[1] instanceof YTNodes.ListView)
  assert.equal(layout.items[1].items.length, 1)
  assert.ok(layout.items[1].items[0] instanceof YTNodes.ListItemView)
  assert.equal(layout.items[1].items[0].title.toString(), 'First option')
  assert.ok(layout.renderer_context)
})

test('parses an empty linear layout without optional renderer context', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const layout = Parser.parseItem({ linearLayoutViewModel: { items: [] } })

  assert.equal(warn.mock.callCount(), 0)
  assert.ok(layout instanceof YTNodes.LinearLayoutView)
  assert.deepEqual([...layout.items], [])
  assert.equal(layout.renderer_context, undefined)
})
