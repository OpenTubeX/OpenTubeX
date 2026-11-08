// @ts-check
import dbus from 'dbus-native'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fitPictureInPictureBounds } from './pictureInPictureBounds.js'

const KWIN_SERVICE = 'org.kde.KWin'
const KWIN_SCRIPTING_PATH = '/Scripting'
const KWIN_SCRIPTING_INTERFACE = 'org.kde.kwin.Scripting'
const REPORT_PATH = '/io/github/OpenTubeX/KWinPictureInPicture'
const REPORT_INTERFACE = 'io.github.OpenTubeX.KWinPictureInPicture'

/**
 * Builds the KWin script that restores and reports the bounds of this
 * process's Picture-in-Picture windows. KWin creates a new window each time
 * one shows, so the script also keeps the bounds for the rest of the session.
 *
 * @param {{
 *   processId: number,
 *   destination: string,
 *   saved: import('./pictureInPictureBounds.js').Rect | null
 * }} options
 */
export function createKwinPictureInPictureScript({ processId, destination, saved }) {
  const report = [destination, REPORT_PATH, REPORT_INTERFACE, 'ReportBounds'].map(value => JSON.stringify(value)).join(', ')
  return `
const fit = ${fitPictureInPictureBounds}
let saved = ${JSON.stringify(saved)}
const rect = geometry => ({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height })
const workAreas = () => workspace.screens.map(output => rect(workspace.clientArea(KWin.MaximizeArea, output, workspace.currentDesktop)))
const report = window => {
  saved = rect(window.frameGeometry)
  callDBus(${report}, Math.round(saved.x), Math.round(saved.y), Math.round(saved.width), Math.round(saved.height))
}
const restore = window => {
  const bounds = saved && fit(saved, rect(window.frameGeometry), workAreas())
  if (bounds) {
    // Wayland applies a resize after the client agrees to it and drops a
    // move that comes with it, so move first.
    window.frameGeometry = { x: bounds.x, y: bounds.y, width: window.frameGeometry.width, height: window.frameGeometry.height }
    window.frameGeometry = bounds
  }
  window.frameGeometryChanged.connect(() => {
    if (!window.move && !window.resize) report(window)
  })
  window.interactiveMoveResizeFinished.connect(() => report(window))
}
// Chromium's Picture-in-Picture window is the only window of the app without a
// desktop file name. Its caption is translated, and on Wayland it is only
// kept above others by a window rule.
const track = window => {
  if (window.pid === ${processId} && window.desktopFileName === '' && window.normalWindow) restore(window)
}
workspace.windowList().forEach(track)
workspace.windowAdded.connect(track)
`
}

/**
 * Restores Picture-in-Picture bounds through KWin, which can place windows on
 * Wayland, where Chromium cannot.
 *
 * @param {{
 *   store: ReturnType<typeof import('./pictureInPictureBounds.js').createPictureInPictureBoundsStore>,
 *   processId?: number
 * }} options
 * @returns {Promise<(() => Promise<void>) | null>} closes the backend
 */
export async function startKwinPictureInPictureBounds({ store, processId = process.pid }) {
  let bus
  let directory
  let scripting
  const pluginName = `opentubex-picture-in-picture-${processId}`
  try {
    bus = dbus.sessionBus({ timeout: 2_000 })
    bus.connection.on('error', () => {})
    scripting = await bus.getService(KWIN_SERVICE).getInterface(KWIN_SCRIPTING_PATH, KWIN_SCRIPTING_INTERFACE)
    if (typeof bus.name !== 'string') throw new Error('D-Bus connection has no unique name')

    bus.exportInterface({
      ReportBounds: (x, y, width, height) => {
        store.save({ x, y, width, height })
        return null
      }
    }, REPORT_PATH, {
      name: REPORT_INTERFACE,
      methods: { ReportBounds: ['dddd', '', ['x', 'y', 'width', 'height'], []] },
      signals: {},
      properties: {}
    })

    directory = await mkdtemp(join(tmpdir(), 'opentubex-kwin-pip-'))
    const file = join(directory, 'picture-in-picture.js')
    await writeFile(file, createKwinPictureInPictureScript({ processId, destination: bus.name, saved: await store.load() }), 'utf8')
    await scripting.unloadScript(pluginName).catch(() => {})
    const scriptId = await bus.invoke({
      destination: KWIN_SERVICE,
      path: KWIN_SCRIPTING_PATH,
      interface: KWIN_SCRIPTING_INTERFACE,
      member: 'loadScript',
      signature: 'ss',
      body: [file, pluginName]
    })
    if (!Number.isInteger(scriptId) || scriptId < 0) throw new Error('KWin rejected the Picture-in-Picture script')
    await scripting.start()

    const connectedBus = bus
    const scriptDirectory = directory
    const loadedScripting = scripting
    return async () => {
      await loadedScripting.unloadScript(pluginName).catch(() => {})
      await rm(scriptDirectory, { force: true, recursive: true }).catch(() => {})
      await connectedBus.close().catch(() => {})
    }
  } catch {
    await scripting?.unloadScript(pluginName).catch(() => {})
    if (directory !== undefined) await rm(directory, { force: true, recursive: true }).catch(() => {})
    await bus?.close().catch(() => {})
    return null
  }
}
