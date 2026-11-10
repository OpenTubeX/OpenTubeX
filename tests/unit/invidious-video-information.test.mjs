import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/renderer/helpers/api/invidious.js', import.meta.url), 'utf8')
const functionSource = source.match(/export async function invidiousGetVideoInformation\([\s\S]*?\n}\n/)[0]
  .replace(/^export /, '')

function getVideoInformation (response) {
  const fn = vm.runInNewContext(`${functionSource}; invidiousGetVideoInformation`, {
    isYatteeBackend: () => false,
    invidiousAPICall: async () => structuredClone(response),
    classifyInvidiousMusicMediaType: () => null,
  })
  return fn('jNQXAC9IVRw')
}

test('a missing YouTube microformat does not mark Invidious videos as age restricted', async () => {
  const video = await getVideoInformation({ isFamilyFriendly: false, genre: '', allowedRegions: [] })
  assert.equal(video.isFamilyFriendly, null)
})

test('Invidious family-friendly flags backed by a microformat are kept', async () => {
  for (const isFamilyFriendly of [true, false]) {
    const video = await getVideoInformation({ isFamilyFriendly, genre: 'Film & Animation', allowedRegions: ['US'] })
    assert.equal(video.isFamilyFriendly, isFamilyFriendly)
  }
})
