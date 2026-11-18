import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createDesktopDatastore } from '../../src/datastores/sqliteNode.js'
import { createSafeStorageCipher } from '../../src/datastores/secretCipher.js'
import { migrateSecretSettings } from '../../src/datastores/secretSettings.js'

const datastore = createDesktopDatastore(':memory:')
globalThis.__secretSettingsDatastore = datastore
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../index' && context.parentURL?.endsWith('/datastores/handlers/base.js')) {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,' + encodeURIComponent(`
          export const settings = globalThis.__secretSettingsDatastore;
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
delete globalThis.__secretSettingsDatastore
test.after(() => datastore.driver.close())

const ACCOUNT = { pageId: 'page', credentials: { access_token: 'access-secret', refresh_token: 'refresh-secret' } }

/** A cipher whose key is `key`. Values encrypted with another key do not decrypt. */
function cipher(key) {
  return {
    encrypt: async texts => texts.map(text => `${key}:${Buffer.from(text).toString('base64')}`),
    decrypt: async texts => texts.map(text => text.startsWith(`${key}:`) ? Buffer.from(text.slice(key.length + 1), 'base64').toString() : null),
  }
}

const stored = id => datastore.findOneAsync({ _id: id })
const saved = async () => Object.fromEntries((await settings.find()).map(({ _id, value }) => [_id, value]))

test.beforeEach(async t => {
  settings.migrationPromise = null
  await datastore.removeAsync({}, { multi: true })
  t.mock.method(console, 'warn', () => {})
  t.mock.method(console, 'error', () => {})
})

test('secret settings are saved encrypted and read back unchanged', async t => {
  t.mock.method(settings, 'cipher', () => Promise.resolve(cipher('device')))
  await settings.upsert('youTubeAccount', ACCOUNT)
  await settings.upsert('syncServerToken', 'sync-secret')
  await settings.upsert('syncServerUrl', 'https://sync.example')

  for (const id of ['youTubeAccount', 'syncServerToken']) {
    const doc = await stored(id)
    assert.equal(doc.value, undefined)
    assert.doesNotMatch(JSON.stringify(doc), /secret/)
  }
  assert.equal((await stored('syncServerUrl')).value, 'https://sync.example')
  assert.deepEqual(await saved(), { youTubeAccount: ACCOUNT, syncServerToken: 'sync-secret', syncServerUrl: 'https://sync.example' })
  assert.equal((await settings._findOne('syncServerToken')).value, 'sync-secret')
})

test('secrets saved unencrypted by an earlier version are encrypted on startup', async t => {
  await datastore.insertAsync([
    { _id: 'youTubeAccount', value: ACCOUNT },
    { _id: 'proxyPassword', value: 'proxy-secret' },
    { _id: 'yatteePassword', value: '' },
    { _id: 'proxyUsername', value: 'user' },
  ])
  t.mock.method(settings, 'cipher', () => Promise.resolve(cipher('device')))
  const vacuum = t.mock.method(datastore, 'vacuumAsync')
  const removeOlderCopies = t.mock.method(datastore, 'removeOlderCopiesAsync')

  assert.deepEqual(await saved(), { youTubeAccount: ACCOUNT, proxyPassword: 'proxy-secret', yatteePassword: '', proxyUsername: 'user' })
  for (const id of ['youTubeAccount', 'proxyPassword', 'yatteePassword']) {
    assert.equal(typeof (await stored(id)).encryptedValue, 'string')
  }
  assert.equal((await stored('proxyUsername')).value, 'user')
  // Rebuilding the file drops the old values from its free space.
  assert.equal(vacuum.mock.callCount(), 1)
  // The copies an older version reads lose them too.
  assert.equal(removeOlderCopies.mock.callCount(), 1)
})

test('the copies kept for older versions lose secrets and Invidious credentials, and keep the rest', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opentubex-secrets-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const [name, instance] of [
    ['with', 'https://user:instance-secret@invidious.example'],
    ['slashless', 'https:user:instance-secret@invidious.example'],
    ['with-tab', 'https:\t//user:instance-secret@invidious.example'],
    ['without', 'https://invidious.example/@path'],
    ['without-in-query', 'https://invidious.example?from=a@b'],
  ]) {
    const legacyFile = join(dir, `${name}.db`)
    await writeFile(legacyFile, [
      { _id: 'proxyPassword', value: 'proxy-secret' },
      { _id: 'defaultInvidiousInstance', value: instance },
      { _id: 'proxyUsername', value: 'user' },
    ].map(doc => JSON.stringify(doc)).join('\n') + '\n')
    const store = createDesktopDatastore(join(dir, `${name}.sqlite`), legacyFile)
    t.after(() => store.driver.close())
    await migrateSecretSettings(store, Promise.resolve(cipher('device')))
    const legacy = (await readFile(legacyFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line)._id)
    assert.deepEqual(legacy, name.startsWith('without') ? ['defaultInvidiousInstance', 'proxyUsername'] : ['proxyUsername'])
  }
})

test('Invidious credentials saved in the instance URL move to an encrypted setting on startup', async t => {
  await datastore.insertAsync({ _id: 'defaultInvidiousInstance', value: 'https://alice:p%40ss@invidious.example/' })
  t.mock.method(settings, 'cipher', () => Promise.resolve(cipher('device')))
  const vacuum = t.mock.method(datastore, 'vacuumAsync')

  const credentials = { instance: 'https://invidious.example', username: 'alice', password: 'p@ss' }
  assert.deepEqual(await saved(), { defaultInvidiousInstance: 'https://invidious.example', invidiousInstanceCredentials: credentials })
  assert.equal((await stored('defaultInvidiousInstance')).value, 'https://invidious.example')
  assert.doesNotMatch(JSON.stringify(await stored('invidiousInstanceCredentials')), /alice|p%40ss|p@ss/)
  assert.equal(vacuum.mock.callCount(), 1)
})

test('without a system keyring, secrets stay unencrypted', async t => {
  await datastore.insertAsync({ _id: 'proxyPassword', value: 'proxy-secret' })
  t.mock.method(settings, 'cipher', () => Promise.resolve(null))
  const removeOlderCopies = t.mock.method(datastore, 'removeOlderCopiesAsync')
  await settings.upsert('syncServerToken', 'sync-secret')
  // An older version keeps them, as this database has them unencrypted too.
  assert.equal(removeOlderCopies.mock.callCount(), 0)

  assert.deepEqual(await saved(), { proxyPassword: 'proxy-secret', syncServerToken: 'sync-secret' })
  assert.equal((await stored('proxyPassword')).value, 'proxy-secret')
  assert.equal((await stored('syncServerToken')).value, 'sync-secret')
})

test('secrets this device cannot decrypt are deleted once, and others are kept', async t => {
  t.mock.method(settings, 'cipher', () => Promise.resolve(cipher('other-computer')))
  await settings.upsert('syncServerToken', 'sync-secret')
  await settings.upsert('syncServerPrivacyKey', 'privacy-secret')
  await settings.upsert('syncServerUrl', 'https://sync.example')
  settings.migrationPromise = null
  t.mock.method(settings, 'cipher', () => Promise.resolve(cipher('device')))
  const remove = t.mock.method(datastore, 'removeAsync')

  assert.deepEqual(await saved(), { syncServerUrl: 'https://sync.example' })
  assert.equal(await stored('syncServerToken'), null)
  assert.equal(await stored('syncServerPrivacyKey'), null)
  assert.equal(remove.mock.callCount(), 2)
  assert.deepEqual(await saved(), { syncServerUrl: 'https://sync.example' })
  assert.equal(remove.mock.callCount(), 2)

  // Signing in again saves the new value with this device's key.
  await settings.upsert('syncServerToken', 'new-secret')
  assert.equal((await settings._findOne('syncServerToken')).value, 'new-secret')
})

test('encrypted secrets are kept while the keyring is unavailable', async t => {
  t.mock.method(settings, 'cipher', () => Promise.resolve(cipher('device')))
  await settings.upsert('proxyPassword', 'proxy-secret')
  settings.migrationPromise = null
  t.mock.method(settings, 'cipher', () => Promise.resolve(null))

  assert.deepEqual(await saved(), {})
  assert.equal(typeof (await stored('proxyPassword')).encryptedValue, 'string')
  settings.migrationPromise = null
  t.mock.method(settings, 'cipher', () => Promise.resolve(cipher('device')))
  assert.deepEqual(await saved(), { proxyPassword: 'proxy-secret' })
})

test('secrets are kept when the keyring cannot be reached', async t => {
  t.mock.method(settings, 'cipher', () => Promise.resolve(cipher('device')))
  await settings.upsert('syncServerToken', 'sync-secret')
  await datastore.insertAsync({ _id: 'proxyPassword', value: 'proxy-secret' })
  settings.migrationPromise = null
  t.mock.method(settings, 'cipher', () => Promise.reject(new Error('bridge unavailable')))

  assert.deepEqual(await saved(), { proxyPassword: 'proxy-secret' })
  assert.equal(typeof (await stored('syncServerToken')).encryptedValue, 'string')
  assert.equal((await stored('proxyPassword')).value, 'proxy-secret')
  settings.migrationPromise = null
  t.mock.method(settings, 'cipher', () => Promise.resolve(cipher('device')))
  assert.deepEqual(await saved(), { syncServerToken: 'sync-secret', proxyPassword: 'proxy-secret' })
})

test('safeStorage keeps secrets when the keyring stops being available', async () => {
  let available = true
  const safeStorage = {
    getSelectedStorageBackend: () => 'kwallet6',
    isEncryptionAvailable: () => available,
    encryptString: text => Buffer.from(`key:${text}`),
    decryptString: buffer => {
      const text = buffer.toString()
      if (!available || !text.startsWith('key:')) throw new Error('Error while decrypting')
      return text.slice('key:'.length)
    },
  }
  const cipher = await createSafeStorageCipher({ app: { whenReady: async () => {} }, safeStorage })
  const [encrypted] = await cipher.encrypt(['secret'])
  const foreign = Buffer.from('other-key').toString('base64')

  assert.deepEqual(await cipher.decrypt([encrypted, foreign]), ['secret', null])
  available = false
  await assert.rejects(cipher.decrypt([encrypted]))
})
