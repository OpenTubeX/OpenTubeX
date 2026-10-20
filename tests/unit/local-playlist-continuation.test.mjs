import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/helpers/api/local.js', import.meta.url), 'utf8')
const start = source.indexOf('export async function untilEndOfLocalPlayList(')
const end = source.indexOf('\n}\n', start) + 3
assert.ok(start >= 0 && end > start)

function harness(pages) {
  const requested = []
  const context = {
    getLocalPlaylistContinuation: async playlist => {
      requested.push(playlist.id)
      return pages[playlist.id] ?? null
    },
  }
  const untilEnd = vm.runInNewContext(`${source.slice(start, end).replace('export ', '')}\nuntilEndOfLocalPlayList`, context)
  return { untilEnd, requested }
}

test('stops requesting continuations once shouldContinue returns false', async () => {
  const pages = { second: { id: 'third', has_continuation: true }, third: { id: 'fourth', has_continuation: false } }
  const { untilEnd, requested } = harness(pages)
  const seen = []
  let active = true
  await untilEnd({ id: 'second', has_continuation: true }, page => {
    seen.push(page.id)
    active = false
  }, { runCallbackOnceFirst: false, shouldContinue: () => active })

  assert.deepEqual(requested, ['second'])
  assert.deepEqual(seen, ['third'])
})

test('walks every page by default', async () => {
  const pages = { second: { id: 'third', has_continuation: true }, third: { id: 'fourth', has_continuation: false } }
  const { untilEnd, requested } = harness(pages)
  const seen = []
  await untilEnd({ id: 'second', has_continuation: true }, page => seen.push(page.id))

  assert.deepEqual(requested, ['second', 'third'])
  assert.deepEqual(seen, ['second', 'third', 'fourth'])
})
