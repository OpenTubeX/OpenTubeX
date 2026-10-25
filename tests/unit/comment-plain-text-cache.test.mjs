import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { reactive, toRaw } from 'vue'

const component = await readFile(new URL('../../src/renderer/components/CommentSection/opentubex/useCommentFilters.js', import.meta.url), 'utf8')
const start = component.indexOf('const commentPlainTextCache = new WeakMap()')
const end = component.indexOf('\n  }\n', component.indexOf('function getCommentPlainText(', start)) + 5
assert.ok(start !== -1 && end > start, 'getCommentPlainText should be found in useCommentFilters.js')

function createParser () {
  let parses = 0
  class DOMParser {
    parseFromString (html) {
      parses++
      // The cache only needs to see that the parser ran; mark its output.
      return { body: { textContent: `parsed:${html}` } }
    }
  }
  const getCommentPlainText = vm.runInNewContext(`${component.slice(start, end)}\ngetCommentPlainText`, { DOMParser, toRaw })
  return { getCommentPlainText, parses: () => parses }
}

test('parses each comment once while its text is unchanged', () => {
  const { getCommentPlainText, parses } = createParser()
  const comments = reactive([{ text: 'see 1:23' }, { text: 'plain' }])

  assert.equal(getCommentPlainText(comments[0]), 'parsed:see 1:23')
  assert.equal(getCommentPlainText(comments[1]), 'parsed:plain')
  assert.equal(getCommentPlainText(comments[0]), 'parsed:see 1:23')
  assert.equal(getCommentPlainText(toRaw(comments)[0]), 'parsed:see 1:23', 'raw and reactive views share one entry')
  assert.equal(parses(), 2)
})

test('re-parses a comment when its text changes and tolerates missing text', () => {
  const { getCommentPlainText, parses } = createParser()
  const comment = reactive({ text: 'before' })

  assert.equal(getCommentPlainText(comment), 'parsed:before')
  comment.text = 'after'
  assert.equal(getCommentPlainText(comment), 'parsed:after')
  assert.equal(parses(), 2)

  assert.equal(getCommentPlainText(reactive({})), 'parsed:')
})
