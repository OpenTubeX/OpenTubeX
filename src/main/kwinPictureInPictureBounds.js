// @ts-check
import dbus from 'dbus-native'

import { createKwinScriptFile, createKwinWindowOwnerCheck, getKwinScriptPluginName, getKwinWindowOwner } from './kwinScripts.js'
import { fitPictureInPictureBounds } from './pictureInPictureBounds.js'

const KWIN_SERVICE = 'org.kde.KWin'
const KWIN_SCRIPTING_PATH = '/Scripting'
const KWIN_SCRIPTING_INTERFACE = 'org.kde.kwin.Scripting'
const REPORT_PATH = '/io/github/OpenTubeX/KWinPictureInPicture'
const REPORT_INTERFACE = 'io.github.OpenTubeX.KWinPictureInPicture'

/**
 * Builds the KWin script that keeps the owner's Picture-in-Picture windows
 * above others on all desktops, and restores and reports their bounds. KWin
 * creates a new window each time one shows, so the script also keeps the
 * bounds for the rest of the session.
 *
 * @param {{
 *   owner: import('./kwinScripts.js').KwinWindowOwner,
 *   destination: string,
 *   saved: import('./pictureInPictureBounds.js').Rect | null
 * }} options
 */
export function createKwinPictureInPictureScript({ owner, destination, saved }) {
  const report = [destination, REPORT_PATH, REPORT_INTERFACE, 'ReportBounds'].map(value => JSON.stringify(value)).join(', ')
  return `
const fit = ${fitPictureInPictureBounds}
const isOwn = ${createKwinWindowOwnerCheck(owner)}
let saved = ${JSON.stringify(saved)}
const rect = geometry => ({ x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height })
const workAreas = () => workspace.screens.map(output => rect(workspace.clientArea(KWin.MaximizeArea, output, workspace.currentDesktop)))
const report = window => {
  saved = rect(window.frameGeometry)
  callDBus(${report}, Math.round(saved.x), Math.round(saved.y), Math.round(saved.width), Math.round(saved.height))
}
const restore = window => {
  let placed = null
  const place = bounds => {
    placed = bounds
    window.frameGeometry = bounds
  }
  const bounds = saved && fit(saved, rect(window.frameGeometry), workAreas())
  if (bounds) {
    // Wayland applies a resize after the client agrees to it and drops a
    // move that comes with it, so move first.
    place({ x: bounds.x, y: bounds.y, width: window.frameGeometry.width, height: window.frameGeometry.height })
    place(bounds)
  }
  // Only report where the user puts the window, not where the script or
  // Chromium does.
  window.frameGeometryChanged.connect(old => {
    if (window.move || window.resize) return
    const current = rect(window.frameGeometry)
    if (current.width !== old.width || current.height !== old.height) {
      // Chromium resizes the window for a video with another aspect ratio,
      // and may adjust the size the script asked for.
      const moved = saved && fit(saved, current, workAreas(), true)
      if (moved) place(moved)
    } else if (!placed || Math.abs(current.x - placed.x) >= 1 || Math.abs(current.y - placed.y) >= 1) {
      placed = null
      report(window)
    }
  })
  window.interactiveMoveResizeFinished.connect(() => {
    placed = null
    report(window)
  })
}
// Chromium's Picture-in-Picture window has no desktop file name, and Chromium
// keeps it smaller than the screen. Electron's detached DevTools window has no
// desktop file name either, but no maximum size. The caption is translated,
// and without an app ID users can't match the window with a window rule.
const fitsOnScreen = size => workspace.screens.some(output => size.width <= output.geometry.width && size.height <= output.geometry.height)
const track = window => {
  if (window.desktopFileName === '' && window.normalWindow && fitsOnScreen(window.maxSize) && isOwn(window)) {
    // Chromium asks for this on other platforms, but Wayland ignores it
    window.keepAbove = true
    window.onAllDesktops = true
    restore(window)
  }
}
workspace.windowList().forEach(track)
workspace.windowAdded.connect(track)
`
}

/**
 * Restores Picture-in-Picture bounds and keeps the window above others through
 * KWin, which can place windows on Wayland, where Chromium cannot.
 *
 * @param {{
 *   store: ReturnType<typeof import('./pictureInPictureBounds.js').createPictureInPictureBoundsStore>,
 *   environment?: NodeJS.ProcessEnv
 * }} options
 * @returns {Promise<(() => Promise<void>) | null>} closes the backend
 */
export async function startKwinPictureInPictureBounds({ store, environment = process.env }) {
  const owner = getKwinWindowOwner(environment)
  let bus
  let scriptFile
  let scripting
  const pluginName = getKwinScriptPluginName('opentubex-picture-in-picture', owner)
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

    scriptFile = await createKwinScriptFile('picture-in-picture.js', environment)
    await scriptFile.write(createKwinPictureInPictureScript({ owner, destination: bus.name, saved: await store.load() }))
    await scripting.unloadScript(pluginName).catch(() => {})
    const scriptId = await bus.invoke({
      destination: KWIN_SERVICE,
      path: KWIN_SCRIPTING_PATH,
      interface: KWIN_SCRIPTING_INTERFACE,
      member: 'loadScript',
      signature: 'ss',
      body: [scriptFile.path, pluginName]
    })
    if (!Number.isInteger(scriptId) || scriptId < 0) throw new Error('KWin rejected the Picture-in-Picture script')
    await scripting.start()

    const connectedBus = bus
    const loadedScriptFile = scriptFile
    const loadedScripting = scripting
    return async () => {
      await loadedScripting.unloadScript(pluginName).catch(() => {})
      await loadedScriptFile.remove()
      await connectedBus.close().catch(() => {})
    }
  } catch {
    await scripting?.unloadScript(pluginName).catch(() => {})
    await scriptFile?.remove()
    await bus?.close().catch(() => {})
    return null
  }
}
