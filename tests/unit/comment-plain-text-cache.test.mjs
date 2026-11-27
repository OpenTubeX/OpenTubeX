import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { reactive, toRaw } from 'vue'

const component = await readFile(new URL('../../src/renderer/components/CommentSection/CommentSection.vue', import.meta.url), 'utf8')
const start = component.indexOf('const commentPlainTextCache = new WeakMap()')
const end = component.indexOf('\n}\n', component.indexOf('function getCommentPlainText(', start)) + 3
assert.ok(start !== -1 && end > start, 'getCommentPlainText should be found in CommentSection.vue')

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

test('parses each HTML comment once while its text is unchanged', () => {
  const { getCommentPlainText, parses } = createParser()
  const comments = reactive([{ text: 'see <a>1:23</a>' }, { text: 'a &amp; b' }])

  assert.equal(getCommentPlainText(comments[0]), 'parsed:see <a>1:23</a>')
  assert.equal(getCommentPlainText(comments[1]), 'parsed:a &amp; b')
  assert.equal(getCommentPlainText(comments[0]), 'parsed:see <a>1:23</a>')
  assert.equal(getCommentPlainText(toRaw(comments)[0]), 'parsed:see <a>1:23</a>', 'raw and reactive views share one entry')
  assert.equal(parses(), 2)
})

test('skips DOMParser for plain text and missing text', () => {
  const { getCommentPlainText, parses } = createParser()

  assert.equal(getCommentPlainText(reactive({ text: 'see 1:23' })), 'see 1:23')
  assert.equal(getCommentPlainText(reactive({})), '')
  assert.equal(parses(), 0)
})

test('re-parses a comment when its text changes', () => {
  const { getCommentPlainText, parses } = createParser()
  const comment = reactive({ text: '<b>before</b>' })

  assert.equal(getCommentPlainText(comment), 'parsed:<b>before</b>')
  comment.text = '<b>after</b>'
  assert.equal(getCommentPlainText(comment), 'parsed:<b>after</b>')
  assert.equal(parses(), 2)
})
