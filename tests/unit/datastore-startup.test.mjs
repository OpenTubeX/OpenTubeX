import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const calls = []
globalThis.__datastoreStartupCalls = calls

const datastoreNames = [
  'settings', 'history', 'watchStats', 'recommendations', 'profiles',
  'playlists', 'searchHistory', 'subscriptionCache', 'tabSession',
  'liveReminders', 'videoMetadataCache'
]
const datastoreModule = datastoreNames.map(name =>
  `export const ${name} = {
    loadDatabaseAsync() { globalThis.__datastoreStartupCalls.push('${name}'); return Promise.resolve() },
    updateAsync() { return Promise.resolve(0) },
    findAsync() { return Promise.resolve([]) }
  }`
).join('\n')

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../index' && context.parentURL?.endsWith('/datastores/handlers/base.js')) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(datastoreModule)}` }
    }
    if (specifier.startsWith('.') && !specifier.endsWith('.js')) {
      return nextResolve(`${specifier}.js`, context)
    }
    return nextResolve(specifier, context)
  }
})
const { loadDatastores, loadDeferredDatastores, profiles } = await import('../../src/datastores/handlers/base.js')
hooks.deregister()

test('startup leaves the large datastores until after the window appears', async () => {
  await loadDatastores()
  assert.deepEqual(calls, ['settings', 'tabSession'])

  await profiles.find()
  assert.deepEqual(calls, ['settings', 'tabSession', 'profiles'],
    'a new session loads profiles only when choosing its landing tab')
  calls.length = 0
  await loadDeferredDatastores()
  assert.deepEqual(calls, datastoreNames.filter(name => !['settings', 'tabSession', 'profiles'].includes(name)))
})
