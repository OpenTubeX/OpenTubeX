import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'
import { babelParse, parse } from 'vue/compiler-sfc'

import { getValidSubscriptionChannels } from '../../src/renderer/helpers/subscription-channels.js'
import { DEFAULT_PROFILE_ICON } from '../../src/renderer/helpers/profileIcons.js'

const source = await readFile(new URL('../../src/renderer/store/modules/profiles.js', import.meta.url), 'utf8')
const handlers = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const mainProfile = {
  _id: 'allChannels', name: 'All Channels', bgColor: '#558B2F',
  icon: null, subscriptions: [{ id: 'channel' }]
}
const secondProfile = { _id: 'second', name: 'Second', icon: { type: 'initial' }, subscriptions: [] }

async function fixture(main = mainProfile) {
  const db = { profiles: new Datastore({ inMemoryOnly: true }) }
  await db.profiles.insertAsync([main, secondProfile])
  const errors = []
  const globals = {
    MAIN_PROFILE_ID: 'allChannels', THEME_BG_COLOR: '#000000', THEME_TEXT_COLOR: '#ffffff',
    DEFAULT_PROFILE_ICON, getValidSubscriptionChannels,
    console: { error: error => errors.push(error) }
  }
  const DBProfileHandlers = vm.runInNewContext(
    handlers.slice(handlers.indexOf('class Profiles {'), handlers.indexOf('class Playlists {')) + '\nProfiles',
    { ...globals, db, loadProfilesDatastore: async () => {} }
  )
  const context = vm.createContext({ ...globals, DBProfileHandlers })
  vm.runInContext(source
    .replace(/^import[\s\S]*? from ['"][^'"]+['"]\n/gm, '')
    .replace('export default {', 'globalThis.profileModule = {'), context)
  const module = context.profileModule
  return {
    db, module, errors,
    load: options => module.actions.grabAllProfiles({
      rootState: { settings: { defaultProfile: 'second' } },
      state: module.state,
      commit: (mutation, value) => module.mutations[mutation](module.state, value)
    }, options)
  }
}

for (const icon of [null, undefined]) {
  test(`persists a ${icon} default icon without changing other profile fields`, async () => {
    const { db, module, errors, load } = await fixture({ ...mainProfile, icon })
    const expected = [{ ...mainProfile, icon: DEFAULT_PROFILE_ICON }, secondProfile]
    for (let reload = 0; reload < 2; reload++) {
      assert.equal(await load(), true)
      assert.deepEqual(await db.profiles.findAsync({}), expected)
      assert.deepEqual(structuredClone(module.state.profileList), expected)
    }
    assert.deepEqual(errors, [])
  })
}

for (const icon of [null, { type: 'initial' }, { type: 'icon', value: 'gamepad' }]) {
  test(`default icon repair preserves concurrent subscriptions and icon ${JSON.stringify(icon)}`, async () => {
    const { db, module, load } = await fixture()
    const originalUpdate = db.profiles.updateAsync.bind(db.profiles)
    const newerProfile = { ...mainProfile, icon, subscriptions: [{ id: 'new-channel' }] }
    let firstUpdate = true
    db.profiles.updateAsync = async (...args) => {
      if (firstUpdate) {
        firstUpdate = false
        await originalUpdate({ _id: 'allChannels' }, newerProfile)
      }
      return originalUpdate(...args)
    }

    await load()

    const expected = { ...newerProfile, icon: icon ?? DEFAULT_PROFILE_ICON }
    assert.deepEqual(await db.profiles.findOneAsync({ _id: 'allChannels' }), expected)
    assert.deepEqual(structuredClone(module.state.profileList[0]), expected)
  })
}

test('loads existing profiles when persisting the default icon fails', async () => {
  const { db, module, errors, load } = await fixture()
  const writeError = new Error('Profile write failed')
  db.profiles.updateAsync = async () => { throw writeError }

  assert.equal(await load(), true)
  assert.deepEqual(structuredClone(module.state.profileList), [
    { ...mainProfile, icon: DEFAULT_PROFILE_ICON }, secondProfile
  ])
  assert.equal(module.state.activeProfile, 'second')
  assert.deepEqual(errors, [writeError])
})

