import assert from 'node:assert/strict'
import test from 'node:test'
import { numberSyncMessage, readSynced, writeSynced } from '../../src/main/datastoreSync.js'

const settle = () => new Promise(resolve => setImmediate(resolve))

test('a full read reflects exactly the changes numbered up to the revision it returns', async () => {
  const events = []
  let finishWrite
  const write = writeSynced(['profiles', 'settings'], async () => {
    await new Promise(resolve => { finishWrite = resolve })
    return numberSyncMessage({}).revision
  })
  let finishRead
  const read = readSynced('profiles', async () => {
    events.push('read')
    await new Promise(resolve => { finishRead = resolve })
  })
  const laterWrite = writeSynced(['profiles'], async () => {
    events.push('later write')
    return numberSyncMessage({}).revision
  })
  // Other datastores' reads and writes do not wait.
  assert.equal((await writeSynced(['history'], async () => 'history')), 'history')
  await settle()
  assert.deepEqual(events, [], 'The read must wait for the running change')

  finishWrite()
  const revision = await write
  await settle()
  assert.deepEqual(events, ['read'], 'A change requested during the read must wait for it')

  finishRead()
  assert.equal((await read).revision, revision)
  assert.ok(await laterWrite > revision)
  assert.deepEqual(events, ['read', 'later write'])
})
