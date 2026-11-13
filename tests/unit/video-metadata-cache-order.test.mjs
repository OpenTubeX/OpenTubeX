import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const documents = []
globalThis.__videoMetadataDocuments = documents

const matches = (doc, query) => Object.entries(query).every(([key, value]) =>
  value?.$exists === undefined ? doc[key] === value : (key in doc) === value.$exists)

// An in-memory stand-in for the datastore, with the calls the cache makes.
const datastoreModule = `
const documents = globalThis.__videoMetadataDocuments
const matches = ${matches}
let nextId = 0
export const settings = {}
export const videoMetadataCache = {
  findAsync: query => ({
    sort: ({ cachedAt }) => Promise.resolve(documents.filter(doc => matches(doc, query))
      .map(doc => ({ ...doc })).sort((a, b) => (a.cachedAt - b.cachedAt) * cachedAt))
  }),
  findOneAsync: async query => documents.find(doc => matches(doc, query)) ?? null,
  insertAsync: async doc => { const stored = { _id: String(nextId++), ...doc }; documents.push(stored); return { ...stored } },
  updateAsync: async ({ _id }, { $set }) => { Object.assign(documents.find(doc => doc._id === _id), $set); return 1 }
}`
const stubs = {
  electron: 'export const app = {}, BrowserWindow = {}, ipcMain = {}, net = {}, session = {}',
  '../datastores': datastoreModule,
  '../datastores/sqliteNode': 'export const desktopDatastorePaths = {}',
  './castMediaServer': 'export const fetchCastMedia = null, resolveCastMediaAddresses = null',
  './utils': 'export const isNonPublicNetworkAddress = null, isOpenTubeXUrl = null'
}

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/src/main/videoMetadataCache.js') && specifier in stubs) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}` }
    }
    if (specifier.startsWith('.') && !specifier.endsWith('.js') && !specifier.endsWith('.mjs')) {
      return nextResolve(`${specifier}.js`, context)
    }
    return nextResolve(specifier, context)
  }
})
const { updateVideoMetadataCache } = await import('../../src/main/videoMetadataCache.js')
hooks.deregister()

test('a late older observation does not replace metadata that a newer one confirmed', async () => {
  const observe = (title, observedAt) => updateVideoMetadataCache({
    videoId: 'video000001', title, description: '', thumbnailUrl: '', thumbnail: null, observedAt
  })

  await observe('Title A', 1000)
  await observe('Title A', 3000)
  // Another tab fetched an older title and finished last.
  await observe('Title B', 2000)
  assert.deepEqual(documents.map(doc => doc.title), ['Title A'])

  const history = await observe('Title B', 4000)
  assert.deepEqual(history.revisions.map(revision => revision.title), ['Title A', 'Title B'],
    'a genuinely newer change is still recorded')
})
