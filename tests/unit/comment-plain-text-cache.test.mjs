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
      return { body: { textContent: html.replaceAll(/<[^>]+>/g, '') } }
    }
  }
  const getCommentPlainText = vm.runInNewContext(`${component.slice(start, end)}\ngetCommentPlainText`, { DOMParser, toRaw })
  return { getCommentPlainText, parses: () => parses }
}

test('parses each comment once while its text is unchanged', () => {
  const { getCommentPlainText, parses } = createParser()
  const comments = reactive([{ text: 'see <b>1:23</b>' }, { text: 'plain' }])

  assert.equal(getCommentPlainText(comments[0]), 'see 1:23')
  assert.equal(getCommentPlainText(comments[1]), 'plain')
  assert.equal(getCommentPlainText(comments[0]), 'see 1:23')
  assert.equal(getCommentPlainText(toRaw(comments)[0]), 'see 1:23', 'raw and reactive views share one entry')
  assert.equal(parses(), 2)
})

test('re-parses a comment when its text changes and tolerates missing text', () => {
  const { getCommentPlainText, parses } = createParser()
  const comment = reactive({ text: 'before' })

  assert.equal(getCommentPlainText(comment), 'before')
  comment.text = 'after <i>edit</i>'
  assert.equal(getCommentPlainText(comment), 'after edit')
  assert.equal(parses(), 2)

  assert.equal(getCommentPlainText(reactive({})), '')
})
