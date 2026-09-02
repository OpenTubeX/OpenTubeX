import dbus from 'dbus-native'

const KDE_DESKTOP_PATTERN = /(?:^|[:;/_-])(?:kde|plasma(?:wayland)?)(?:$|[:;/_-])/i
const KWIN_SERVICE = 'org.kde.KWin'
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
 *   queryWindow: (uuid: string) => Promise<KwinWindowInfo | null>,
 *   queryWindows: (processId: number) => Promise<KwinWindowInfo[]>
 * } | null>}
 */
export async function createKdeWaylandWindowStateBackend() {
  let bus

  try {
    bus = dbus.sessionBus({ reconnect: true, timeout: 2_000 })
    bus.connection.on('error', () => {})
    const service = bus.getService(KWIN_SERVICE)
    const [kwin, runner] = await Promise.all([
      service.getInterface('/KWin', 'org.kde.KWin'),
      service.getInterface('/WindowsRunner', 'org.kde.krunner1'),
    ])
    await runner.Match(WINDOW_SEARCH_TERM)

    return {
      close: () => bus.close(),
      queryWindow: uuid => queryKwinWindow(kwin, uuid),
      queryWindows: processId => queryKwinWindows(kwin, runner, processId),
    }
  } catch {
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
  let pollTimer = null
  let stopped = false

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
  const handleFocus = () => {
    applyWindowIdentity()
    const token = ++generation
    clearPoll()
    minimizedUuid = null
    setMinimized(false)
    refreshBaseline(token).catch(() => {})
  }
  const handleBlur = async () => {
    applyWindowIdentity()
    const token = ++generation
    clearPoll()

    const previous = baseline
    try {
      await new Promise(resolve => setTimeout(resolve, detectionDelay))
      if (stopped || generation !== token) return

      const value = await backend
      if (value === null) {
        releaseWindowIdentity()
        return
      }
      applyWindowIdentity()
      const target = {
        caption: browserWindow.getTitle(),
        bounds: browserWindow.getBounds(),
      }
      const current = await value.queryWindows(processId)
      if (stopped || generation !== token) return

      baseline = current
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
    }
  }
  const stop = () => {
    stopped = true
    generation++
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
