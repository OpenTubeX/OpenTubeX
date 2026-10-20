// Runs the desktop library databases off the main process.
import { parentPort } from 'node:worker_threads'
import { createNodeSqliteDriver } from './sqliteNodeDriver.js'

const drivers = new Map()

function driver(filename, backupDirectory) {
  let instance = drivers.get(filename)
  if (!instance) {
    instance = createNodeSqliteDriver(filename, backupDirectory)
    drivers.set(filename, instance)
  }
  return instance
}

parentPort.on('message', async ({ id, method, filename, backupDirectory, statements, transaction }) => {
  try {
    const start = performance.now()
    const target = driver(filename, backupDirectory)
    const result = method === 'execute' ? await target.execute(statements, transaction) : await target[method]()
    const duration = performance.now() - start
    if (duration > 1000) console.warn('[DEBUG-startup-database]', JSON.stringify({ filename, method, transaction, duration, statements: statements?.map(([sql]) => sql) }))
    if (method === 'drop' || method === 'close') drivers.delete(filename)
    parentPort.postMessage({ id, result })
  } catch (error) {
    parentPort.postMessage({ id, error: { message: error?.message ?? String(error), code: error?.code } })
  }
})
