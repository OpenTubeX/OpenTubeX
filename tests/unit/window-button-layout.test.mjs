import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../../src/main/windowButtonLayout.js', import.meta.url), 'utf8')

/** A session bus whose portal answers once `available` is set. */
function fixture () {
  const timers = []
  const connections = []
  const portal = { available: false, layout: 'close,minimize,maximize:', handlers: [], busAddress: true, gate: null, readGate: null, readError: null }
  const dbus = {
    sessionBus () {
      if (!portal.busAddress) throw new Error('unknown bus address')
      const connection = { ended: false, on () {}, end () { this.ended = true } }
      connections.push(connection)
      return {
        connection,
        getService: () => ({
          getInterface: async () => {
            await portal.gate
            if (!portal.available) throw new Error('org.freedesktop.portal.Desktop was not provided by any .service files')
            return {
              on: (name, handler) => portal.handlers.push(handler),
              ReadOne: async () => { const layout = portal.layout; await portal.readGate; if (portal.readError) throw portal.readError; return layout }
            }
          }
        })
      }
    }
  }
  const context = vm.createContext({ dbus, setTimeout: (callback, delay) => { timers.push({ callback, delay }); return {} } })
  vm.runInContext(source.replace(/^import .*\n/m, '').replace(/^export /gm, '') +
    '\nglobalThis.api = { getWindowButtonLayout, onWindowButtonLayoutChanged }', context)
  return { ...context.api, timers, connections, portal }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

test('a portal that starts after the app still provides the real button layout', async () => {
  const layout = fixture()
  const published = []
  layout.onWindowButtonLayoutChanged(value => published.push(value))

  assert.equal(await layout.getWindowButtonLayout(), ':minimize,maximize,close')
  assert.equal(layout.connections[0].ended, true, 'A failed connection is closed')
  // Requests meanwhile never wait for D-Bus again
  assert.equal(await layout.getWindowButtonLayout(), ':minimize,maximize,close')
  assert.equal(layout.connections.length, 1)

  layout.portal.available = true
  layout.timers.shift().callback()
  await flush()
  assert.deepEqual(published, ['close,minimize,maximize:'])
  assert.equal(await layout.getWindowButtonLayout(), 'close,minimize,maximize:')
  assert.equal(layout.connections[1].ended, false)

  // The successful connection follows later changes
  layout.portal.handlers[0]('org.gnome.desktop.wm.preferences', 'button-layout', 'close:')
  assert.deepEqual(published, ['close,minimize,maximize:', 'close:'])
  assert.equal(await layout.getWindowButtonLayout(), 'close:')
  assert.equal(layout.timers.length, 0)
})

test('without a portal, retries stop and the default layout stays', async () => {
  const layout = fixture()
  const published = []
  layout.onWindowButtonLayoutChanged(value => published.push(value))
  await layout.getWindowButtonLayout()

  const delays = []
  while (layout.timers.length > 0) {
    const timer = layout.timers.shift()
    delays.push(timer.delay)
    timer.callback()
    await flush()
  }
  assert.deepEqual(delays, [3000, 10000, 30000])
  assert.deepEqual(published, [])
  assert.equal(await layout.getWindowButtonLayout(), ':minimize,maximize,close')
  assert.ok(layout.connections.every(connection => connection.ended))
})

test('a session without a D-Bus address keeps the default layout', async () => {
  const layout = fixture()
  layout.portal.busAddress = false
  assert.equal(await layout.getWindowButtonLayout(), ':minimize,maximize,close')
  assert.equal(layout.timers.length, 1)
})

test('windows get the default layout while a retry waits for the portal', async () => {
  const layout = fixture()
  await layout.getWindowButtonLayout()
  let answer
  layout.portal.gate = new Promise(resolve => { answer = resolve })
  layout.timers.shift().callback()

  let resolved = null
  layout.getWindowButtonLayout().then(value => { resolved = value })
  await flush()
  assert.equal(resolved, ':minimize,maximize,close')

  layout.portal.available = true
  answer()
  await flush()
  assert.equal(await layout.getWindowButtonLayout(), 'close,minimize,maximize:')
})

test('a change signalled while the first read is pending wins over the read', async () => {
  const layout = fixture()
  layout.portal.available = true
  let answer
  layout.portal.readGate = new Promise(resolve => { answer = resolve })
  const first = layout.getWindowButtonLayout()
  await flush()
  layout.portal.handlers[0]('org.gnome.desktop.wm.preferences', 'button-layout', 'close:')
  answer()
  assert.equal(await first, 'close:')
  assert.equal(await layout.getWindowButtonLayout(), 'close:')
})

test('a retry does not overwrite a newer layout signalled during its read', async () => {
  const layout = fixture()
  const published = []
  layout.onWindowButtonLayoutChanged(value => published.push(value))
  await layout.getWindowButtonLayout()

  layout.portal.available = true
  let answer
  layout.portal.readGate = new Promise(resolve => { answer = resolve })
  layout.timers.shift().callback()
  await flush()
  layout.portal.handlers[0]('org.gnome.desktop.wm.preferences', 'button-layout', 'close:')
  answer()
  await flush()
  assert.deepEqual(published, ['close:'])
  assert.equal(await layout.getWindowButtonLayout(), 'close:')
})

test('a change signalled before the read fails is kept', async () => {
  const layout = fixture()
  layout.portal.available = true
  layout.portal.readError = new Error('Timeout')
  let answer
  layout.portal.readGate = new Promise(resolve => { answer = resolve })
  const first = layout.getWindowButtonLayout()
  await flush()
  layout.portal.handlers[0]('org.gnome.desktop.wm.preferences', 'button-layout', 'close:')
  answer()
  assert.equal(await first, 'close:')
  assert.equal(await layout.getWindowButtonLayout(), 'close:')
  assert.equal(layout.connections[0].ended, true)
  assert.equal(layout.timers.length, 1)
})
