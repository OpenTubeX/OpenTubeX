import assert from 'node:assert/strict'
import { once } from 'node:events'
import net from 'node:net'
import test from 'node:test'
import dbus from 'dbus-native'

/** A session bus that authenticates, then stays silent, like one still busy at login. */
async function silentBus(t) {
  const sockets = []
  const server = net.createServer(socket => {
    sockets.push(socket)
    socket.on('error', () => {})
    socket.on('data', data => {
      const text = data.toString('latin1')
      if (text.includes('AUTH')) socket.write('OK 0123456789abcdef0123456789abcdef\r\n')
      if (text.includes('NEGOTIATE_UNIX_FD')) socket.write('ERROR\r\n')
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    for (const socket of sockets) socket.destroy()
    server.close()
  })
  return { address: `tcp:host=127.0.0.1,port=${server.address().port}`, sockets }
}

test('a session bus that never answers Hello reports a connection error instead of crashing', async t => {
  const { address } = await silentBus(t)
  const bus = dbus.sessionBus({ busAddress: address, timeout: 100 })
  let error
  bus.connection.on('error', value => { error = value })
  await new Promise(resolve => bus.connection.once('close', resolve))

  assert.equal(error.name, 'TimeoutError')
  assert.match(error.message, /org\.freedesktop\.DBus\.Hello/)
})

test('closing a reconnecting bus after Hello failed does not dial again', async t => {
  const { address } = await silentBus(t)
  const bus = dbus.sessionBus({ busAddress: address, reconnect: { minDelay: 50 }, timeout: 100 })
  bus.connection.on('error', () => {})
  // A regression would keep redialing and hold the test process open.
  const end = bus.connection.end.bind(bus.connection)
  t.after(() => end())
  await new Promise(resolve => bus.connection.once('close', resolve))
  // Under load, Hello can time out before the server even accepts the first
  // dial, so compare the socket itself rather than counting accepted ones.
  const stream = bus.connection.stream
  await bus.close()

  await new Promise(resolve => setTimeout(resolve, 200))
  assert.equal(bus.connection.stream, stream, 'the bus dialed a new socket after it was closed')
})
