import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import { createDesktopDatastore } from '../../src/datastores/sqliteNode.js'

const source = await readFile(new URL('../../src/datastores/handlers/base.js', import.meta.url), 'utf8')
const db = { tabSession: createDesktopDatastore(':memory:') }
globalThis.tabSessionHandlers = vm.runInNewContext(
  source.slice(source.indexOf('class TabSession {'), source.indexOf('\nlet profilesLoadPromise')) + '\nTabSession',
  { db }
)

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/datastores/handlers/base.js')) {
      return { shortCircuit: true, url: 'data:text/javascript,export const tabSession = globalThis.tabSessionHandlers' }
    }
    return nextResolve(specifier, context)
  }
})
const { loadAllTabSessions, replaceAllTabSessions } = await import('../../src/main/tabs/TabSessionStore.js')
hooks.deregister()
test.after(() => db.tabSession.driver.close())

const tabs = url => [{ id: 'tab', url, title: url }]

async function reset(t) {
  await db.tabSession.removeAsync({}, { multi: true })
  await db.tabSession.insertAsync([
    { _id: 'old-a', value: { activeTabId: 'tab', tabs: tabs('https://example.com/a') } },
    { _id: 'old-b', value: { activeTabId: 'tab', tabs: tabs('https://example.com/b') } },
  ])
  t.mock.method(console, 'error', () => {})
}

const savedUrls = async () => Object.fromEntries((await loadAllTabSessions())
  .map(session => [session.sessionId, session.tabs[0].url]))

test('replaceAllTabSessions saves the new sessions and drops sessions that are not part of them', async (t) => {
  await reset(t)

  assert.equal(await replaceAllTabSessions([
    { sessionId: 'old-a', activeTabId: 'tab', tabs: tabs('https://example.com/synced-a') },
    { sessionId: 'new', activeTabId: 'tab', tabs: tabs('https://example.com/new') },
  ]), true)

  assert.deepEqual(await savedUrls(), {
    new: 'https://example.com/new',
    'old-a': 'https://example.com/synced-a',
  })
})

test('replaceAllTabSessions reports a failed write and keeps every saved session', async (t) => {
  await reset(t)

  assert.equal(await replaceAllTabSessions([
    { sessionId: 'old-a', activeTabId: 'tab', tabs: tabs('https://example.com/synced-a') },
    // The datastore rejects field names with a dot
    { sessionId: 'new', activeTabId: 'tab', tabs: [{ ...tabs('https://example.com/new')[0], 'invalid.field': true }] },
  ]), false)

  assert.deepEqual(await savedUrls(), {
    'old-a': 'https://example.com/a',
    'old-b': 'https://example.com/b',
  })
})
