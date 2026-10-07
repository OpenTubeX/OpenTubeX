import { randomBytes } from 'node:crypto'
import { CastSender, discoverCastDevices } from './castSender.js'
import { createCastMediaServer } from './castMediaServer.js'
import { ChromecastSession } from '../chromecastSession.js'

export { castSourceAvailable } from '../chromecastSession.js'

/** Electron owns each renderer's native sender and media relay. */
export class ChromecastManager extends ChromecastSession {
  constructor(executable, powerSaveBlocker) {
    super({
      discover: () => discoverCastDevices(executable),
      createSender: device => new CastSender(executable, device),
      createMedia: ({ source, deviceAddress, token, getHeaders, isAllowedUrl, fetchMedia }) =>
        createCastMediaServer(source, deviceAddress, token, getHeaders, isAllowedUrl, fetchMedia),
      randomId: () => randomBytes(24).toString('hex'),
      powerSaveBlocker
    })
  }
}
