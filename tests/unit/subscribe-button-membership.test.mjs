import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { computed } from 'vue'
import { createStore } from 'vuex'

function source(path) {
  return readFileSync(new URL(`../../src/renderer/${path}`, import.meta.url), 'utf8')
}

function profilesStore() {
  const code = source('store/modules/profiles.js')
    .replace(/^import[\s\S]*?from '[^']+'\n/gm, '')
    .replace('export default', 'const module =')
  const module = vm.runInNewContext(`${code}\nmodule`, {
    MAIN_PROFILE_ID: 'allChannels', THEME_BG_COLOR: '#000000', THEME_TEXT_COLOR: '#ffffff', DEFAULT_PROFILE_ICON: {},
  })
  return createStore(module)
}

test('100 subscribe buttons share one scan of the active profile subscriptions', () => {
  const store = profilesStore()
  let reads = 0
  const subscriptions = Array.from({ length: 2000 }, (_, index) => ({
    get id() { reads++; return `channel-${index}` },
    name: `Channel ${index}`,
  }))
  store.commit('setProfileList', [
    { _id: 'allChannels', name: 'All Channels', subscriptions: [] },
    { _id: 'work', name: 'Work', subscriptions },
  ])
  store.commit('setActiveProfile', 'work')

  const code = source('components/FtSubscribeButton/FtSubscribeButton.vue')
  const membership = code.slice(code.indexOf('const isSubscribed ='), code.indexOf('const restrictedPlaybackConfigured ='))
  const buttons = Array.from({ length: 100 }, (_, index) => vm.runInNewContext(`${membership}\nisSubscribed`, {
    computed, store, props: { channelId: index % 2 === 0 ? `channel-${index}` : `missing-${index}` },
  }))

  assert.deepEqual(buttons.map(button => button.value), buttons.map((_, index) => index % 2 === 0))
  assert.equal(reads, 2000)

  store.commit('addChannelToProfiles', { channel: { id: 'missing-1', name: 'Added' }, profileIds: ['work'] })
  const readsBeforeButtons = reads
  assert.deepEqual(buttons.map(button => button.value), buttons.map((_, index) => index % 2 === 0 || index === 1))
  assert.equal(reads - readsBeforeButtons, 2000, 'all buttons must share the one recomputed id set')
})
