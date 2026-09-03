import dbus from 'dbus-native'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const KDE_DESKTOP_PATTERN = /(?:^|[:;/_-])(?:kde|plasma(?:wayland)?)(?:$|[:;/_-])/i
const KWIN_SERVICE = 'org.kde.KWin'
const KWIN_SCRIPTING_PATH = '/Scripting'
const KWIN_SCRIPTING_INTERFACE = 'org.kde.kwin.Scripting'
const KWIN_ACTIVE_WINDOW_SCRIPT_PREFIX = 'opentubex-active-window'
const ACTIVE_WINDOW_REPORT_PATH = '/io/github/OpenTubeX/KWinActiveWindow'
const ACTIVE_WINDOW_REPORT_INTERFACE = 'io.github.OpenTubeX.KWinActiveWindow'
const ACTIVE_WINDOW_QUERY_TIMEOUT = 1_500
const KDE_DESKTOP_POPUP_CLASS = /(?:^|\.)(?:krunner|plasmashell)$/i
const WINDOW_SEARCH_TERM = 'OpenTubeX'

/**
 * @param {NodeJS.ProcessEnv} environment
 * @returns {boolean}
 */
export function isKdePlasmaDesktop(environment) {
  if (environment.KDE_FULL_SESSION === 'true') return true

  return [
    environment.XDG_CURRENT_DESKTOP,
    environment.XDG_SESSION_DESKTOP,
    environment.DESKTOP_SESSION,
  ].some(value => typeof value === 'string' && KDE_DESKTOP_PATTERN.test(value))
}

/**
 * @param {{
 *   platform: NodeJS.Platform,
 *   ozonePlatform: string,
 *   environment: NodeJS.ProcessEnv
 * }} options
 * @returns {boolean}
 */
export function isWaylandPlatform({ platform, ozonePlatform }) {
  return platform === 'linux' && ozonePlatform === 'wayland'
}

/**
 * @param {{
 *   platform: NodeJS.Platform,
 *   ozonePlatform: string,
 *   environment: NodeJS.ProcessEnv
 * }} options
 * @returns {boolean}
 */
function mayUseWayland({ platform, ozonePlatform, environment }) {
  if (platform !== 'linux' || ozonePlatform === 'x11') return false
  if (ozonePlatform === 'wayland') return true

  return environment.XDG_SESSION_TYPE === 'wayland' ||
    typeof environment.WAYLAND_DISPLAY === 'string'
}

/**
 * @param {{
 *   platform: NodeJS.Platform,
 *   ozonePlatform: string,
 *   environment: NodeJS.ProcessEnv
 * }} options
 * @returns {boolean}
 */
export function shouldMonitorKdeWaylandWindowState({
  platform,
  ozonePlatform,
  environment,
}) {
  return mayUseWayland({ platform, ozonePlatform, environment }) &&
    isKdePlasmaDesktop(environment)
}

/**
 * @typedef {{
 *   uuid: string,
 *   caption: string,
 *   minimized: boolean,
 *   pid: number,
 *   width: number,
 *   height: number
 * }} KwinWindowInfo
 */

/**
 * @typedef {{
 *   uuid: string,
 *   skipTaskbar: boolean,
 *   resourceClass: string
 * }} KwinActiveWindowInfo
 */

/**
 * @param {unknown} value
 * @returns {KwinWindowInfo | null}
 */
export function normalizeKwinWindowInfo(value) {
  if (value === null || typeof value !== 'object') return null

  const { uuid, caption, minimized, pid, width, height } = value
  const numericPid = typeof pid === 'bigint' ? Number(pid) : pid
  if (
    typeof uuid !== 'string' ||
    typeof caption !== 'string' ||
    typeof minimized !== 'boolean' ||
    !Number.isSafeInteger(numericPid) ||
    ![width, height].every(Number.isSafeInteger)
  ) {
    return null
  }

  return {
    uuid,
    caption,
    minimized,
    pid: numericPid,
    width,
    height,
  }
}

