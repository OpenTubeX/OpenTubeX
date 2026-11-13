// Preloaded by sqlite-datastore.test.mjs. Runs NeDB-backed handler tests
// against SqliteDatastore, through an asynchronous driver like on mobile and
// web, with its member-row and index paths enabled.
import { registerHooks } from 'node:module'

const sqliteModule = new URL('../../src/datastores/sqlite.js', import.meta.url).href
const nodeModule = new URL('../../src/datastores/sqliteNode.js', import.meta.url).href
const shim = `
import { SqliteDatastore } from ${JSON.stringify(sqliteModule)}
import { createNodeSqliteDriver } from ${JSON.stringify(nodeModule)}
function slow(driver) {
  return { ...driver, execute: (statements, transaction) => new Promise(resolve => setTimeout(resolve, 0)).then(() => driver.execute(statements, transaction)) }
}
export default class Datastore extends SqliteDatastore {
  constructor({ filename } = {}) {
    super({ driver: slow(createNodeSqliteDriver(filename ? filename + '.sqlite' : ':memory:')), childField: 'videos', indexes: ['videoId'] })
  }
}`

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@seald-io/nedb' && context.parentURL?.includes('/tests/unit/')) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(shim)}` }
    }
    return nextResolve(specifier, context)
  }
})
