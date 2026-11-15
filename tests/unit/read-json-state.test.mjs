import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { readJsonState } from '../../src/main/readJsonState.js'

async function directory(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'read-json-state-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  return folder
}

test('a missing state file reads as empty', async t => {
  assert.equal(await readJsonState(path.join(await directory(t), 'state.json'), 'state'), undefined)
})

test('corrupt or invalid state is kept as a backup before it reads as empty', async t => {
  t.mock.method(console, 'error', () => {})
  const folder = await directory(t)
  for (const [name, text] of [['truncated.json', '[{"id": 1'], ['invalid.json', '{"id": 1}']]) {
    const file = path.join(folder, name)
    await writeFile(file, text)
    assert.equal(await readJsonState(file, 'state', Array.isArray), undefined)
    const [backup] = (await readdir(folder)).filter(entry => entry.startsWith(`${name}.corrupt-`))
    assert.equal(await readFile(path.join(folder, backup), 'utf8'), text)
  }
})

test('a state file that cannot be read rejects, so callers cannot save over it', async t => {
  const folder = await directory(t)
  const file = path.join(folder, 'state.json')
  await mkdir(file)
  await assert.rejects(readJsonState(file, 'state'), { code: 'EISDIR' })
  assert.deepEqual(await readdir(folder), ['state.json'])
})
