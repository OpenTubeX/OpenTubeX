import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { createStore } from 'vuex'
import { hasConfiguredRestrictedPlaybackAuthentication } from '../../src/renderer/helpers/restricted-playback.js'

const subscriptionsSource = await readFile(new URL('../../src/renderer/helpers/subscriptions.js', import.meta.url), 'utf8')
const visibilityStart = subscriptionsSource.indexOf('export function isVideoHiddenByPreferences(')
const isVideoHiddenByPreferences = vm.compileFunction(
  `${subscriptionsSource.slice(visibilityStart, subscriptionsSource.indexOf('\n}\n', visibilityStart) + 2).replace('export ', '')}\nreturn isVideoHiddenByPreferences`,
  ['isUpcomingPremiere', 'isOnAiSlopList']
)(() => false, () => false)

async function membersOnlyStore(authMode) {
  const code = (await readFile(new URL('../../src/renderer/store/modules/profiles.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from '[^']+'\n/gm, '')
    .replace('export default', 'const module =')
  const profiles = vm.runInNewContext(`${code}\nmodule`, {
    MAIN_PROFILE_ID: 'allChannels', THEME_BG_COLOR: '#000000', THEME_TEXT_COLOR: '#ffffff', DEFAULT_PROFILE_ICON: {},
    hasConfiguredRestrictedPlaybackAuthentication: getters => hasConfiguredRestrictedPlaybackAuthentication(getters, true, false),
  })
  const settings = {
    state: { authMode },
    getters: {
      getYtDlpPlaybackAuthMode: state => state.authMode,
      getYtDlpPlaybackCookiesPath: () => '/fixture/cookies.txt',
      getYtDlpPlaybackCookiesBrowser: () => '',
    },
    mutations: { setAuthMode(state, value) { state.authMode = value } },
  }
  const store = createStore({ modules: { profiles, settings } })
  store.commit('setProfileList', [
    { _id: 'allChannels', name: 'All Channels', subscriptions: [{ id: 'shown', showMembersOnly: true }, { id: 'subscribed' }] },
    { _id: 'work', name: 'Work', subscriptions: [{ id: 'subscribed' }] },
  ])
  store.commit('setActiveProfile', 'work')
  return store
}

test('shows members-only videos only for subscriptions that enable them once playback can authenticate', async () => {
  const store = await membersOnlyStore('none')
  assert.deepEqual([...store.getters.getMembersOnlyChannelIdSet], [])

  store.commit('setAuthMode', 'file')
  assert.deepEqual([...store.getters.getMembersOnlyChannelIdSet], ['shown'])
})

test('hides members-only videos from channels without the subscription setting', () => {
  const membersOnlyChannelIds = new Set(['shown'])
  const isHidden = video => isVideoHiddenByPreferences({ title: 'Video', ...video }, { membersOnlyChannelIds })

  assert.equal(isHidden({ authorId: 'shown', isMembersOnly: true }), false)
  assert.equal(isHidden({ authorId: 'subscribed', isMembersOnly: true }), true)
  assert.equal(isHidden({ authorId: 'unsubscribed', isMembersOnly: true }), true)
  assert.equal(isHidden({ authorId: 'unsubscribed' }), false)
  assert.equal(isHidden({ authorId: null, isMembersOnly: true, collaborators: [{ id: 'shown' }, { id: 'guest' }] }), false)
  // Lists of the user's own videos opt out of the filter
  assert.equal(isVideoHiddenByPreferences({ authorId: 'unsubscribed', isMembersOnly: true }), false)
})