test('restore profile refresh retains missing icons without repairing persisted records', async () => {
  const { db, module, load } = await fixture({ ...mainProfile, icon: null, unknown: new Date(1) })
  const before = await db.profiles.findAsync({})
  db.profiles.updateAsync = () => assert.fail('Unexpected profile repair')
  assert.equal(await load({ preserveRetained: true }), true)
  assert.deepEqual(await db.profiles.findAsync({}), before)
  assert.deepEqual(structuredClone(module.state.profileList), before.map(profile => ({ ...profile, icon: profile.icon ?? DEFAULT_PROFILE_ICON })))
})

test('restore of an empty profile store initializes the default successfully without using the options as its name', async () => {
  const { db, module, load } = await fixture()
  await db.profiles.removeAsync({}, { multi: true })
  assert.equal(await load({ preserveRetained: true }), false)
  const created = await db.profiles.findAsync({})
  assert.equal(created.length, 1)
  assert.equal(created[0].name, 'All Channels')
  assert.deepEqual(structuredClone(module.state.profileList), structuredClone(created))
})


for (const subscriptions of [null, false, [null, false, 42, 'retained', {}, { id: 42 }, { id: '' }, { id: 'channel', unknown: new Date(1) }]]) {
  test(`read-only profile lookup ignores opaque subscriptions without changing the cache or database: ${JSON.stringify(subscriptions)}`, async () => {
    const { db, module, load } = await fixture({ ...mainProfile, icon: DEFAULT_PROFILE_ICON, subscriptions, unknown: new Date(2) })
    assert.equal(await load({ preserveRetained: true }), true)
    const before = await db.profiles.findAsync({})
    const cached = structuredClone(module.state.profileList)
    const expected = Array.isArray(subscriptions) ? ['channel'] : []
    assert.deepEqual(Array.from(module.getters.getSubscribedChannelIdSet(module.state)), expected)
    assert.deepEqual(Array.from(module.getters.getSubscribedChannelsById(module.state).keys()), expected)
    assert.deepEqual(structuredClone(module.state.profileList), cached)
    assert.deepEqual(await db.profiles.findAsync({}), before)
  })
}


test('sidebar presentation skips opaque memberships and safely displays retained channel metadata without rewriting it', async () => {
  const valid = { id: 'channel', name: 'Example', thumbnail: 'https://example.test/avatar=s176', unknown: new Date(1) }
  const unsupportedMetadata = { id: 'other', name: 42, thumbnail: false, unknown: new Date(2) }
  const subscriptions = [null, false, 42, 'retained', {}, { id: 42 }, { id: '' }, valid, unsupportedMetadata]
  const original = { ...mainProfile, icon: DEFAULT_PROFILE_ICON, subscriptions, unknown: new Date(3) }
  const { db, load } = await fixture(original)
  await load({ preserveRetained: true })
  const before = await db.profiles.findOneAsync({ _id: 'allChannels' })
  const component = parse(await readFile(new URL('../../src/renderer/components/SideNav/SideNav.vue', import.meta.url), 'utf8')).descriptor
  const script = component.scriptSetup.content
  const ast = babelParse(script, { sourceType: 'module' })
  const init = ast.program.body.flatMap(node => node.declarations ?? []).find(node => node.id.name === 'activeSubscriptions').init
  const context = { computed: getter => ({ get value() { return getter() } }), activeProfile: { value: before }, getValidSubscriptionChannels, deepCopy: structuredClone, backendPreference: { value: 'local' }, locale: { value: 'en-US' } }
  const visible = vm.runInNewContext(script.slice(init.start, init.end), context).value
  assert.deepEqual(Array.from(visible, channel => channel.id).sort(), ['channel', 'other'])
  assert.equal(visible.find(channel => channel.id === 'channel').thumbnail, 'https://example.test/avatar=s35')
  assert.equal(visible.find(channel => channel.id === 'other').name, 'other')
  assert.equal(visible.find(channel => channel.id === 'other').thumbnail, null)
  assert.deepEqual(await db.profiles.findOneAsync({ _id: 'allChannels' }), before)
  assert.deepEqual(before, original)
})
