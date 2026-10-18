import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createDesktopDatastore } from '../../src/datastores/sqliteNode.js'

const datastore = createDesktopDatastore(':memory:')
globalThis.__settingsMigrationDatastore = datastore
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../index' && context.parentURL?.endsWith('/datastores/handlers/base.js')) {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,' + encodeURIComponent(`
          export const settings = globalThis.__settingsMigrationDatastore;
          export const recommendations = {};
        `),
      }
    }
    if (specifier.startsWith('.') && !specifier.endsWith('.js')) return nextResolve(`${specifier}.js`, context)
    return nextResolve(specifier, context)
  },
})
const { settings } = await import('../../src/datastores/handlers/base.js')
hooks.deregister()
delete globalThis.__settingsMigrationDatastore
test.after(() => datastore.driver.close())
test.beforeEach(async () => {
  settings.migrationPromise = null
  await datastore.removeAsync({}, { multi: true })
})

test('concurrent settings reads and backups migrate once before accepting newer preferences', async t => {
  await datastore.insertAsync({ _id: 'defaultTheatreMode', value: true })
  const reachedLegacy = Promise.withResolvers()
  const release = Promise.withResolvers()
  const findOne = datastore.findOneAsync.bind(datastore)
  let legacyReads = 0
  t.mock.method(datastore, 'findOneAsync', async query => {
    const saved = await findOne(query)
    if (query._id === 'defaultTheatreMode') {
      legacyReads++
      reachedLegacy.resolve()
      await release.promise
    }
    return saved
  })
  const read = settings.find()
  const backup = settings.migrate()
  await reachedLegacy.promise
  let writeFinished = false
  const write = settings.upsert('defaultViewingMode', 'default').then(() => { writeFinished = true })
  await new Promise(resolve => setImmediate(resolve))
  const finishedBeforeMigration = writeFinished
  release.resolve()
  await Promise.all([read, backup, write])
  assert.equal((await findOne({ _id: 'defaultViewingMode' })).value, 'default')
  assert.equal(legacyReads, 1)
  assert.equal(finishedBeforeMigration, false)
  assert.equal(await findOne({ _id: 'defaultTheatreMode' }), null)
})

test('a failed settings migration rejects dependent writes and can be retried', async t => {
  await datastore.insertAsync({ _id: 'defaultTheatreMode', value: true })
  const failRead = t.mock.method(datastore, 'findOneAsync', async () => { throw new Error('storage unavailable') })
  await assert.rejects(settings.upsert('defaultViewingMode', 'default'), /storage unavailable/)
  failRead.mock.restore()
  assert.equal(await datastore.findOneAsync({ _id: 'defaultViewingMode' }), null)
  await settings.upsert('defaultViewingMode', 'default')
  assert.equal((await datastore.findOneAsync({ _id: 'defaultViewingMode' })).value, 'default')
  assert.equal(await datastore.findOneAsync({ _id: 'defaultTheatreMode' }), null)
})

test('completed migrations add no legacy lookups to subsequent settings saves', async t => {
  await datastore.insertAsync({ _id: 'currentLocale', value: 'en_GB' })
  const findOne = datastore.findOneAsync.bind(datastore)
  let reads = 0
  t.mock.method(datastore, 'findOneAsync', (...args) => { reads++; return findOne(...args) })
  await settings.migrate()
  const migrationReads = reads
  assert.equal((await findOne({ _id: 'currentLocale' })).value, 'en-GB')
  await settings.upsert('autoplayVideos', false)
  await settings.upsert('defaultViewingMode', 'theatre')
  await settings.find()
  await settings.migrate()
  assert.equal(reads, migrationReads)
  assert.equal((await findOne({ _id: 'autoplayVideos' })).value, false)
})