/**
 * @param {unknown} matches
 * @returns {string[]}
 */
export function extractKwinWindowHandles(matches) {
  if (!Array.isArray(matches)) return []

  return matches.flatMap(match => {
    const id = Array.isArray(match) ? match[0] : null
    const handle = typeof id === 'string'
      ? id.match(/^0_(\{[0-9a-f-]+\})$/i)?.[1]
      : null
    return handle === undefined || handle === null ? [] : [handle]
  })
}

/**
 * @param {KwinWindowInfo[]} previous
 * @param {KwinWindowInfo[]} current
 * @param {{ caption: string, bounds: Electron.Rectangle }} target
 * @returns {KwinWindowInfo | null}
 */
export function findNewlyMinimizedWindow(previous, current, target) {
  const previousByUuid = new Map(previous.map(window => [window.uuid, window]))
  const transitionedWindows = current.filter(window => (
    window.minimized &&
    previousByUuid.get(window.uuid)?.minimized === false
  ))
  const transitionedWindow = findMatchingWindow(transitionedWindows, target)
  if (transitionedWindow !== null) return transitionedWindow

  if (previous.length === 0) {
    return findMatchingWindow(current.filter(window => window.minimized), target)
  }

  return null
}

/**
 * BrowserWindow bounds and KWin frame geometry can differ by the server-side
 * decoration size. Native Wayland does not expose reliable window positions
 * to Electron, so use the size only when more than one minimized window has
 * the same caption.
 *
 * @param {KwinWindowInfo[]} windows
 * @param {{ caption: string, bounds: Electron.Rectangle }} target
 * @returns {KwinWindowInfo | null}
 */
function findMatchingWindow(windows, { caption, bounds }) {
  const maximumDecorationSize = 64
  const matchingWindows = windows.filter(window => window.caption === caption)
  if (matchingWindows.length === 1) return matchingWindows[0]

  const candidates = matchingWindows.flatMap(window => {
    const differences = [
      Math.abs(window.width - bounds.width),
      Math.abs(window.height - bounds.height),
    ]
    if (differences.some(difference => difference > maximumDecorationSize)) return []

    return [{ window, distance: differences.reduce((total, difference) => total + difference, 0) }]
  }).sort((left, right) => left.distance - right.distance)

  if (candidates.length === 0 || candidates[0].distance === candidates[1]?.distance) return null
  return candidates[0].window
}

/**
 * @param {import('dbus-native').DBusInterface} kwin
 * @param {string} uuid
 * @returns {Promise<KwinWindowInfo | null>}
 */
async function queryKwinWindow(kwin, uuid) {
  return normalizeKwinWindowInfo(await kwin.getWindowInfo(uuid))
}

/**
 * @param {import('dbus-native').DBusInterface} kwin
 * @param {import('dbus-native').DBusInterface} runner
 * @param {number} processId
 * @returns {Promise<KwinWindowInfo[]>}
 */
async function queryKwinWindows(kwin, runner, processId) {
  const handles = [...new Set(extractKwinWindowHandles(await runner.Match(WINDOW_SEARCH_TERM)))]
  const windows = await Promise.all(handles.map(handle => queryKwinWindow(kwin, handle)))

  return windows.filter(window => window?.pid === processId)
}

/**
 * Connect to KWin through the user's D-Bus session and verify the interfaces
 * used by the monitor.
 *
 * @returns {Promise<{
 *   close: () => Promise<void>,
 *   queryActiveWindow: () => Promise<KwinActiveWindowInfo | null>,
 *   queryWindow: (uuid: string) => Promise<KwinWindowInfo | null>,
 *   queryWindows: (processId: number) => Promise<KwinWindowInfo[]>
 * } | null>}
 */
