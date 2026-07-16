import { IpcChannels } from '../../constants.js'

const MAX_QUEUED_MESSAGES = 100
const COALESCED_CHANNELS = new Set([IpcChannels.TABS_STATE_UPDATED])

/**
 * Queues main-to-renderer tab messages until the BrowserWindow's single
 * renderer has finished bootstrapping its tab runtime.
 */
export class TabRendererBridge {
  /**
   * @param {import('electron').BrowserWindow} browserWindow
   */
  constructor(browserWindow) {
    this.browserWindow = browserWindow
    this.ready = false
    /** @type {Array<{channel: string, args: unknown[]}>} */
    this.queue = []

    browserWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) {
        this.ready = false
      }
    })

    browserWindow.webContents.once('destroyed', () => {
      this.ready = false
      this.queue = []
    })
  }

  markReady() {
    if (this.ready || this.browserWindow.webContents.isDestroyed()) {
      return
    }

    this.ready = true
    const messages = this.queue
    this.queue = []

    for (const { channel, args } of messages) {
      this.browserWindow.webContents.send(channel, ...args)
    }
  }

  /**
   * @param {string} channel
   * @param {...unknown} args
   */
  send(channel, ...args) {
    if (this.browserWindow.webContents.isDestroyed()) {
      return
    }

    if (this.ready) {
      this.browserWindow.webContents.send(channel, ...args)
      return
    }

    // State snapshots supersede older queued snapshots. Commands and deep-link
    // messages must retain ordering, even when several arrive during startup.
    if (COALESCED_CHANNELS.has(channel)) {
      const existingIndex = this.queue.findIndex(message => message.channel === channel)
      if (existingIndex !== -1) {
        this.queue.splice(existingIndex, 1)
      }
    }

    this.queue.push({ channel, args })
    if (this.queue.length > MAX_QUEUED_MESSAGES) {
      this.queue.shift()
    }
  }
}

export default TabRendererBridge
