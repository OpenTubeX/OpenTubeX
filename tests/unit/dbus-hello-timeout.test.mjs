import assert from 'node:assert/strict'
import { once } from 'node:events'
import net from 'node:net'
import test from 'node:test'
import dbus from 'dbus-native'

test('a session bus that never answers Hello reports a connection error instead of crashing', async t => {
  // Authenticates, then stays silent, like a session bus still busy at login
  const server = net.createServer(socket => {
    socket.on('error', () => {})
    socket.on('data', data => {
      const text = data.toString('latin1')
      if (text.includes('AUTH')) socket.write('OK 0123456789abcdef0123456789abcdef\r\n')
      if (text.includes('NEGOTIATE_UNIX_FD')) socket.write('ERROR\r\n')
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const bus = dbus.sessionBus({ busAddress: `tcp:host=127.0.0.1,port=${server.address().port}`, timeout: 100 })
  const [error] = await once(bus.connection, 'error')
  await once(bus.connection, 'close')

  assert.equal(error.name, 'TimeoutError')
  assert.match(error.message, /org\.freedesktop\.DBus\.Hello/)
})