export async function createKdeWaylandWindowStateBackend() {
  let bus
  let scriptDirectory

  try {
    bus = dbus.sessionBus({ reconnect: true, timeout: 2_000 })
    bus.connection.on('error', () => {})
    const service = bus.getService(KWIN_SERVICE)
    const [kwin, runner, scripting] = await Promise.all([
      service.getInterface('/KWin', 'org.kde.KWin'),
      service.getInterface('/WindowsRunner', 'org.kde.krunner1'),
      service.getInterface(KWIN_SCRIPTING_PATH, KWIN_SCRIPTING_INTERFACE),
    ])
    await runner.Match(WINDOW_SEARCH_TERM)
    if (typeof bus.name !== 'string') throw new Error('D-Bus connection has no unique name')

    scriptDirectory = await mkdtemp(join(tmpdir(), 'opentubex-kwin-'))
    const scriptPath = join(scriptDirectory, 'active-window.js')
    const scriptPluginName = `${KWIN_ACTIVE_WINDOW_SCRIPT_PREFIX}-${process.pid}`
    let activeWindowQueryId = 0
    let closed = false
    let pendingReport = null
    let queryQueue = Promise.resolve()

    // KWin's public getWindowInfo map omits activation state. A one-shot script
    // can read workspace.activeWindow without staying loaded between queries.
    const loadScript = (scriptPath, pluginName) => bus.invoke({
      destination: KWIN_SERVICE,
      path: KWIN_SCRIPTING_PATH,
      interface: KWIN_SCRIPTING_INTERFACE,
      member: 'loadScript',
      signature: 'ss',
      body: [scriptPath, pluginName],
    })

    bus.exportInterface({
      ReportActiveWindow: (requestId, uuid, skipTaskbar, resourceClass) => {
        if (pendingReport?.requestId === requestId) {
          pendingReport.resolve({ uuid, skipTaskbar, resourceClass })
        }
        return null
      },
    }, ACTIVE_WINDOW_REPORT_PATH, {
      name: ACTIVE_WINDOW_REPORT_INTERFACE,
      methods: {
        ReportActiveWindow: ['ssbs', '', ['requestId', 'uuid', 'skipTaskbar', 'resourceClass'], []],
      },
      signals: {},
      properties: {},
    })

    // A previous process may have exited while its one-shot script was running.
    await scripting.unloadScript(scriptPluginName).catch(() => {})

    /** @returns {Promise<KwinActiveWindowInfo | null>} */
    const runActiveWindowQuery = async () => {
      if (closed) return null

      const requestId = `${process.pid}-${++activeWindowQueryId}`
      const script = `
const activeWindow = workspace.activeWindow;
callDBus(
  ${JSON.stringify(bus.name)},
  ${JSON.stringify(ACTIVE_WINDOW_REPORT_PATH)},
  ${JSON.stringify(ACTIVE_WINDOW_REPORT_INTERFACE)},
  "ReportActiveWindow",
  ${JSON.stringify(requestId)},
  activeWindow ? activeWindow.internalId.toString() : "",
  activeWindow ? activeWindow.skipTaskbar : false,
  activeWindow ? activeWindow.resourceClass.toString() : ""
);
`
      await writeFile(scriptPath, script, 'utf8')

      try {
        const scriptId = await loadScript(scriptPath, scriptPluginName)
        if (!Number.isInteger(scriptId) || scriptId < 0) return null

        const scriptInterface = await service.getInterface(
          `${KWIN_SCRIPTING_PATH}/Script${scriptId}`,
          'org.kde.kwin.Script'
        )
        const report = new Promise(resolve => {
          const timeout = setTimeout(() => {
            if (pendingReport?.requestId === requestId) pendingReport = null
            resolve(null)
          }, ACTIVE_WINDOW_QUERY_TIMEOUT)
          pendingReport = {
            requestId,
            resolve: value => {
              clearTimeout(timeout)
              if (pendingReport?.requestId === requestId) pendingReport = null
              resolve(value)
            },
          }
        })
        await scriptInterface.run()
        return await report
      } finally {
        if (pendingReport?.requestId === requestId) {
          pendingReport.resolve(null)
        }
        await scripting.unloadScript(scriptPluginName).catch(() => {})
      }
    }

    /** @returns {Promise<KwinActiveWindowInfo | null>} */
    const queryActiveWindow = () => {
      const query = queryQueue.then(runActiveWindowQuery)
      queryQueue = query.catch(() => null)
      return query
    }

    return {
      close: async () => {
        closed = true
        pendingReport?.resolve(null)
        pendingReport = null
        await scripting.unloadScript(scriptPluginName).catch(() => {})
        bus.unexportInterface(ACTIVE_WINDOW_REPORT_PATH, ACTIVE_WINDOW_REPORT_INTERFACE)
        await rm(scriptDirectory, { force: true, recursive: true }).catch(() => {})
        await bus.close()
      },
      queryActiveWindow,
      queryWindow: uuid => queryKwinWindow(kwin, uuid),
      queryWindows: processId => queryKwinWindows(kwin, runner, processId),
    }
  } catch {
    if (scriptDirectory !== undefined) {
      await rm(scriptDirectory, { force: true, recursive: true }).catch(() => {})
    }
    await bus?.close().catch(() => {})
    return null
  }
}

