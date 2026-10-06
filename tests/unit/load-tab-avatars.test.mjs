import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { mapConcurrently } from '../../src/renderer/helpers/concurrent-map.js'

const source = readFileSync(new URL('../../src/renderer/helpers/loadTabAvatars.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from '[^']+'\n/gm, '')
  .replace(/^export /gm, '')

for (const [backend, failFirst] of [['local', false], ['invidious', false], ['local', true], ['invidious', true]]) {
  test(`overlapping ${backend} avatar loads share four slots${failFirst ? ' when a download fails' : ' through image downloading'}`, async () => {
    const releases = []
    let releaseAll = false
    let active = 0
    let maximumActive = 0
    let started = 0
    const errors = []
    const context = vm.createContext({
      console: { error: (...args) => errors.push(args) },
      store: { getters: { getBackendPreference: backend, getBackendFallback: false } },
      getTabAvatarUrl: tab => tab.avatarUrl ?? null,
      mapConcurrently,
      getLocalVideoInfo: async () => ({ info: { avatar: 'https://images.test/avatar.png' } }),
      getLocalVideoAvatarUrl: info => info.avatar,
      invidiousGetVideoInformation: async () => ({ authorThumbnails: [{ url: 'https://images.test/avatar.png' }] }),
      youtubeImageUrlToInvidious: url => url,
      fetchTabAvatarBytes: async () => {
        const requestNumber = ++started
        active++
        maximumActive = Math.max(maximumActive, active)
        try {
          if (!releaseAll) await new Promise(resolve => releases.push(resolve))
          if (failFirst && requestNumber === 1) throw new Error('Avatar download failed')
          return new ArrayBuffer(1)
        } finally {
          active--
        }
      },
      window: { ftElectron: { tabs: { updateAvatar: async () => true } } }
    })
    vm.runInContext(source, context)
    const tabs = Array.from({ length: 6 }, (_, index) => ({ id: `tab-${index}`, route: { path: `/watch/video-${index}` } }))
    const first = context.loadMissingTabAvatars(tabs.slice(0, 3))
    const second = context.loadMissingTabAvatars(tabs.slice(3))
    try {
      await new Promise(setImmediate)
      assert.equal(started, 4, 'the second call must wait for the first call’s occupied slots')
      assert.equal(active, 4)

      releases.shift()()
      await new Promise(setImmediate)
      assert.equal(started, 5, 'a queued request starts as soon as one image download finishes')
      assert.equal(active, 4)
    } finally {
      releaseAll = true
      for (const release of releases) release()
      await Promise.all([first, second])
    }
    assert.equal(started, 6)
    assert.equal(maximumActive, 4)
    assert.equal(active, 0)
    const results = await Promise.all([first, second])
    assert.equal(results[0].loaded, failFirst ? 2 : 3)
    assert.equal(results[0].failed, failFirst ? 1 : 0)
    assert.equal(results[1].loaded, 3)
    assert.equal(results[1].failed, 0)
    assert.equal(errors.length, failFirst ? 1 : 0)
  })
}
