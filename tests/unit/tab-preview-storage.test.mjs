import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createTabPreviewFileName } from '../../src/main/tabs/tabPreviewCache.js'

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') return { shortCircuit: true, url: 'data:text/javascript,export const app = {}' }
    return nextResolve(specifier, context)
  }
})
const { TabPreviewStorage } = await import('../../src/main/tabs/TabPreviewStorage.js')
hooks.deregister()

async function storageFor(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tab-preview-storage-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return new TabPreviewStorage(() => directory)
}

test('preview storage replaces cached bytes atomically and shares avatar files', async t => {
  const storage = await storageFor(t)
  const first = await storage.writePreview(Buffer.from('first'))
  assert.equal(await storage.writePreview(Buffer.from('second'), first), first)
  assert.equal(await readFile(join(storage.directory(), first), 'utf8'), 'second')
  const avatar = await storage.writeAvatar(Buffer.from('avatar'))
  assert.equal(await storage.writeAvatar(Buffer.from('avatar')), avatar)
  assert.equal(await storage.read(avatar), 'data:image/jpeg;base64,YXZhdGFy')
  assert.equal((await readdir(storage.directory())).length, 2)
  assert.equal(await storage.read('../outside'), null)
})

test('preview storage cleans temporary files after a failed rename', async t => {
  const storage = await storageFor(t)
  const name = createTabPreviewFileName()
  await mkdir(join(storage.directory(), name))
  await assert.rejects(storage.writePreview(Buffer.from('replacement'), name))
  assert.deepEqual(await readdir(storage.directory()), [name])
})

test('preview storage replaces old PNG entries and prunes only unreferenced cache files', async t => {
  const storage = await storageFor(t)
  const old = createTabPreviewFileName().replace('.jpg', '.png')
  await writeFile(join(storage.directory(), old), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  assert.ok((await storage.read(old)).startsWith('data:image/png;'))
  const current = await storage.writePreview(Buffer.from('jpeg'), old)
  assert.notEqual(current, old)
  assert.equal(await storage.read(old), null)
  const orphan = await storage.writeAvatar(Buffer.from('orphan'))
  await writeFile(join(storage.directory(), 'unrelated.txt'), 'keep')
  assert.equal(await storage.startPrune([current]), 1)
  assert.equal(await storage.read(orphan), null)
  assert.deepEqual((await readdir(storage.directory())).sort(), [current, 'unrelated.txt'].sort())
})

test('preview and avatar writes wait for startup pruning', async t => {
  const storage = await storageFor(t)
  let finishPrune
  t.mock.method(storage, 'prune', () => new Promise(resolve => { finishPrune = resolve }))
  const pruning = storage.startPrune([])
  const writes = Promise.all([
    storage.writePreview(Buffer.from('preview')),
    storage.writeAvatar(Buffer.from('avatar'))
  ])
  await new Promise(setImmediate)
  assert.deepEqual(await readdir(storage.directory()), [])
  finishPrune(0)
  await pruning
  assert.equal((await writes).length, 2)
  assert.equal((await readdir(storage.directory())).length, 2)
})
