import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import Datastore from '@seald-io/nedb'

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
    DEFAULT_PROFILE_ICON,
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
    load: () => module.actions.grabAllProfiles({
      rootState: { settings: { defaultProfile: 'second' } },
      state: module.state,
      commit: (mutation, value) => module.mutations[mutation](module.state, value)
    })
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
