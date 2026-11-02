import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/datastores/handlers/base.js')) {
      return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(`
        export const tabSession = {
          docs: new Map(),
          failingIds: new Set(),
          async loadAll() {
            return Array.from(this.docs, ([sessionId, value]) => ({ sessionId, ...value }))
          },
          async save(id, data) {
            if (this.failingIds.has(id)) throw new Error('disk full')
            this.docs.set(id, structuredClone(data))
          },
          async clear(id) { this.docs.delete(id) },
          async clearAll() { this.docs.clear() }
        };
      `) }
    }
    return nextResolve(specifier, context)
  }
})
const { tabSession } = await import('../../src/datastores/handlers/base.js')
const { replaceAllTabSessions } = await import('../../src/main/tabs/TabSessionStore.js')
hooks.deregister()

const tabs = url => [{ id: 'tab', url, title: url }]

function reset(t, failingIds = []) {
  tabSession.docs = new Map([
    ['old-a', { activeTabId: 'tab', tabs: tabs('https://example.com/a') }],
    ['old-b', { activeTabId: 'tab', tabs: tabs('https://example.com/b') }],
  ])
  tabSession.failingIds = new Set(failingIds)
  t.mock.method(console, 'error', () => {})
}

test('replaceAllTabSessions saves the new sessions and drops sessions that are not part of them', async (t) => {
  reset(t)

  assert.equal(await replaceAllTabSessions([
    { sessionId: 'old-a', activeTabId: 'tab', tabs: tabs('https://example.com/synced-a') },
    { sessionId: 'new', activeTabId: 'tab', tabs: tabs('https://example.com/new') },
  ]), true)

  assert.deepEqual(Array.from(tabSession.docs.keys()).sort(), ['new', 'old-a'])
  assert.equal(tabSession.docs.get('old-a').tabs[0].url, 'https://example.com/synced-a')
})

test('replaceAllTabSessions reports a failed write and keeps the saved sessions', async (t) => {
  reset(t, ['new'])

  assert.equal(await replaceAllTabSessions([
    { sessionId: 'new', activeTabId: 'tab', tabs: tabs('https://example.com/new') },
  ]), false)

  assert.deepEqual(Array.from(tabSession.docs.keys()).sort(), ['old-a', 'old-b'])
})