/**
 * Electron does not receive KWin's compositor-driven minimize event on native
 * Wayland. Compare KWin state after blur, then poll only while minimized so a
 * restore is forwarded too.
 *
 * @param {{
 *   browserWindow: import('electron').BrowserWindow,
 *   backend: ReturnType<typeof createKdeWaylandWindowStateBackend>,
 *   applyWindowIdentity?: () => void,
 *   onFocusedState?: (focused: boolean) => void,
 *   onMinimizedState: (minimized: boolean) => void,
 *   releaseWindowIdentity?: () => void,
 *   processId?: number,
 *   detectionDelay?: number,
 *   pollInterval?: number
 * }} options
 * @returns {() => void}
 */
export function monitorKdeWaylandWindowState({
  browserWindow,
  backend,
  applyWindowIdentity = () => {},
  onFocusedState = () => {},
  onMinimizedState,
  releaseWindowIdentity = () => {},
  processId = process.pid,
  detectionDelay = 100,
  pollInterval = 1_000,
}) {
  let baseline = []
  let generation = 0
  let minimized = false
  let minimizedUuid = null
  let windowUuid = null
  let focusPollTimer = null
  let pollTimer = null
  let stopped = false

  const clearFocusPoll = () => {
    if (focusPollTimer !== null) clearTimeout(focusPollTimer)
    focusPollTimer = null
  }
  const clearPoll = () => {
    if (pollTimer !== null) clearTimeout(pollTimer)
    pollTimer = null
  }
  const setMinimized = value => {
    if (minimized === value) return
    minimized = value
    onMinimizedState(value)
  }
  const refreshBaseline = token => {
    const target = {
      caption: browserWindow.getTitle(),
      bounds: browserWindow.getBounds(),
    }
    const pending = backend.then(value => value?.queryWindows(processId) ?? [])
    pending.then(windows => {
      if (!stopped && generation === token && !minimized && browserWindow.isFocused()) {
        baseline = windows
        const window = findMatchingWindow(windows, target)
        if (window !== null) {
          windowUuid = window.uuid
          releaseWindowIdentity()
        }
      }
    }).catch(() => {})
    return pending
  }
  const schedulePoll = token => {
    clearPoll()
    if (stopped) return
    pollTimer = setTimeout(async () => {
      pollTimer = null
      if (stopped || generation !== token || minimizedUuid === null) return

      let window
      try {
        const value = await backend
        if (value === null) return
        window = await value.queryWindow(minimizedUuid)
      } catch {
        schedulePoll(token)
        return
      }
      if (stopped || generation !== token) return

      if (window?.minimized) {
        schedulePoll(token)
        return
      }

      minimizedUuid = null
      setMinimized(false)
      refreshBaseline(token).catch(() => {})
    }, pollInterval)
  }
  const isDesktopPopup = activeWindow => activeWindow !== null &&
    activeWindow.skipTaskbar &&
    KDE_DESKTOP_POPUP_CLASS.test(activeWindow.resourceClass)
  const isLogicallyFocused = (activeWindow, targetUuid) => (
    activeWindow !== null && activeWindow.uuid === targetUuid
  ) || isDesktopPopup(activeWindow)
  // Starting an app from the launcher does not blur this BrowserWindow again.
  // Keep checking until the popup closes or hands focus to an app. Some shell
  // popups leave the app's top-level KWin window active while Electron blurs.
  const scheduleFocusPoll = (token, targetUuid) => {
    clearFocusPoll()
    if (stopped) return

    focusPollTimer = setTimeout(async () => {
      focusPollTimer = null
      if (stopped || generation !== token) return

      let activeWindow = null
      try {
        const value = await backend
        if (value !== null) activeWindow = await value.queryActiveWindow()
      } catch {
        // Treat an unavailable compositor query as an ordinary focus loss.
      }
      if (stopped || generation !== token) return

      const desktopPopupActive = isDesktopPopup(activeWindow)
      const focused = isLogicallyFocused(activeWindow, targetUuid)
      onFocusedState(focused)
      if (desktopPopupActive) scheduleFocusPoll(token, targetUuid)
    }, pollInterval)
  }
  const handleFocus = () => {
    applyWindowIdentity()
    const token = ++generation
    clearFocusPoll()
    clearPoll()
    minimizedUuid = null
    setMinimized(false)
    onFocusedState(true)
    refreshBaseline(token).catch(() => {})
  }
  const handleBlur = async () => {
    applyWindowIdentity()
    const token = ++generation
    clearFocusPoll()
    clearPoll()

    const previous = baseline
    try {
      await new Promise(resolve => setTimeout(resolve, detectionDelay))
      if (stopped || generation !== token) return

      const value = await backend
      if (value === null) {
        releaseWindowIdentity()
        onFocusedState(false)
        return
      }
      applyWindowIdentity()
      const target = {
        caption: browserWindow.getTitle(),
        bounds: browserWindow.getBounds(),
      }
      const [current, activeWindow] = await Promise.all([
        value.queryWindows(processId),
        value.queryActiveWindow(),
      ])
      if (stopped || generation !== token) return

      baseline = current
      const matchedWindow = windowUuid === null
        ? findMatchingWindow(current, target)
        : current.find(window => window.uuid === windowUuid) ?? null
      const targetUuid = matchedWindow?.uuid ?? windowUuid
      const desktopPopupActive = isDesktopPopup(activeWindow)
      const focused = isLogicallyFocused(activeWindow, targetUuid)
      onFocusedState(focused)
      if (desktopPopupActive) scheduleFocusPoll(token, targetUuid)
      const previousByUuid = new Map(previous.map(window => [window.uuid, window]))
      const claimedWindow = windowUuid === null
        ? null
        : current.find(window => (
          window.uuid === windowUuid &&
          window.minimized &&
          (previous.length === 0 || previousByUuid.get(windowUuid)?.minimized === false)
        )) ?? null
      const window = claimedWindow ?? findNewlyMinimizedWindow(previous, current, target)
      if (window === null) return

      windowUuid = window.uuid
      releaseWindowIdentity()
      minimizedUuid = window.uuid
      setMinimized(true)
      schedulePoll(token)
    } catch {
      // A failed query disables this transition only. The next focus or blur
      // retries without affecting normal Electron window events.
      if (!stopped && generation === token) onFocusedState(false)
    }
  }
  const stop = () => {
    stopped = true
    generation++
    clearFocusPoll()
    clearPoll()
    browserWindow.removeListener('focus', handleFocus)
    browserWindow.removeListener('blur', handleBlur)
    browserWindow.removeListener('closed', stop)
  }

  browserWindow.on('focus', handleFocus)
  browserWindow.on('blur', handleBlur)
  browserWindow.once('closed', stop)
  refreshBaseline(generation).catch(() => {})

  return stop
}
