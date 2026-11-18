import assert from 'node:assert/strict'
import test from 'node:test'
import Datastore from '@seald-io/nedb'
import { updateSettingIfUnchanged } from '../../src/datastores/settingRepair.js'

test('a stale theme repair preserves a newer stored selection', async () => {
  const db = new Datastore()
  await db.insertAsync({ _id: 'systemDarkTheme', value: 'custom:paper' })
  const original = await db.findOneAsync({ _id: 'systemDarkTheme' })
  await db.updateAsync({ _id: original._id }, { $set: { value: 'solarizedDark' } })

  assert.equal(await updateSettingIfUnchanged(db, original._id, original.value, 'dark'), false)
  assert.equal((await db.findOneAsync({ _id: original._id })).value, 'solarizedDark')
})

test('a theme repair updates its unchanged selection without inserting missing settings', async () => {
  const db = new Datastore()
  await db.insertAsync({ _id: 'systemLightTheme', value: 'dark' })
  assert.equal(await updateSettingIfUnchanged(db, 'systemLightTheme', 'dark', 'light'), true)
  assert.equal((await db.findOneAsync({ _id: 'systemLightTheme' })).value, 'light')
  assert.equal(await updateSettingIfUnchanged(db, 'systemDarkTheme', 'light', 'dark'), false)
  assert.equal(await db.countAsync({}), 1)
})
