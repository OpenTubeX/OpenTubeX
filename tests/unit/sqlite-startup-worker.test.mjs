import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'
import model from '@seald-io/nedb/lib/model.js'

for (const failure of [null, 'history', 'settings']) {
  test(`startup worker preserves read-only configuration and gates live writes, failure: ${failure}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'opentubex-startup-worker-'))
    t.after(() => rm(directory, { recursive: true, force: true }))
    const setting = { _id: 'theme', value: 'dark', unknown: { date: new Date(123), text: '$$foo' } }
    const originals = {
      'settings.db': failure === 'settings' ? '{bad settings}\n' : model.serialize(setting),
      'history.db': failure === 'history' ? '{bad history}\n' : model.serialize({ _id: 'history', videoId: 'video', unknown: new Date(456) }),
      'playlists.db': model.serialize({ _id: 'large', videos: Array.from({ length: 2000 }, (_, index) => ({ videoId: `video-${index}`, unknown: index })) }),
      'tab-session.db': model.serialize({ _id: 'window', value: { tabs: [], unknown: ['keep', null] } }),
    }
    for (const [file, data] of Object.entries(originals)) await writeFile(join(directory, file), data)
    const script = `
      import assert from 'node:assert/strict'
      import { parentPort, workerData } from 'node:worker_threads'
      const { getLibrary, localCollection, readStartupLibrary } = await import(workerData.instance)
      const initialization = getLibrary()
      initialization.catch(() => {})
      let activated = false
      initialization.then(() => { activated = true }, () => {})
      let writeFinished = false
      const settings = localCollection('settings')
      const pendingWrite = settings.updateAsync({ _id: 'theme' }, { $set: { value: 'light' } })
      pendingWrite.then(() => { writeFinished = true }, () => {})
      let preview
      if (workerData.failure !== 'settings') {
        preview = await readStartupLibrary(async () => {
          assert.equal(activated, false)
          assert.equal(writeFinished, false)
          const result = await settings.findOneAsync({ _id: 'theme' })
          for (const method of ['insertAsync', 'updateAsync', 'removeAsync']) {
            await assert.rejects(settings[method]({ _id: 'theme' }, { $set: { value: 'lost' } }), /read-only/)
          }
          await assert.rejects(async () => await localCollection('history').findAsync({}), /unavailable/)
          const sessions = await localCollection('tabSession').findAsync({})
          assert.deepEqual(sessions, [{ _id: 'window', value: { tabs: [], unknown: ['keep', null] } }])
          return result
        })
      }
      if (!workerData.failure) {
        const listed = await readStartupLibrary(() => settings.findAsync({}))
        assert.equal(activated, false, 'a returned lazy cursor must retain the startup context')
        assert.equal(writeFinished, false)
        assert.deepEqual(listed, [preview])
      }
      if (workerData.failure) {
        await assert.rejects(initialization, /Cannot migrate/)
        await assert.rejects(pendingWrite, /Cannot migrate/)
        await assert.rejects(readStartupLibrary(() => settings.findOneAsync({ _id: 'theme' })), /Cannot migrate/)
        parentPort.postMessage({ preview, activated, writeFinished })
      } else {
        const engine = await initialization
        await pendingWrite
        const live = await readStartupLibrary(() => settings.findOneAsync({ _id: 'theme' }))
        parentPort.postMessage({ preview, live, activated, writeFinished })
        engine.database.close()
      }
    `
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(script)}`), {
      workerData: { directory, failure, instance: new URL('../../src/datastores/sqlite/instance.js', import.meta.url).href },
    })
    t.after(() => worker.terminate())
    const [result] = await once(worker, 'message')
    if (failure !== 'settings') assert.deepEqual(result.preview, setting)
    if (failure) {
      assert.equal(result.activated, false)
      assert.equal(result.writeFinished, false)
      await assert.rejects(readFile(join(directory, 'library.sqlite')), { code: 'ENOENT' })
    } else {
      assert.deepEqual(result.live, { ...setting, value: 'light' })
      assert.equal(result.activated, true)
      assert.equal(result.writeFinished, true)
    }
    for (const [file, original] of Object.entries(originals)) assert.equal(await readFile(join(directory, file), 'utf8'), original)
  })
}
