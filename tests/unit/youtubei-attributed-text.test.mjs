import assert from 'node:assert/strict'
import test from 'node:test'

// Loads the platform shim that youtubei.js' parser dependencies need.
import 'youtubei.js'

import Text from '../../node_modules/youtubei.js/dist/src/parser/classes/misc/Text.js'

test('parses attachment runs whose omitted length represents a point attachment', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  const attachment = {
    startIndex: 5,
    element: {
      type: {
        imageType: {
          image: { sources: [] }
        }
      }
    },
    alignment: 'ALIGNMENT_VERTICAL_CENTER'
  }

  const text = Text.fromAttributed({
    content: 'fa_sc and Fabiano',
    attachmentRuns: [attachment]
  })

  assert.equal(warn.mock.callCount(), 0)
  assert.equal(text.toString(), 'fa_sc and Fabiano')
  assert.ok(text.runs)
  assert.equal(text.runs[0].attachment.length, 0)
  assert.deepEqual(text.runs[0].attachment.element, attachment.element)
})
