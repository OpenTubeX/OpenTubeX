import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { EventEmitter } from 'node:events'
import { isIP } from 'node:net'

const execFileAsync = promisify(execFile)
export const CAST_CONNECTION = 'urn:x-cast:com.google.cast.tp.connection'
export const CAST_RECEIVER = 'urn:x-cast:com.google.cast.receiver'
export const CAST_MEDIA = 'urn:x-cast:com.google.cast.media'

export async function discoverCastDevices(executable) {
  const { stdout } = await execFileAsync(executable, ['discover'], { timeout: 6000, maxBuffer: 256_000, windowsHide: true })
  const devices = JSON.parse(stdout)
  if (!Array.isArray(devices)) throw Object.assign(new Error('Invalid Cast discovery response'), { code: 'CAST_DISCOVERY_FAILED' })
  return devices.filter(device => typeof device.id === 'string' && device.id.length <= 256 &&
    typeof device.name === 'string' && device.name.length <= 256 && isIP(device.address) === 4 &&
    Number.isInteger(device.port) && device.port > 0 && device.port <= 65535)
}

/** The helper keeps native Cast networking out of the renderer. */
export class CastSender extends EventEmitter {
  constructor(executable, device) {
    super()
    this.nextId = 1
    this.pending = new Map()
    this.closed = false
    this.process = spawn(executable, [device.address, String(device.port)], { windowsHide: true })
    // Keep stderr drained without logging stream URLs or device details.
    this.process.stderr.resume()
    this.process.stdin.on('error', () => this.close())
    this.process.on('error', error => this.close(error))
    this.process.on('close', () => this.close())
    this.lines = createInterface({ input: this.process.stdout })
    this.lines.on('line', line => {
      try {
        const message = JSON.parse(line)
        if (message.event === 'error' && typeof message.error === 'string' && message.error.length > 0) {
          const error = new Error(message.error.slice(0, 512))
          if (message.code === 'CAST_UNTRUSTED_CERTIFICATE') error.code = message.code
          this.close(error)
          return
        }
        if (message.event === 'connected') this.emit('connected', message.address)
        if (message.event !== 'message') return
        const pending = this.pending.get(message.payload?.requestId)
        if (pending && pending.namespace === message.namespace) {
          this.pending.delete(message.payload.requestId)
          clearTimeout(pending.timer)
          const code = {
            INVALID_REQUEST: 'CAST_INVALID_REQUEST',
            LOAD_FAILED: 'CAST_LOAD_FAILED',
            LAUNCH_ERROR: 'CAST_LAUNCH_FAILED'
          }[message.payload.type]
          if (typeof code === 'string') {
            pending.reject(Object.assign(new Error(`Cast ${message.payload.type}`), { code }))
          } else {
            pending.resolve(message.payload)
          }
        }
        this.emit('message', message.namespace, message.payload)
      } catch { this.close() }
    })
  }

  connect() {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        this.removeListener('connected', connected)
        this.removeListener('closed', closed)
      }
      const connected = address => { cleanup(); resolve(address) }
      const closed = error => { cleanup(); reject(error) }
      const timer = setTimeout(() => { this.close(Object.assign(new Error('Cast device did not respond'), { code: 'CAST_TIMEOUT' })) }, 8000)
      this.once('connected', connected)
      this.once('closed', closed)
      if (this.closed) closed(this.closeError)
    })
  }

  send(namespace, destination, payload, wait = true) {
    if (this.closed) return Promise.reject(this.closeError)
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      if (wait) {
        const timer = setTimeout(() => {
          this.pending.delete(id)
          reject(Object.assign(new Error('Cast device did not respond'), { code: 'CAST_TIMEOUT' }))
        }, 8000)
        this.pending.set(id, { resolve, reject, timer, namespace })
      }
      this.process.stdin.write(`${JSON.stringify({ id, namespace, destination, payload })}\n`, error => {
        if (error) {
          this.close()
          if (!wait) reject(this.closeError)
        } else if (!wait) resolve()
      })
    })
  }

  close(error = Object.assign(new Error('Cast device disconnected'), { code: 'CAST_DISCONNECTED' })) {
    if (this.closed) return
    this.closed = true
    this.closeError = error
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.lines.close()
    this.process.kill()
    this.emit('closed', error)
  }
}
