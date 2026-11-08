import { randomBytes } from 'node:crypto'
import { connect } from 'node:net'
import { createCastMediaServer } from './castMediaServer.js'
import { discoverCastDevices } from './castSender.js'
import { FcastSession } from '../fcastSession.js'

export { FcastOpcode } from '../fcastSession.js'

const MAX_SENT_PACKET_SIZE = 32_000
// Receivers may relay large play messages from other senders.
const MAX_RECEIVED_PACKET_SIZE = 512 * 1024

const castError = (message, code) => Object.assign(new Error(message), { code })

export function encodeFcastPacket(opcode, body) {
  const data = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body))
  if (data.length + 1 > MAX_SENT_PACKET_SIZE) throw castError('FCast message is too large', 'CAST_INVALID_REQUEST')
  const header = Buffer.alloc(5)
  header.writeUInt32LE(data.length + 1)
  header[4] = opcode
  return Buffer.concat([header, data])
}

/** Splits a stream into packets: a little-endian size, then an opcode and an optional JSON body. */
export function createFcastPacketReader(onPacket) {
  let buffered = Buffer.alloc(0)
  return chunk => {
    buffered = Buffer.concat([buffered, chunk])
    while (buffered.length >= 4) {
      const size = buffered.readUInt32LE(0)
      if (size < 1 || size > MAX_RECEIVED_PACKET_SIZE) throw new Error('Invalid FCast packet size')
      if (buffered.length < size + 4) return
      const opcode = buffered[4]
      const body = buffered.subarray(5, size + 4)
      buffered = buffered.subarray(size + 4)
      onPacket(opcode, body.length > 0 ? JSON.parse(body.toString()) : undefined)
    }
  }
}

export class FcastConnection {
  constructor(device, { onPacket, onClosed }, connectSocket = connect) {
    this.closed = false
    this.onClosed = onClosed
    this.socket = connectSocket({ host: device.address, port: device.port })
    this.socket.setNoDelay(true)
    const read = createFcastPacketReader(onPacket)
    this.socket.on('data', chunk => {
      try { read(chunk) } catch { this.close() }
    })
    // Socket errors end the session like a disconnect, without OS details.
    this.socket.on('error', () => this.close())
    this.socket.on('close', () => this.close())
  }

  /** Resolves with the local IPv4 address that reaches the receiver. */
  open() {
    if (this.closed) return Promise.reject(castError('FCast receiver did not respond', 'CAST_TIMEOUT'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(), 5000)
      this.socket.once('connect', () => { clearTimeout(timer); resolve(this.socket.localAddress) })
      this.socket.once('close', () => { clearTimeout(timer); reject(castError('FCast receiver did not respond', 'CAST_TIMEOUT')) })
    })
  }

  send(opcode, body) {
    if (this.closed) return Promise.reject(this.closeError)
    let packet
    try { packet = encodeFcastPacket(opcode, body) } catch (error) { return Promise.reject(error) }
    return new Promise((resolve, reject) => {
      this.socket.write(packet, error => error ? reject(this.closeError ?? error) : resolve())
    })
  }

  close(error = castError('FCast receiver disconnected', 'CAST_DISCONNECTED')) {
    if (this.closed) return
    this.closed = true
    this.closeError = error
    this.socket.destroy()
    this.onClosed(error)
  }
}

/** Electron owns each renderer's FCast connection and media relay. */
export class FcastManager extends FcastSession {
  constructor(executable, powerSaveBlocker, options = {}) {
    super({
      discover: () => discoverCastDevices(executable, 'discover-fcast'),
      createConnection: (device, handlers) => new FcastConnection(device, handlers),
      createMedia: ({ source, deviceAddress, token, getHeaders, isAllowedUrl, fetchMedia }) =>
        createCastMediaServer(source, deviceAddress, token, getHeaders, isAllowedUrl, fetchMedia),
      randomId: () => randomBytes(24).toString('hex'),
      powerSaveBlocker,
      ...options
    })
  }
}
