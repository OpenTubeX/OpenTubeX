import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { createVideoApi } from '../../src/renderer/helpers/api/createVideoApi.js'

const source = await readFile(new URL('../../src/renderer/views/Watch/watchVideoMetadata.js', import.meta.url), 'utf8')
const start = source.indexOf('  loadVideoInformation:')
const end = source.indexOf('\n  },', start)
const videoApi = createVideoApi({ loadLocal: async () => null, loadInvidious: async () => null })
const loadVideoInformation = runInNewContext(`({${source.slice(start, end)}\n} }).loadVideoInformation`, { videoApi })

test('reload awaits the selected Local loader', async () => {
  let resolveLocal
  const localFinished = new Promise(resolve => { resolveLocal = resolve })
  const calls = []
  const view = {
    backendPreference: 'local',
    getVideoInformationLocal(generation) { calls.push(['local', generation]); return localFinished },
    getVideoInformationInvidious() { assert.fail('Invidious was not selected') },
  }

  const loading = loadVideoInformation.call(view, 7)
  assert.deepEqual(calls, [['local', 7]])
  assert.equal(loading, localFinished)
  resolveLocal()
  await loading
})

test('initial load uses Invidious without waiting when Local is unavailable', () => {
  const calls = []
  const view = {
    backendPreference: 'local',
    getVideoInformationLocal() { assert.fail('Local is unavailable') },
    getVideoInformationInvidious(generation) { calls.push(['invidious', generation]); return new Promise(() => {}) },
  }

  assert.equal(loadVideoInformation.call(view, 8, { localAvailable: false, defaultProvider: 'local' }), undefined)
  assert.deepEqual(calls, [['invidious', 8]])
})

test('reload leaves an unrecognized provider preference untouched', () => {
  const view = {
    backendPreference: 'unknown',
    getVideoInformationLocal() { assert.fail('No provider selected') },
    getVideoInformationInvidious() { assert.fail('No provider selected') },
  }

  assert.equal(loadVideoInformation.call(view, 9), undefined)
})
